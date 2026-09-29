// @vitest-environment node
/**
 * Tests for the vouch-back counter fix — issue #165.
 *
 * Three layers:
 *
 * 1. Unit tests for `decodeVouchClaimedEvent` — pure, no mocks.
 * 2. Unit tests for the counting logic built on top of decoded events — verifies
 *    that duplicates are collapsed, other vouchers' events are ignored, and
 *    multi-page cursor results are accumulated correctly.
 * 3. Integration tests for `verifyEvidence` (vouch_back branch) exercised through
 *    the POST handler to confirm the rejection message reports the claimed count
 *    and that the scan starts from oldestLedger.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Keypair, StrKey, nativeToScVal, scValToNative, xdr } from '@stellar/stellar-sdk';

// ── RPC mock (vi.hoisted, not a plain const — lib/stellar.ts (#346) now constructs a
// `new rpc.Server(...)` at module scope, and this file's top-level `import ... from
// './route'` below pulls that in during the import phase, before any later top-level
// `const` would have run; a plain const here would be read from the mock factory's
// closure while still in the TDZ) ───────────────────────────────────────────────────

const { getHealthMock, getEventsMock, simulateMock } = vi.hoisted(() => ({
  getHealthMock: vi.fn(),
  getEventsMock: vi.fn(),
  simulateMock: vi.fn(),
}));

vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const real = await importOriginal<typeof import('@stellar/stellar-sdk')>();
  return {
    ...real,
    rpc: {
      ...real.rpc,
      Server: vi.fn().mockImplementation(() => ({
        getHealth:           getHealthMock,
        getEvents:           getEventsMock,
        simulateTransaction: simulateMock,
        getLatestLedger:     vi.fn(),
      })),
      Api: real.rpc.Api,
    },
  };
});

import { decodeVouchClaimedEvent } from './route';

// ── shared fixtures ───────────────────────────────────────────────────────────

// ALICE is used as the request `recipient`, which the 200-status tests carry all the way
// to real signing (`Address(recipient).toScVal()`), so it must be a checksum-valid StrKey —
// unlike BOB/CAROL/DAVE, which only ever appear as opaque `claimer` strings inside decoded
// events and never pass through Address().
const ALICE  = Keypair.random().publicKey();
const BOB    = 'G' + 'B'.repeat(55);
const CAROL  = 'G' + 'C'.repeat(55);
const DAVE   = 'G' + 'D'.repeat(55);
const ATTESTER_KP = Keypair.random();

/** Encode a `vouch/claimed` event value as the contract emits it: (id, from, claimer). */
function makeClaimedValue(id: number, from: string, claimer: string): xdr.ScVal {
  return nativeToScVal([id, from, claimer]);
}

/** Build a minimal fake RPC event object for getEvents. */
function fakeEvent(id: number, from: string, claimer: string) {
  return { value: makeClaimedValue(id, from, claimer) };
}

// ── 1. Unit tests: decodeVouchClaimedEvent ────────────────────────────────────

describe('decodeVouchClaimedEvent', () => {
  it('decodes a well-formed (id, from, claimer) tuple', () => {
    const raw = scValToNative(makeClaimedValue(42, ALICE, BOB));
    const result = decodeVouchClaimedEvent(raw);
    expect(result).toEqual({ vouchId: '42', from: ALICE, claimer: BOB });
  });

  it('stringifies a bigint vouch id', () => {
    const raw = scValToNative(nativeToScVal([BigInt('9007199254740993'), ALICE, BOB]));
    const result = decodeVouchClaimedEvent(raw);
    expect(result?.vouchId).toBe('9007199254740993');
  });

  it('returns null for a tuple with wrong length', () => {
    expect(decodeVouchClaimedEvent([1, ALICE])).toBeNull();        // too short
    expect(decodeVouchClaimedEvent([1, ALICE, BOB, CAROL])).toBeNull(); // too long
  });

  it('returns null when from or claimer are not strings', () => {
    expect(decodeVouchClaimedEvent([1, 42, BOB])).toBeNull();
    expect(decodeVouchClaimedEvent([1, ALICE, null])).toBeNull();
  });

  it('returns null for non-array input', () => {
    expect(decodeVouchClaimedEvent(null)).toBeNull();
    expect(decodeVouchClaimedEvent('nope')).toBeNull();
    expect(decodeVouchClaimedEvent({})).toBeNull();
  });
});

// ── 2. Unit tests: counting logic over decoded events ─────────────────────────

describe('vouch/claimed counting logic', () => {
  /**
   * Exercise the counting rules directly against decoded events without loading the
   * route.  We use decodeVouchClaimedEvent + a hand-rolled accumulator that mirrors
   * exactly what countVouchesClaimedBy does internally.
   */
  function countFrom(events: ReturnType<typeof fakeEvent>[], from: string): number {
    const claimers = new Set<string>();
    for (const e of events) {
      const d = decodeVouchClaimedEvent(scValToNative(e.value));
      if (d && d.from === from) claimers.add(d.claimer);
    }
    return claimers.size;
  }

  it('counts distinct claimers, not raw event count', () => {
    // Same claimer, different vouch ids — must count as 1.
    const events = [
      fakeEvent(1, ALICE, BOB),
      fakeEvent(2, ALICE, BOB), // duplicate claimer
      fakeEvent(3, ALICE, CAROL),
    ];
    expect(countFrom(events, ALICE)).toBe(2); // BOB + CAROL
  });

  it('ignores events from other vouchers', () => {
    const events = [
      fakeEvent(1, ALICE, BOB),
      fakeEvent(2, DAVE,  BOB),  // DAVE vouched, not ALICE
      fakeEvent(3, DAVE,  CAROL),
    ];
    expect(countFrom(events, ALICE)).toBe(1); // only BOB via ALICE
  });

  it('returns 0 when there are no matching events', () => {
    const events = [fakeEvent(1, DAVE, BOB)];
    expect(countFrom(events, ALICE)).toBe(0);
  });

  it('accumulates correctly across a simulated multi-page result', () => {
    // Page 1: ALICE -> BOB, ALICE -> CAROL
    // Page 2: ALICE -> CAROL (duplicate), ALICE -> DAVE
    const page1 = [fakeEvent(1, ALICE, BOB), fakeEvent(2, ALICE, CAROL)];
    const page2 = [fakeEvent(3, ALICE, CAROL), fakeEvent(4, ALICE, DAVE)];
    const all   = [...page1, ...page2];
    expect(countFrom(all, ALICE)).toBe(3); // BOB + CAROL + DAVE
  });
});

// ── 3. Integration: POST handler — vouch_back branch ─────────────────────────

describe('POST /api/attest — vouch_back evidence (issue #165)', () => {
  /** Import a fresh module after env is set. */
  async function loadRoute() {
    const mod = await import('./route');
    return mod.POST;
  }

  function makeRequest(body: unknown, ip = '1.2.3.4'): Request {
    return new Request('http://localhost/api/attest', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': ip,
      },
      body: JSON.stringify(body),
    });
  }

  /** Minimal payload sim so signing succeeds on the happy path. */
  function setupPayloadSim() {
    const retval = nativeToScVal(Buffer.alloc(32, 0xab));
    simulateMock.mockResolvedValue({ result: { retval } });
  }

  /** Make getEvents return one page of claimed events and then stop. */
  function setupClaimedEvents(events: ReturnType<typeof fakeEvent>[], oldestLedger = 1) {
    getHealthMock.mockResolvedValue({ oldestLedger });
    getEventsMock.mockResolvedValue({ events, cursor: undefined });
  }

  beforeEach(() => {
    vi.resetModules();
    process.env.ATTESTER_SECRET_KEY                     = ATTESTER_KP.secret();
    // Real, checksum-valid contract StrKeys — a fake shape like 'C' + 'Q'.repeat(55)
    // fails `new Contract(...)`/`Address(...).toScVal()` with "Invalid contract ID"
    // once a request reaches real signing, so the 200-path tests below would never
    // exercise the branch they claim to.
    process.env.NEXT_PUBLIC_QUEST_REGISTRY_CONTRACT_ID  = StrKey.encodeContract(Buffer.alloc(32, 17));
    process.env.NEXT_PUBLIC_REPUTATION_CONTRACT_ID      = StrKey.encodeContract(Buffer.alloc(32, 18));
    process.env.NEXT_PUBLIC_RPC_URL                     = 'https://soroban-testnet.stellar.org';
    process.env.NEXT_PUBLIC_HORIZON_URL                 = 'https://horizon-testnet.stellar.org';
    process.env.NEXT_PUBLIC_STELLAR_NETWORK             = 'testnet';
    // Quest ↔ evidence binding (lib/attest.ts buildQuestEvidenceMap, issue #359): bind
    // quest 1 (the id every test below uses) to vouch_back, and clear the other
    // binding vars so no value leaks in from a previous test.
    process.env.NEXT_PUBLIC_VOUCHBACK_QUEST_ID          = '1';
    delete process.env.NEXT_PUBLIC_DEFAULT_QUEST_ID;
    delete process.env.NEXT_PUBLIC_INVITE_QUEST_ID;
    delete process.env.QUEST_GITHUB_ID;
    getHealthMock.mockReset();
    getEventsMock.mockReset();
    simulateMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── rejection message reports the claimed count ──────────────────────────

  it('422 with "0 claimed so far" when the scan finds no claimed vouches', async () => {
    setupClaimedEvents([]);
    const POST = await loadRoute();
    const res = await POST(makeRequest({ questId: 1, recipient: ALICE, evidence: { type: 'vouch_back', ref: '' } }));
    expect(res.status).toBe(422);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/0 claimed so far/);
  });

  it('422 reports the actual partial count in the rejection message', async () => {
    // ALICE has vouched for 2 people but needs VOUCH_BACK_MIN (3).
    setupClaimedEvents([
      fakeEvent(1, ALICE, BOB),
      fakeEvent(2, ALICE, CAROL),
    ]);
    const POST = await loadRoute();
    const res = await POST(makeRequest({ questId: 1, recipient: ALICE, evidence: { type: 'vouch_back', ref: '' } }));
    expect(res.status).toBe(422);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/2 claimed so far/);
  });

  // ── scan uses oldestLedger, not a fixed window ────────────────────────────

  it('passes oldestLedger from getHealth as the startLedger', async () => {
    const OLDEST = 12_345;
    getHealthMock.mockResolvedValue({ oldestLedger: OLDEST });
    getEventsMock.mockResolvedValue({ events: [], cursor: undefined });

    const POST = await loadRoute();
    await POST(makeRequest({ questId: 1, recipient: ALICE, evidence: { type: 'vouch_back', ref: '' } }));

    // The first getEvents call must use startLedger = oldestLedger.
    expect(getEventsMock).toHaveBeenCalledWith(
      expect.objectContaining({ startLedger: OLDEST }),
    );
  });

  // ── scan follows cursor until exhausted ──────────────────────────────────

  it('follows cursor across multiple pages and accumulates all claimers', async () => {
    const OLDEST = 1;
    getHealthMock.mockResolvedValue({ oldestLedger: OLDEST });

    // Page 1: cursor present — more data coming.
    getEventsMock
      .mockResolvedValueOnce({
        events: [fakeEvent(1, ALICE, BOB), fakeEvent(2, ALICE, CAROL)],
        cursor: 'cursor-after-page-1',
      })
      // Page 2: no cursor — scan complete.
      .mockResolvedValueOnce({
        events: [fakeEvent(3, ALICE, DAVE)],
        cursor: undefined,
      });

    setupPayloadSim();
    const POST = await loadRoute();
    const res = await POST(makeRequest({ questId: 1, recipient: ALICE, evidence: { type: 'vouch_back', ref: '' } }));

    // 3 distinct claimers (BOB, CAROL, DAVE) >= VOUCH_BACK_MIN(3) -> 200.
    expect(res.status).toBe(200);
    expect(getEventsMock).toHaveBeenCalledTimes(2);

    // Second call must use the cursor, not startLedger.
    const secondCall = getEventsMock.mock.calls[1][0] as Record<string, unknown>;
    expect(secondCall.cursor).toBe('cursor-after-page-1');
    expect(secondCall).not.toHaveProperty('startLedger');
  });

  // ── only claimed events count, not minted ────────────────────────────────

  it('200 when VOUCH_BACK_MIN distinct people have claimed (not just minted)', async () => {
    setupClaimedEvents([
      fakeEvent(1, ALICE, BOB),
      fakeEvent(2, ALICE, CAROL),
      fakeEvent(3, ALICE, DAVE),
    ]);
    setupPayloadSim();
    const POST = await loadRoute();
    const res = await POST(makeRequest({ questId: 1, recipient: ALICE, evidence: { type: 'vouch_back', ref: '' } }));
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  // ── duplicate claimers only count once ───────────────────────────────────

  it('counts each claimer once even when they appear in multiple events', async () => {
    // BOB claimed twice (different vouch ids — impossible on-chain but defensive).
    // CAROL claimed once. Total distinct = 2, below VOUCH_BACK_MIN.
    setupClaimedEvents([
      fakeEvent(1, ALICE, BOB),
      fakeEvent(2, ALICE, BOB),
      fakeEvent(3, ALICE, CAROL),
    ]);
    const POST = await loadRoute();
    const res = await POST(makeRequest({ questId: 1, recipient: ALICE, evidence: { type: 'vouch_back', ref: '' } }));
    expect(res.status).toBe(422);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/2 claimed so far/);
  });

  // ── events from other vouchers are ignored ────────────────────────────────

  it('ignores claimed events where from is a different address', async () => {
    setupClaimedEvents([
      fakeEvent(1, DAVE,  BOB),   // DAVE vouched, not ALICE
      fakeEvent(2, DAVE,  CAROL),
      fakeEvent(3, DAVE,  ALICE),
      fakeEvent(4, ALICE, BOB),   // only one real claim by ALICE
    ]);
    const POST = await loadRoute();
    const res = await POST(makeRequest({ questId: 1, recipient: ALICE, evidence: { type: 'vouch_back', ref: '' } }));
    expect(res.status).toBe(422);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/1 claimed so far/);
  });

  // ── reputation contract not configured ────────────────────────────────────

  it('422 with config error when REP_ID is missing', async () => {
    process.env.NEXT_PUBLIC_REPUTATION_CONTRACT_ID = '';
    const POST = await loadRoute();
    const res = await POST(makeRequest({ questId: 1, recipient: ALICE, evidence: { type: 'vouch_back', ref: '' } }));
    expect(res.status).toBe(422);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/not configured/);
  });

  // ── RPC failure falls back gracefully ────────────────────────────────────

  it('422 with retry message when getHealth throws', async () => {
    getHealthMock.mockRejectedValue(new Error('rpc timeout'));
    const POST = await loadRoute();
    const res = await POST(makeRequest({ questId: 1, recipient: ALICE, evidence: { type: 'vouch_back', ref: '' } }));
    expect(res.status).toBe(422);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/try again/);
  });

  it('422 with retry message when getEvents throws', async () => {
    getHealthMock.mockResolvedValue({ oldestLedger: 1 });
    getEventsMock.mockRejectedValue(new Error('network error'));
    const POST = await loadRoute();
    const res = await POST(makeRequest({ questId: 1, recipient: ALICE, evidence: { type: 'vouch_back', ref: '' } }));
    expect(res.status).toBe(422);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/try again/);
  });
});
