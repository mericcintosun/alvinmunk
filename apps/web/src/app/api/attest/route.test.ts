// @vitest-environment node
/**
 * Tests for the /api/attest route handler.
 *
 * Three suites:
 *   - "quest ↔ evidence binding" (issue #359): the handler must refuse to sign a quest id
 *     for any evidence type other than the one bound to it, before verifying anything over
 *     the network.
 *   - "referral_tx via the registry invite binding" (#367): registry `invited_by` decides
 *     first when set; only a wallet with no binding falls back to the classic manageData
 *     marker (judgeReferral, lib/attest.ts).
 *   - "status codes" (issue #180): every status-code branch of the handler itself — config,
 *     body size, rate limit, input validation, evidence shape/verification, signing, and the
 *     happy path (signature verified cryptographically).
 *   - "upstream failures" (issue #173): GitHub or Horizon timing out, unreachable, rate-limited
 *     or down is a retryable 5xx, never a 422 (which says the evidence is wrong).
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  Address,
  Contract,
  Keypair,
  Networks,
  StrKey,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import { QUEST_SIG_TTL_SECS, WEEK_SECS, questPayload, questWindow } from '../../../lib/attest';

const RECIPIENT = Keypair.random().publicKey();
const REFERRED = Keypair.random().publicKey();
const QUEST_CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 7));
const ATTESTER = Keypair.random();
const REGISTRY_CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 9));
const PASSKEY_REFERRED = StrKey.encodeContract(Buffer.alloc(32, 3));
const REWARDS_CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 11));
const USDC_SAC = StrKey.encodeContract(Buffer.alloc(32, 12));

/** One simulation reply: a view's return value, or a simulation error. */
const sim = (retval: unknown) =>
  ({ result: { retval } }) as unknown as rpc.Api.SimulateTransactionResponse;
const simError = (error: string) => ({ error }) as unknown as rpc.Api.SimulateTransactionResponse;
const score = (n: number) => sim(nativeToScVal(n, { type: 'u64' }));
const address = (a: string) => sim(new Address(a).toScVal());
/** `is_completed` replies: the recipient has (or hasn't) completed the quest. */
const completed = (done: boolean) => sim(nativeToScVal(done));
const open = () => completed(false);
/** `get_quest_periods([id])` replies: the quest's repeat period (0 = one-shot). */
const period = (secs: number) => sim(xdr.ScVal.scvVec([nativeToScVal(secs, { type: 'u64' })]));
const oneShot = () => period(0);

type Post = (req: Request) => Promise<Response>;
let POST: Post;
let fetchSpy: ReturnType<typeof vi.fn>;
let simulateSpy: MockInstance<rpc.Server['simulateTransaction']>;
let ledgerSpy: MockInstance<rpc.Server['getLatestLedger']>;

function attest(body: Record<string, unknown>): Promise<Response> {
  return POST(
    new Request('http://localhost/api/attest', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
      body: JSON.stringify({ recipient: RECIPIENT, ...body }),
    }),
  );
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('ATTESTER_SECRET_KEY', ATTESTER.secret());
  vi.stubEnv('NEXT_PUBLIC_QUEST_REGISTRY_CONTRACT_ID', QUEST_CONTRACT);
  vi.stubEnv('NEXT_PUBLIC_REPUTATION_CONTRACT_ID', QUEST_CONTRACT);
  vi.stubEnv('NEXT_PUBLIC_REGISTRY_CONTRACT_ID', '');
  // The dashboard defaults: 2 = referral_tx, 3 = invite_converts, 4 = vouch_back; no GitHub quest.
  vi.stubEnv('NEXT_PUBLIC_DEFAULT_QUEST_ID', '');
  vi.stubEnv('NEXT_PUBLIC_INVITE_QUEST_ID', '');
  vi.stubEnv('NEXT_PUBLIC_VOUCHBACK_QUEST_ID', '');
  vi.stubEnv('QUEST_GITHUB_ID', '');
  fetchSpy = vi.fn(async () => new Response('{}', { status: 404 }));
  vi.stubGlobal('fetch', fetchSpy);
  simulateSpy = vi.spyOn(rpc.Server.prototype, 'simulateTransaction');
  // Every read a test expects is queued with mockResolvedValueOnce; anything else fails
  // instead of reaching a real RPC node (the is_completed early exit then carries on).
  simulateSpy.mockRejectedValue(new Error('unexpected simulateTransaction'));
  ledgerSpy = vi.spyOn(rpc.Server.prototype, 'getLatestLedger');
  ({ POST } = (await import('./route')) as { POST: Post });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The contract functions simulated so far, in call order. */
const methods = () =>
  simulateSpy.mock.calls.map(([tx]) => {
    const op = (tx as unknown as { operations: { func: { invokeContract(): { functionName(): Buffer } } }[] })
      .operations[0];
    return op.func.invokeContract().functionName().toString();
  });

function expectNoNetwork() {
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(simulateSpy).not.toHaveBeenCalled();
  expect(ledgerSpy).not.toHaveBeenCalled();
}

describe('POST /api/attest quest ↔ evidence binding', () => {
  it('rejects vouch_back evidence replayed against the 50 XP quests, before any network call', async () => {
    for (const questId of [1, 3]) {
      const res = await attest({ questId, evidence: { type: 'vouch_back', ref: '' } });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: string; sig?: string };
      expect(body.sig).toBeUndefined();
    }
    expectNoNetwork();
  });

  it('rejects a mismatched type with 422 and names the mismatch', async () => {
    const res = await attest({ questId: 3, evidence: { type: 'referral_tx', ref: REFERRED } });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'evidence type does not match this quest' });
    expectNoNetwork();
  });

  it('rejects a quest id with no mapping, including github_pr while QUEST_GITHUB_ID is unset', async () => {
    const unmapped = await attest({
      questId: 99,
      evidence: { type: 'referral_tx', ref: REFERRED },
    });
    expect(unmapped.status).toBe(422);
    expect(await unmapped.json()).toEqual({ error: 'this quest cannot be attested' });
    const github = await attest({ questId: 1, evidence: { type: 'github_pr', ref: 'o/r#1' } });
    expect(github.status).toBe(422);
    expectNoNetwork();
  });

  it('lets the bound type through to verification', async () => {
    simulateSpy
      .mockResolvedValueOnce(oneShot())
      .mockResolvedValueOnce(open())
      .mockResolvedValueOnce(score(5));
    const res = await attest({ questId: 2, evidence: { type: 'referral_tx', ref: REFERRED } });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toMatch(/^no referral binding found/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain(`/accounts/${REFERRED}`);
  });

  it('signs the bound quest once its evidence verifies', async () => {
    const marker = Buffer.from(RECIPIENT, 'utf8').toString('base64');
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { referral: marker } }), { status: 200 }),
    );
    simulateSpy
      .mockResolvedValueOnce(oneShot())
      .mockResolvedValueOnce(open())
      .mockResolvedValueOnce(score(5));
    const before = Math.floor(Date.now() / 1000);
    const res = await attest({ questId: 2, evidence: { type: 'referral_tx', ref: REFERRED } });
    const after = Math.floor(Date.now() / 1000);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      questId: number;
      attester: string;
      sig: string;
      expiresAt: number;
    };
    expect(body.ok).toBe(true);
    expect(body.questId).toBe(2);
    expect(body.attester).toBe(ATTESTER.rawPublicKey().toString('hex'));

    // Valid for QUEST_SIG_TTL_SECS from now, in unix seconds (the ledger's unit).
    expect(body.expiresAt).toBeGreaterThanOrEqual(before + QUEST_SIG_TTL_SECS);
    expect(body.expiresAt).toBeLessThanOrEqual(after + QUEST_SIG_TTL_SECS);

    // The signature covers this network, contract, quest, recipient and expiry...
    const ctx = { contractId: QUEST_CONTRACT, passphrase: Networks.TESTNET };
    const sig = Buffer.from(body.sig, 'base64');
    expect(ATTESTER.verify(questPayload(ctx, 2, RECIPIENT, body.expiresAt), sig)).toBe(true);
    expect(ATTESTER.verify(questPayload(ctx, 2, RECIPIENT, body.expiresAt + 1), sig)).toBe(false);
    // ...and the payload was built here: no RPC node supplied the bytes that were signed.
    expect(methods()).toEqual(['get_quest_periods', 'is_completed', 'get_score']);
  });

  it('binds a quest id configured in env, not its default', async () => {
    vi.resetModules();
    vi.stubEnv('QUEST_GITHUB_ID', '1');
    vi.stubEnv('NEXT_PUBLIC_VOUCHBACK_QUEST_ID', '5');
    ({ POST } = (await import('./route')) as { POST: Post });
    // quest 4 is no longer the vouch_back quest
    const res = await attest({ questId: 4, evidence: { type: 'vouch_back', ref: '' } });
    expect(res.status).toBe(422);
    expectNoNetwork();
    // github_pr is now attestable on quest 1 (the GitHub API is reached)
    const gh = await attest({ questId: 1, evidence: { type: 'github_pr', ref: 'o/r#1' } });
    expect(gh.status).toBe(422);
    expect(await gh.json()).toEqual({ error: 'github 404' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/attest referral_tx via the registry invite binding', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_REGISTRY_CONTRACT_ID', REGISTRY_CONTRACT);
    ({ POST } = (await import('./route')) as { POST: Post });
  });

  it('signs for a passkey account whose binding names the recipient, without Horizon', async () => {
    simulateSpy
      .mockResolvedValueOnce(oneShot())
      .mockResolvedValueOnce(open())
      .mockResolvedValueOnce(score(5))
      .mockResolvedValueOnce(address(RECIPIENT));
    const res = await attest({ questId: 2, evidence: { type: 'referral_tx', ref: PASSKEY_REFERRED } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { sig: string }).sig).toBeTruthy();
    expect(methods()).toEqual(['get_quest_periods', 'is_completed', 'get_score', 'invited_by']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a binding to a different inviter, even with a matching manageData marker', async () => {
    const marker = Buffer.from(RECIPIENT, 'utf8').toString('base64');
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ data: { referral: marker } })));
    simulateSpy
      .mockResolvedValueOnce(oneShot())
      .mockResolvedValueOnce(open())
      .mockResolvedValueOnce(score(5))
      .mockResolvedValueOnce(address(Keypair.random().publicKey()));
    const res = await attest({ questId: 2, evidence: { type: 'referral_tx', ref: REFERRED } });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'that wallet was invited by a different account' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('gives an empty account bound to the recipient nothing', async () => {
    simulateSpy
      .mockResolvedValueOnce(oneShot())
      .mockResolvedValueOnce(open())
      .mockResolvedValueOnce(score(0))
      .mockResolvedValueOnce(address(RECIPIENT));
    const res = await attest({ questId: 2, evidence: { type: 'referral_tx', ref: PASSKEY_REFERRED } });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: 'that wallet hasn’t done anything here yet — no referral credit',
    });
  });

  it('falls back to manageData on a registry that predates invite bindings', async () => {
    const marker = Buffer.from(RECIPIENT, 'utf8').toString('base64');
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { referral: marker } }), { status: 200 }),
    );
    simulateSpy
      .mockResolvedValueOnce(oneShot())
      .mockResolvedValueOnce(open())
      .mockResolvedValueOnce(score(5))
      .mockResolvedValueOnce(
        simError('HostError: Error(WasmVm, MissingValue) trying to invoke non-existent contract function'),
      );
    const res = await attest({ questId: 2, evidence: { type: 'referral_tx', ref: REFERRED } });
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('refuses rather than falling back when the registry read fails', async () => {
    const marker = Buffer.from(RECIPIENT, 'utf8').toString('base64');
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ data: { referral: marker } })));
    simulateSpy
      .mockResolvedValueOnce(oneShot())
      .mockResolvedValueOnce(open())
      .mockResolvedValueOnce(score(5))
      .mockResolvedValueOnce(simError('rpc overloaded'));
    const res = await attest({ questId: 2, evidence: { type: 'referral_tx', ref: REFERRED } });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: 'couldn’t read who invited that wallet right now — try again',
    });
  });

  // ── issue #180 additions: judgeReferral's manageData-marker branches, once the
  // registry has no binding for the referred wallet ──────────────────────────

  it('rejects a manageData marker that is a self-referral on the referred account', async () => {
    // marker stores REFERRED's own address (stored === ev.ref) — self-referral branch.
    const marker = Buffer.from(REFERRED, 'utf8').toString('base64');
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ data: { referral: marker } })));
    // No registry binding for REFERRED (invited_by resolves to null) — falls back to
    // the manageData marker.
    simulateSpy
      .mockResolvedValueOnce(oneShot())
      .mockResolvedValueOnce(open())
      .mockResolvedValueOnce(score(5))
      .mockResolvedValueOnce(sim(null));
    const res = await attest({ questId: 2, evidence: { type: 'referral_tx', ref: REFERRED } });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: 'referral marker is a self-referral on the referred account',
    });
  });

  it('rejects a manageData marker pointing to a different referrer', async () => {
    const someoneElse = Keypair.random().publicKey();
    const marker = Buffer.from(someoneElse, 'utf8').toString('base64');
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ data: { referral: marker } })));
    simulateSpy
      .mockResolvedValueOnce(oneShot())
      .mockResolvedValueOnce(open())
      .mockResolvedValueOnce(score(5))
      .mockResolvedValueOnce(sim(null));
    const res = await attest({ questId: 2, evidence: { type: 'referral_tx', ref: REFERRED } });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: 'referral marker points to a different referrer — cannot reuse this marker',
    });
  });

  it('reports a Horizon read failure distinctly from having no binding at all', async () => {
    // invited_by resolves to null (no registry binding); the manageData fallback then
    // hits Horizon, which returns a non-404 error — that must read as an upstream failure
    // (#173), not be folded into "no referral binding found".
    fetchSpy.mockResolvedValue(new Response('rate limited', { status: 503 }));
    simulateSpy
      .mockResolvedValueOnce(oneShot())
      .mockResolvedValueOnce(open())
      .mockResolvedValueOnce(score(5))
      .mockResolvedValueOnce(sim(null));
    const res = await attest({ questId: 2, evidence: { type: 'referral_tx', ref: REFERRED } });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: 'horizon unavailable (503) — try again',
      retryable: true,
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Suite — status codes (issue #180)
// ══════════════════════════════════════════════════════════════════════════
// Every branch of the handler that the two suites above don't already cover: config,
// body size, rate limit, input validation, evidence shape, github_pr verification and
// signing, and the happy path with a cryptographically-verified signature. referral_tx's
// own 422 branches (judgeReferral) are covered above instead of duplicated here.

describe('POST /api/attest — status codes (issue #180)', () => {
  /** A raw Request, for the cases attest()'s fixed IP / fixed recipient don't fit. */
  function rawRequest(
    body: unknown,
    opts: { ip?: string; contentLength?: number | null; rawBody?: string } = {},
  ): Request {
    const raw = opts.rawBody ?? JSON.stringify(body);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (opts.ip) headers['x-forwarded-for'] = opts.ip;
    if (opts.contentLength !== undefined && opts.contentLength !== null) {
      headers['content-length'] = String(opts.contentLength);
    }
    return new Request('http://localhost/api/attest', { method: 'POST', headers, body: raw });
  }

  // ── 500: attester not configured ─────────────────────────────────────────

  it('500 when ATTESTER_SECRET_KEY is missing', async () => {
    vi.resetModules();
    vi.stubEnv('ATTESTER_SECRET_KEY', '');
    ({ POST } = (await import('./route')) as { POST: Post });
    const res = await attest({ questId: 1 });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/not configured/i);
  });

  it('500 when quest registry contract id is missing', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_QUEST_REGISTRY_CONTRACT_ID', '');
    ({ POST } = (await import('./route')) as { POST: Post });
    const res = await attest({ questId: 1 });
    expect(res.status).toBe(500);
  });

  // ── 413: body size ────────────────────────────────────────────────────────

  it('413 when content-length header exceeds MAX_BODY_BYTES', async () => {
    const res = await POST(rawRequest({}, { contentLength: 5_000 }));
    expect(res.status).toBe(413);
  });

  it('413 when chunked body (no content-length) exceeds MAX_BODY_BYTES', async () => {
    const res = await POST(rawRequest(undefined, { ip: '1.2.3.4', rawBody: 'x'.repeat(5_000) }));
    expect(res.status).toBe(413);
  });

  // ── 429: rate limit ───────────────────────────────────────────────────────

  it('429 on the 7th request from the same IP within 60 s', async () => {
    for (let i = 0; i < 6; i++) {
      const res = await POST(rawRequest({ questId: 1, recipient: RECIPIENT }, { ip: '5.5.5.5' }));
      expect(res.status).not.toBe(429);
    }
    const res = await POST(rawRequest({ questId: 1, recipient: RECIPIENT }, { ip: '5.5.5.5' }));
    expect(res.status).toBe(429);
  });

  it('rate-limit is per-IP — a different IP is not affected', async () => {
    for (let i = 0; i < 7; i++) {
      await POST(rawRequest({ questId: 1, recipient: RECIPIENT }, { ip: '6.6.6.6' }));
    }
    const res = await POST(rawRequest({ questId: 1, recipient: RECIPIENT }, { ip: '7.7.7.7' }));
    expect(res.status).not.toBe(429);
  });

  // ── 400: invalid JSON / bad questId / bad recipient ───────────────────────

  it('400 on invalid JSON body', async () => {
    const res = await POST(rawRequest(undefined, { ip: '1.2.3.4', rawBody: '{not valid json' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/json/i);
  });

  it('400 when questId is missing', async () => {
    const res = await POST(rawRequest({ recipient: RECIPIENT }, { ip: '1.2.3.4' }));
    expect(res.status).toBe(400);
  });

  it('400 when questId is a float', async () => {
    const res = await POST(rawRequest({ questId: 1.5, recipient: RECIPIENT }, { ip: '1.2.3.4' }));
    expect(res.status).toBe(400);
  });

  it('400 when questId is negative', async () => {
    const res = await POST(rawRequest({ questId: -1, recipient: RECIPIENT }, { ip: '1.2.3.4' }));
    expect(res.status).toBe(400);
  });

  it('400 when recipient is not a G/C address', async () => {
    const res = await POST(rawRequest({ questId: 1, recipient: 'notanaddress' }, { ip: '1.2.3.4' }));
    expect(res.status).toBe(400);
  });

  it('400 when recipient is missing', async () => {
    const res = await POST(rawRequest({ questId: 1 }, { ip: '1.2.3.4' }));
    expect(res.status).toBe(400);
  });

  // ── 422: evidence shape ───────────────────────────────────────────────────

  it('422 when evidence type is unknown', async () => {
    const res = await attest({ questId: 1, evidence: { type: 'nope', ref: 'x' } });
    expect(res.status).toBe(422);
  });

  it('422 when github_pr ref format is wrong', async () => {
    const res = await attest({ questId: 1, evidence: { type: 'github_pr', ref: 'not-a-pr-ref' } });
    expect(res.status).toBe(422);
  });

  it('422 when referral_tx ref is not a G or C address', async () => {
    const res = await attest({ questId: 2, evidence: { type: 'referral_tx', ref: 'NOTANADDRESS' } });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'ref must be a G or C address' });
  });

  it('422 when referral_tx is a self-referral', async () => {
    const res = await attest({ questId: 2, evidence: { type: 'referral_tx', ref: RECIPIENT } });
    expect(res.status).toBe(422);
  });

  // ── 422: evidence verification — github_pr ────────────────────────────────
  // github_pr has no DEFAULT_QUEST_IDS entry (lib/attest.ts), so these bind it to
  // quest 1 via QUEST_GITHUB_ID before loading the route — otherwise the quest ↔
  // evidence binding check (#359) would reject at 422 before ever reaching verifyEvidence.

  it('422 when github repo is not on the allowlist', async () => {
    vi.resetModules();
    vi.stubEnv('QUEST_GITHUB_ID', '1');
    vi.stubEnv('QUEST_GITHUB_REPOS', 'allowed/repo');
    ({ POST } = (await import('./route')) as { POST: Post });
    const res = await attest({ questId: 1, evidence: { type: 'github_pr', ref: 'evil/repo#1' } });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/not eligible/i);
  });

  it('422 when PR is not merged', async () => {
    vi.resetModules();
    vi.stubEnv('QUEST_GITHUB_ID', '1');
    ({ POST } = (await import('./route')) as { POST: Post });
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ merged: false }), { status: 200 }));
    const res = await attest({ questId: 1, evidence: { type: 'github_pr', ref: 'owner/repo#42' } });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/not merged/i);
  });

  it('422 when GitHub API returns non-200', async () => {
    vi.resetModules();
    vi.stubEnv('QUEST_GITHUB_ID', '1');
    ({ POST } = (await import('./route')) as { POST: Post });
    fetchSpy.mockResolvedValueOnce(new Response('', { status: 404 }));
    const res = await attest({ questId: 1, evidence: { type: 'github_pr', ref: 'owner/repo#99' } });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/github 404/i);
  });

  // ── signing: local, never fed by an RPC node (issue #142) ───────────────────

  it('signs with no RPC read but the period and completion checks, so a failing node can neither block nor feed it', async () => {
    vi.resetModules();
    vi.stubEnv('QUEST_GITHUB_ID', '1');
    ({ POST } = (await import('./route')) as { POST: Post });
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ merged: true }), { status: 200 }));
    simulateSpy.mockRejectedValue(new Error('rpc timeout'));
    const res = await attest({ questId: 1, evidence: { type: 'github_pr', ref: 'owner/repo#1' } });
    expect(res.status).toBe(200);
    expect(methods()).toEqual(['get_quest_periods', 'is_completed']);
  });

  it('500 when the attester secret is malformed, with no signature', async () => {
    vi.resetModules();
    vi.stubEnv('ATTESTER_SECRET_KEY', 'SNOTASECRET');
    vi.stubEnv('QUEST_GITHUB_ID', '1');
    ({ POST } = (await import('./route')) as { POST: Post });
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ merged: true }), { status: 200 }));
    const res = await attest({ questId: 1, evidence: { type: 'github_pr', ref: 'owner/repo#1' } });
    expect(res.status).toBe(500);
    expect(((await res.json()) as { sig?: string }).sig).toBeUndefined();
  });

  // ── 200: happy path — github_pr, signature verified cryptographically ─────

  it('200 with valid github_pr evidence — returned sig verifies over the award payload', async () => {
    const attesterKp = Keypair.random();
    vi.resetModules();
    vi.stubEnv('ATTESTER_SECRET_KEY', attesterKp.secret());
    vi.stubEnv('QUEST_GITHUB_ID', '5');
    ({ POST } = (await import('./route')) as { POST: Post });
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ merged: true }), { status: 200 }));

    const res = await attest({
      questId: 5,
      evidence: { type: 'github_pr', ref: 'owner/repo#7' },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      attester: string;
      sig: string;
      expiresAt: number;
      recipient: string;
      questId: number;
    };
    expect(body.ok).toBe(true);
    expect(body.recipient).toBe(RECIPIENT);
    expect(body.questId).toBe(5);

    // Cryptographic verification: rebuild the keypair from the returned public key and
    // verify the sig over the payload for this network, contract, quest, wallet and expiry.
    expect(attesterKp.rawPublicKey().toString('hex')).toBe(body.attester);
    const sigBytes = Buffer.from(body.sig, 'base64');
    const ctx = { contractId: QUEST_CONTRACT, passphrase: Networks.TESTNET };
    const signed = questPayload(ctx, 5, RECIPIENT, body.expiresAt);
    expect(attesterKp.verify(signed, sigBytes)).toBe(true);
    const tampered = Buffer.from(signed);
    tampered[tampered.length - 1] ^= 0xff;
    expect(attesterKp.verify(tampered, sigBytes)).toBe(false);
  });

  // ── 200: happy path — referral_tx, C-address recipient ────────────────────

  it('200 with valid referral_tx evidence and a C-address recipient', async () => {
    const marker = Buffer.from(PASSKEY_REFERRED, 'utf8').toString('base64');
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { referral: marker } }), { status: 200 }),
    );
    simulateSpy
      .mockResolvedValueOnce(oneShot())
      .mockResolvedValueOnce(open())
      .mockResolvedValueOnce(score(5));

    const res = await attest({
      questId: 2,
      recipient: PASSKEY_REFERRED,
      evidence: { type: 'referral_tx', ref: REFERRED },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      recipient: string;
      sig: string;
      expiresAt: number;
    };
    expect(body.ok).toBe(true);
    expect(body.recipient).toBe(PASSKEY_REFERRED);
    // The payload names the passkey wallet (a contract address) as the recipient.
    const ctx = { contractId: QUEST_CONTRACT, passphrase: Networks.TESTNET };
    const sig = Buffer.from(body.sig, 'base64');
    expect(ATTESTER.verify(questPayload(ctx, 2, PASSKEY_REFERRED, body.expiresAt), sig)).toBe(true);
  });

  // ── rate-limit sweep (hits.size > 500) ─────────────────────────────────────

  it('sweep runs without crashing when the hits map exceeds 500 entries', async () => {
    const promises: Promise<Response>[] = [];
    for (let i = 0; i < 501; i++) {
      promises.push(
        POST(
          rawRequest(
            { questId: 1, recipient: RECIPIENT },
            { ip: `10.0.${Math.floor(i / 256)}.${i % 256}` },
          ),
        ),
      );
    }
    const responses = await Promise.all(promises);
    for (const r of responses) expect(r.status).not.toBe(429);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Suite — upstream failures (issue #173)
// ══════════════════════════════════════════════════════════════════════════
// The two evidence checks that call fetch: github_pr (GitHub's PR API) and referral_tx's
// manageData fallback (Horizon). Their evidence failures — a 404, an unmerged PR, a missing
// or mismatched marker — stay 422 and are covered above.

describe('POST /api/attest — upstream failures (issue #173)', () => {
  const upstreams = [
    {
      upstream: 'github',
      async setup() {
        vi.resetModules();
        vi.stubEnv('QUEST_GITHUB_ID', '1');
        ({ POST } = (await import('./route')) as { POST: Post });
        simulateSpy.mockResolvedValueOnce(oneShot()).mockResolvedValueOnce(open()); // one-shot, not completed yet (#156)
      },
      request: { questId: 1, evidence: { type: 'github_pr', ref: 'owner/repo#1' } },
    },
    {
      upstream: 'horizon',
      async setup() {
        // One-shot, not completed yet (#156), then a wallet with a score and no registry binding: the
        // manageData marker decides.
        simulateSpy.mockResolvedValueOnce(oneShot()).mockResolvedValueOnce(open()).mockResolvedValueOnce(score(5));
      },
      request: { questId: 2, evidence: { type: 'referral_tx', ref: REFERRED } },
    },
  ] as const;

  describe.each(upstreams)('$upstream', ({ upstream, setup, request }) => {
    beforeEach(setup);

    it('504 when the connection stalls, cut off by the timeout', async () => {
      // A fetch that never settles on its own: only its signal can end it. The route's
      // 8 s timeout is shortened to 5 ms here; the rejection is Node's own TimeoutError.
      const realTimeout = AbortSignal.timeout.bind(AbortSignal);
      const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => realTimeout(5));
      fetchSpy.mockImplementationOnce(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
          }),
      );
      const res = await attest(request);
      expect(timeoutSpy).toHaveBeenCalledWith(8_000);
      expect(res.status).toBe(504);
      expect(await res.json()).toEqual({
        error: `${upstream} timed out — try again`,
        retryable: true,
      });
    });

    it('504 when the body stalls past the timeout', async () => {
      const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      const stalled = new ReadableStream({ start: (c) => c.error(timeout) });
      fetchSpy.mockResolvedValueOnce(new Response(stalled, { status: 200 }));
      const res = await attest(request);
      expect(res.status).toBe(504);
      expect(await res.json()).toEqual({
        error: `${upstream} timed out — try again`,
        retryable: true,
      });
    });

    it('503 when fetch rejects (DNS failure, connection reset) — a JSON answer, not a throw', async () => {
      fetchSpy.mockRejectedValueOnce(new TypeError('fetch failed'));
      const res = await attest(request);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        error: `couldn’t reach ${upstream} right now — try again`,
        retryable: true,
      });
    });

    it.each([403, 429, 500, 503])('503 when it answers %i (rate limit, outage)', async (status) => {
      fetchSpy.mockResolvedValueOnce(new Response('{"message":"nope"}', { status }));
      const res = await attest(request);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        error: `${upstream} unavailable (${status}) — try again`,
        retryable: true,
      });
    });

    it('502 on any other unexpected status, still not a 422', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('{"message":"bad"}', { status: 401 }));
      const res = await attest(request);
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({
        error: `${upstream} unavailable (401) — try again`,
        retryable: true,
      });
    });

    it('502 when a 200 answer is not JSON', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('<html>maintenance</html>', { status: 200 }));
      const res = await attest(request);
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({
        error: `${upstream} sent an unreadable answer — try again`,
        retryable: true,
      });
    });
  });

  it('a Horizon outage does not hide that the referred wallet has no score yet', async () => {
    // judgeReferral decides on the score first: with none, Horizon's answer can't matter.
    simulateSpy.mockResolvedValueOnce(oneShot()).mockResolvedValueOnce(open()).mockResolvedValueOnce(score(0));
    fetchSpy.mockRejectedValueOnce(new TypeError('fetch failed'));
    const res = await attest({ questId: 2, evidence: { type: 'referral_tx', ref: REFERRED } });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: 'that wallet hasn’t done anything here yet — no referral credit',
    });
  });

  it('still sends GITHUB_TOKEN with the timed GitHub read', async () => {
    vi.resetModules();
    vi.stubEnv('QUEST_GITHUB_ID', '1');
    vi.stubEnv('GITHUB_TOKEN', 'ghp_test');
    ({ POST } = (await import('./route')) as { POST: Post });
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ merged: true }), { status: 200 }));
    const res = await attest({ questId: 1, evidence: { type: 'github_pr', ref: 'owner/repo#1' } });
    expect(res.status).toBe(200);
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer ghp_test');
  });
});

describe('POST /api/attest already-completed quests (issue #156)', () => {
  const MISSING_VIEW =
    'HostError: Error(WasmVm, MissingValue) trying to invoke non-existent contract function';

  it('answers 409 before verifying evidence, and signs nothing', async () => {
    simulateSpy.mockResolvedValueOnce(oneShot()).mockResolvedValueOnce(completed(true));
    const res = await attest({ questId: 2, evidence: { type: 'referral_tx', ref: REFERRED } });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'You’ve already completed this quest.' });
    // The period, then one completion read of this quest for this recipient; no Horizon,
    // GitHub or other RPC call.
    expect(methods()).toEqual(['get_quest_periods', 'is_completed']);
    const [tx] = simulateSpy.mock.calls[1];
    const call = (tx as unknown as { operations: { func: { invokeContract(): { args(): unknown[] } } }[] })
      .operations[0].func.invokeContract();
    expect(call.args().map((a) => scValToNative(a as never))).toEqual([2, RECIPIENT]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('checks only after the network-free evidence checks', async () => {
    const res = await attest({ questId: 3, evidence: { type: 'referral_tx', ref: REFERRED } });
    expect(res.status).toBe(422);
    expectNoNetwork();
  });

  it('carries on to verification when the contract predates is_completed or the read fails', async () => {
    for (const reply of [
      () => simulateSpy.mockResolvedValueOnce(simError(MISSING_VIEW)),
      () => simulateSpy.mockRejectedValueOnce(new Error('rpc down')),
    ]) {
      simulateSpy.mockClear();
      fetchSpy.mockClear();
      simulateSpy.mockResolvedValueOnce(oneShot());
      reply();
      simulateSpy.mockResolvedValueOnce(score(5));
      const res = await attest({ questId: 2, evidence: { type: 'referral_tx', ref: REFERRED } });
      expect(res.status).toBe(422);
      expect(((await res.json()) as { error: string }).error).toMatch(/^no referral binding found/);
      expect(methods()).toEqual(['get_quest_periods', 'is_completed', 'get_score']);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    }
  });
});

describe('POST /api/attest repeatable quests (issue #154)', () => {
  const THU = 1_790_812_800; // a week boundary: 2026-10-01 00:00 UTC
  const ctx = { contractId: QUEST_CONTRACT, passphrase: Networks.TESTNET };
  const iso = (secs: number) => new Date(secs * 1000).toISOString();
  const pr = (mergedAt: number) =>
    new Response(JSON.stringify({ merged: true, merged_at: iso(mergedAt) }), { status: 200 });

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime((THU + 3 * 86_400) * 1000); // mid-week
    vi.resetModules();
    vi.stubEnv('QUEST_GITHUB_ID', '1');
    ({ POST } = (await import('./route')) as { POST: Post });
  });

  afterEach(() => vi.useRealTimers());

  it('signs the v2 payload for this week, for a PR merged this week', async () => {
    fetchSpy.mockResolvedValueOnce(pr(THU + 60));
    simulateSpy.mockResolvedValueOnce(period(WEEK_SECS)).mockResolvedValueOnce(open());
    const res = await attest({ questId: 1, evidence: { type: 'github_pr', ref: 'owner/repo#7' } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sig: string; expiresAt: number };
    const now = THU + 3 * 86_400;
    expect(body.expiresAt).toBe(now + QUEST_SIG_TTL_SECS);
    const sig = Buffer.from(body.sig, 'base64');
    const week = questWindow(now, WEEK_SECS);
    expect(ATTESTER.verify(questPayload(ctx, 1, RECIPIENT, body.expiresAt, week), sig)).toBe(true);
    // Not a one-shot signature, and not one for next week.
    expect(ATTESTER.verify(questPayload(ctx, 1, RECIPIENT, body.expiresAt), sig)).toBe(false);
    const next = questWindow(now + WEEK_SECS, WEEK_SECS);
    expect(ATTESTER.verify(questPayload(ctx, 1, RECIPIENT, body.expiresAt, next), sig)).toBe(false);
    expect(methods()).toEqual(['get_quest_periods', 'is_completed']);
  });

  it('refuses a PR merged before this week, so one PR cannot pay every week', async () => {
    for (const merged of [THU - 1, NaN]) {
      fetchSpy.mockResolvedValueOnce(
        Number.isNaN(merged)
          ? new Response(JSON.stringify({ merged: true }), { status: 200 }) // undated
          : pr(merged),
      );
      simulateSpy.mockResolvedValueOnce(period(WEEK_SECS)).mockResolvedValueOnce(open());
      const res = await attest({ questId: 1, evidence: { type: 'github_pr', ref: 'owner/repo#7' } });
      expect(res.status).toBe(422);
      expect(((await res.json()) as { error: string }).error).toMatch(/merged before this round/);
    }
  });

  it('stops the signature at the last second of the week', async () => {
    vi.setSystemTime((THU + WEEK_SECS - 60) * 1000);
    fetchSpy.mockResolvedValueOnce(pr(THU + 60));
    simulateSpy.mockResolvedValueOnce(period(WEEK_SECS)).mockResolvedValueOnce(open());
    const res = await attest({ questId: 1, evidence: { type: 'github_pr', ref: 'owner/repo#7' } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { expiresAt: number }).expiresAt).toBe(THU + WEEK_SECS - 1);
  });

  it('keeps a GitHub outage a retryable failure on a weekly quest, not a stale PR', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('down', { status: 503 }));
    simulateSpy.mockResolvedValueOnce(period(WEEK_SECS)).mockResolvedValueOnce(open());
    const res = await attest({ questId: 1, evidence: { type: 'github_pr', ref: 'owner/repo#7' } });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'github unavailable (503) — try again', retryable: true });
  });

  it('refuses a referral for a repeatable quest before reading any evidence', async () => {
    simulateSpy.mockResolvedValueOnce(period(WEEK_SECS));
    const res = await attest({ questId: 2, evidence: { type: 'referral_tx', ref: REFERRED } });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toMatch(/can’t be dated/);
    expect(methods()).toEqual(['get_quest_periods']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('says a weekly quest is done for this week', async () => {
    simulateSpy.mockResolvedValueOnce(period(WEEK_SECS)).mockResolvedValueOnce(completed(true));
    const res = await attest({ questId: 1, evidence: { type: 'github_pr', ref: 'owner/repo#7' } });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'You’ve already completed this quest this week.' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('counts only this week’s vouch claims for a weekly vouch-back quest', async () => {
    const claim = (n: number, claimer: string, at: number) => ({
      value: nativeToScVal([n, RECIPIENT, claimer]),
      ledgerClosedAt: iso(at),
    });
    const [a, b, c] = [1, 2, 3].map(() => Keypair.random().publicKey());
    vi.spyOn(rpc.Server.prototype, 'getHealth').mockResolvedValue({
      oldestLedger: 1,
    } as unknown as rpc.Api.GetHealthResponse);
    const events = vi.spyOn(rpc.Server.prototype, 'getEvents');
    const page = (list: unknown[]) =>
      ({ events: list, cursor: undefined }) as unknown as rpc.Api.GetEventsResponse;

    // Two claims this week and one last week: short of three.
    events.mockResolvedValueOnce(page([claim(1, a, THU + 10), claim(2, b, THU + 20), claim(3, c, THU - 10)]));
    simulateSpy.mockResolvedValueOnce(period(WEEK_SECS)).mockResolvedValueOnce(open());
    const short = await attest({ questId: 4, evidence: { type: 'vouch_back', ref: '' } });
    expect(short.status).toBe(422);
    expect(((await short.json()) as { error: string }).error).toBe(
      'vouch for 3 people first (2 claimed this round)',
    );

    // All three this week.
    events.mockResolvedValueOnce(page([claim(1, a, THU + 10), claim(2, b, THU + 20), claim(3, c, THU + 30)]));
    simulateSpy.mockResolvedValueOnce(period(WEEK_SECS)).mockResolvedValueOnce(open());
    const ok = await attest({ questId: 4, evidence: { type: 'vouch_back', ref: '' } });
    expect(ok.status).toBe(200);
  });

  it('signs as one-shot when the period cannot be read', async () => {
    fetchSpy.mockResolvedValueOnce(pr(THU - 30 * 86_400)); // an old PR is fine for a one-shot quest
    simulateSpy.mockRejectedValueOnce(new Error('rpc down')).mockResolvedValueOnce(open());
    const res = await attest({ questId: 1, evidence: { type: 'github_pr', ref: 'owner/repo#7' } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sig: string; expiresAt: number };
    const sig = Buffer.from(body.sig, 'base64');
    expect(ATTESTER.verify(questPayload(ctx, 1, RECIPIENT, body.expiresAt), sig)).toBe(true);
  });
});

describe('POST /api/attest first_tip (issue #272)', () => {
  const QUEST = 6;
  const FRIEND = Keypair.random().publicKey();
  const OTHER = Keypair.random().publicKey();
  const FLOOR = 5_000_000n; // 0.5 USDC
  const ISSUER = Keypair.random().publicKey();
  const ctx = { contractId: QUEST_CONTRACT, passphrase: Networks.TESTNET };
  const FIRST_TIP = { type: 'first_tip', ref: '' };

  interface Ev {
    contract: string;
    topic: xdr.ScVal[];
    value: xdr.ScVal;
    tx: string;
    ok?: boolean;
  }
  const event = ({ contract, topic, value, tx, ok = true }: Ev) => ({
    contractId: new Contract(contract),
    topic,
    value,
    txHash: tx,
    inSuccessfulContractCall: ok,
    ledgerClosedAt: new Date().toISOString(),
  });
  /** `rewards.tip` emits `('tipped', from, to) · amount` … */
  const tipped = (
    to: string,
    amount: bigint,
    tx: string,
    over: Partial<Ev> & { from?: string } = {},
  ) =>
    event({
      contract: REWARDS_CONTRACT,
      topic: [
        xdr.ScVal.scvSymbol('tipped'),
        new Address(over.from ?? RECIPIENT).toScVal(),
        new Address(to).toScVal(),
      ],
      value: nativeToScVal(amount, { type: 'i128' }),
      tx,
      ...over,
    });
  /** … after the USDC SAC's own `('transfer', from, to, asset) · amount` in the same tx. */
  const transfer = (
    to: string,
    amount: bigint,
    tx: string,
    over: Partial<Ev> & { from?: string } = {},
  ) =>
    event({
      contract: USDC_SAC,
      topic: [
        xdr.ScVal.scvSymbol('transfer'),
        new Address(over.from ?? RECIPIENT).toScVal(),
        new Address(to).toScVal(),
        nativeToScVal(`USDC:${ISSUER}`), // the SEP-11 asset name
      ],
      value: nativeToScVal(amount, { type: 'i128' }),
      tx,
      ...over,
    });
  /** A real tip: both events of one `rewards.tip` transaction. */
  const tip = (to: string, amount: bigint, tx: string) => [
    tipped(to, amount, tx),
    transfer(to, amount, tx),
  ];
  /** `reputation` emits `('vouch', 'claimed') · (id, from, claimer)`. */
  const claim = (n: number, from: string, claimer: string) => ({
    value: nativeToScVal([n, from, claimer]),
    ledgerClosedAt: new Date().toISOString(),
  });
  const page = (list: unknown[]) =>
    ({ events: list, cursor: undefined }) as unknown as rpc.Api.GetEventsResponse;
  const UNFROZEN = sim(nativeToScVal(false));
  const FROZEN = sim(nativeToScVal(true));

  let events: MockInstance<rpc.Server['getEvents']>;
  /** Serve the tip scan (rewards + USDC filters) and the vouch scan (reputation) apart. */
  function chain(tips: unknown[], claims: unknown[] = []) {
    events.mockImplementation(async (req) => {
      const [first] = (req as { filters: { contractIds: string[] }[] }).filters;
      return page(first.contractIds[0] === REWARDS_CONTRACT ? tips : claims);
    });
  }
  const scans = () =>
    events.mock.calls.map(([req]) =>
      (req as { filters: { contractIds: string[] }[] }).filters.map((f) => f.contractIds[0]),
    );
  /** The wallets `is_frozen` was asked about, in order. */
  const frozenAsked = () =>
    simulateSpy.mock.calls
      .map(
        ([tx]) =>
          (tx as unknown as { operations: { func: xdr.HostFunction }[] }).operations[0].func,
      )
      .filter((f) => f.invokeContract().functionName().toString() === 'is_frozen')
      .map((f) => scValToNative(f.invokeContract().args()[0]) as string);

  async function claimQuest(evidence: Record<string, unknown> = FIRST_TIP) {
    const res = await attest({ questId: QUEST, evidence });
    const body = (await res.json()) as {
      error?: string;
      sig?: string;
      expiresAt?: number;
      retryable?: boolean;
    };
    return { status: res.status, body };
  }
  const verifies = (body: { sig?: string; expiresAt?: number }) =>
    ATTESTER.verify(
      questPayload(ctx, QUEST, RECIPIENT, body.expiresAt!),
      Buffer.from(body.sig ?? '', 'base64'),
    );

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_REWARDS_CONTRACT_ID', REWARDS_CONTRACT);
    vi.stubEnv('NEXT_PUBLIC_USDC_SAC_ID', USDC_SAC);
    vi.stubEnv('NEXT_PUBLIC_FIRST_TIP_QUEST_ID', String(QUEST));
    vi.spyOn(rpc.Server.prototype, 'getHealth').mockResolvedValue({
      oldestLedger: 1,
    } as unknown as rpc.Api.GetHealthResponse);
    events = vi.spyOn(rpc.Server.prototype, 'getEvents');
    events.mockRejectedValue(new Error('unexpected getEvents'));
    ({ POST } = (await import('./route')) as { POST: Post });
  });

  // ── verifies ────────────────────────────────────────────────────────────

  it('verifies a floor-sized USDC tip to a wallet the recipient vouched for', async () => {
    chain(tip(FRIEND, FLOOR, 'tx1'), [claim(1, RECIPIENT, FRIEND)]);
    simulateSpy
      .mockResolvedValueOnce(oneShot())
      .mockResolvedValueOnce(open())
      .mockResolvedValueOnce(UNFROZEN);

    const { status, body } = await claimQuest();
    expect(status).toBe(200);
    expect(verifies(body)).toBe(true);
    expect(methods()).toEqual(['get_quest_periods', 'is_completed', 'is_frozen']);
    expect(frozenAsked()).toEqual([FRIEND]);
    // One tip scan over the rewards contract and the configured USDC SAC, then one vouch scan.
    expect(scans()).toEqual([[REWARDS_CONTRACT, USDC_SAC], [QUEST_CONTRACT]]);
  });

  it('counts a connection in the other direction: the receiver vouched for the recipient', async () => {
    chain(tip(FRIEND, FLOOR + 1n, 'tx1'), [claim(1, FRIEND, RECIPIENT)]);
    simulateSpy
      .mockResolvedValueOnce(oneShot())
      .mockResolvedValueOnce(open())
      .mockResolvedValueOnce(UNFROZEN);
    const { status, body } = await claimQuest();
    expect(status).toBe(200);
    expect(verifies(body)).toBe(true);
  });

  it('passes on a later qualifying tip after earlier ones that do not count', async () => {
    chain(
      [
        ...tip(OTHER, FLOOR, 'tx1'),
        ...tip(FRIEND, FLOOR - 1n, 'tx2'),
        ...tip(FRIEND, FLOOR, 'tx3'),
      ],
      [claim(1, RECIPIENT, FRIEND)],
    );
    simulateSpy
      .mockResolvedValueOnce(oneShot())
      .mockResolvedValueOnce(open())
      .mockResolvedValueOnce(UNFROZEN);
    const { status } = await claimQuest();
    expect(status).toBe(200);
    expect(frozenAsked()).toEqual([FRIEND]); // the unconnected and sub-floor tips cost no read
  });

  // ── the tip comes off the chain, never from the request ─────────────────

  it('ignores whatever the request puts in evidence.ref', async () => {
    chain([]); // the chain has no tip at all
    simulateSpy.mockResolvedValueOnce(oneShot()).mockResolvedValueOnce(open());
    const { status, body } = await claimQuest({ type: 'first_tip', ref: FRIEND });
    expect(status).toBe(422);
    expect(body.error).toMatch(/haven’t tipped anyone/);
    expect(body.sig).toBeUndefined();
    expect(scans()).toEqual([[REWARDS_CONTRACT, USDC_SAC]]);
  });

  it('refuses someone else’s tip, even when the RPC returns it for this sender', async () => {
    chain(
      [
        tipped(FRIEND, FLOOR, 'tx1', { from: OTHER }),
        transfer(FRIEND, FLOOR, 'tx1', { from: OTHER }),
      ],
      [claim(1, RECIPIENT, FRIEND)],
    );
    simulateSpy.mockResolvedValueOnce(oneShot()).mockResolvedValueOnce(open());
    const { status, body } = await claimQuest();
    expect(status).toBe(422);
    expect(body.error).toMatch(/haven’t tipped anyone/);
    expect(frozenAsked()).toEqual([]);
  });

  it('refuses a `tipped` event from any contract but the configured rewards one', async () => {
    const FAKE = StrKey.encodeContract(Buffer.alloc(32, 13));
    chain(
      [tipped(FRIEND, FLOOR, 'tx1', { contract: FAKE }), transfer(FRIEND, FLOOR, 'tx1')],
      [claim(1, RECIPIENT, FRIEND)],
    );
    simulateSpy.mockResolvedValueOnce(oneShot()).mockResolvedValueOnce(open());
    const { status, body } = await claimQuest();
    expect(status).toBe(422);
    expect(body.error).toMatch(/haven’t tipped anyone/);
  });

  it('skips an event from a failed contract call', async () => {
    chain(
      [tipped(FRIEND, FLOOR, 'tx1', { ok: false }), transfer(FRIEND, FLOOR, 'tx1', { ok: false })],
      [claim(1, RECIPIENT, FRIEND)],
    );
    simulateSpy.mockResolvedValueOnce(oneShot()).mockResolvedValueOnce(open());
    const { status, body } = await claimQuest();
    expect(status).toBe(422);
    expect(body.error).toMatch(/haven’t tipped anyone/);
  });

  // ── the tip moved the configured USDC ───────────────────────────────────

  it('refuses a tip whose transaction moved no USDC through the configured SAC', async () => {
    const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 14));
    const cases = [
      [tipped(FRIEND, FLOOR, 'tx1')], // no SAC transfer at all
      [tipped(FRIEND, FLOOR, 'tx1'), transfer(FRIEND, FLOOR, 'tx1', { contract: TOKEN })], // another token
      [tipped(FRIEND, FLOOR, 'tx1'), transfer(FRIEND, FLOOR, 'tx2')], // another transaction
      [tipped(FRIEND, FLOOR, 'tx1'), transfer(FRIEND, 1n, 'tx1')], // another amount
      [tipped(FRIEND, FLOOR, 'tx1'), transfer(OTHER, FLOOR, 'tx1')], // another receiver
    ];
    for (const tips of cases) {
      chain(tips, [claim(1, RECIPIENT, FRIEND)]);
      simulateSpy.mockResolvedValueOnce(oneShot()).mockResolvedValueOnce(open());
      const { status, body } = await claimQuest();
      expect(status).toBe(422);
      expect(body.error).toMatch(/only USDC tips count/);
      expect(body.sig).toBeUndefined();
    }
    expect(frozenAsked()).toEqual([]);
  });

  // ── self, floor, connection, freeze ─────────────────────────────────────

  it('refuses a self-tip (from a rewards contract that predates the on-chain rule)', async () => {
    chain(tip(RECIPIENT, FLOOR, 'tx1'), [claim(1, RECIPIENT, RECIPIENT)]);
    simulateSpy.mockResolvedValueOnce(oneShot()).mockResolvedValueOnce(open());
    const { status, body } = await claimQuest();
    expect(status).toBe(422);
    expect(body.error).toBe('a tip to your own wallet doesn’t count');
  });

  it('refuses a tip below the floor (0.5 USDC), with the floor as the reason', async () => {
    chain(tip(FRIEND, FLOOR - 1n, 'tx1'), [claim(1, RECIPIENT, FRIEND)]);
    simulateSpy.mockResolvedValueOnce(oneShot()).mockResolvedValueOnce(open());
    const { status, body } = await claimQuest();
    expect(status).toBe(422);
    expect(body.error).toMatch(/tip at least 0\.5 USDC/);
    expect(scans()).toEqual([[REWARDS_CONTRACT, USDC_SAC]]); // no vouch scan for it
  });

  it('refuses a tip to a wallet that shares no claimed vouch with the recipient', async () => {
    for (const claims of [
      [],
      [claim(1, FRIEND, OTHER)],
      [claim(1, OTHER, FRIEND)],
      [claim(1, RECIPIENT, OTHER)],
    ]) {
      chain(tip(FRIEND, FLOOR, 'tx1'), claims);
      simulateSpy.mockResolvedValueOnce(oneShot()).mockResolvedValueOnce(open());
      const { status, body } = await claimQuest();
      expect(status).toBe(422);
      expect(body.error).toMatch(/tip someone you’re connected to/);
    }
    expect(frozenAsked()).toEqual([]);
  });

  it('refuses a tip to a frozen wallet', async () => {
    chain(tip(FRIEND, FLOOR, 'tx1'), [claim(1, RECIPIENT, FRIEND)]);
    simulateSpy
      .mockResolvedValueOnce(oneShot())
      .mockResolvedValueOnce(open())
      .mockResolvedValueOnce(FROZEN);
    const { status, body } = await claimQuest();
    expect(status).toBe(422);
    expect(body.error).toMatch(/frozen/);
  });

  // ── one tip, one award ──────────────────────────────────────────────────

  it('stops a recipient who already completed the quest before reading any tip', async () => {
    chain(tip(FRIEND, FLOOR, 'tx1'), [claim(1, RECIPIENT, FRIEND)]);
    simulateSpy.mockResolvedValueOnce(oneShot()).mockResolvedValueOnce(completed(true));
    const { status, body } = await claimQuest();
    expect(status).toBe(409);
    expect(body.sig).toBeUndefined();
    expect(events).not.toHaveBeenCalled();
  });

  it('refuses a repeatable first-tip quest, so one tip cannot pay every period', async () => {
    simulateSpy.mockResolvedValueOnce(period(WEEK_SECS));
    const { status, body } = await claimQuest();
    expect(status).toBe(422);
    expect(body.error).toMatch(/a first tip only counts once/);
    expect(events).not.toHaveBeenCalled();
  });

  it('binds first_tip to its own quest id only', async () => {
    const other = await attest({ questId: 4, evidence: FIRST_TIP });
    expect(other.status).toBe(422);
    expect(await other.json()).toEqual({ error: 'evidence type does not match this quest' });
    const swapped = await attest({ questId: QUEST, evidence: { type: 'vouch_back', ref: '' } });
    expect(swapped.status).toBe(422);
    expectNoNetwork();
    expect(events).not.toHaveBeenCalled();
  });

  // ── failures ────────────────────────────────────────────────────────────

  it('answers a failed tip or vouch scan with a retryable 503, not a verdict', async () => {
    events.mockRejectedValueOnce(new Error('rpc down'));
    simulateSpy.mockResolvedValueOnce(oneShot()).mockResolvedValueOnce(open());
    const scan = await claimQuest();
    expect(scan.status).toBe(503);
    expect(scan.body).toEqual({
      error: 'couldn’t read your tips right now — try again',
      retryable: true,
    });

    events
      .mockResolvedValueOnce(page(tip(FRIEND, FLOOR, 'tx1')))
      .mockRejectedValueOnce(new Error('rpc down'));
    simulateSpy.mockResolvedValueOnce(oneShot()).mockResolvedValueOnce(open());
    const vouches = await claimQuest();
    expect(vouches.status).toBe(503);
    expect(vouches.body.sig).toBeUndefined();
  });

  it('never takes a freeze status it could not read as unfrozen', async () => {
    for (const reply of [simError('HostError: boom'), sim(undefined)]) {
      chain(tip(FRIEND, FLOOR, 'tx1'), [claim(1, RECIPIENT, FRIEND)]);
      simulateSpy
        .mockResolvedValueOnce(oneShot())
        .mockResolvedValueOnce(open())
        .mockResolvedValueOnce(reply);
      const { status, body } = await claimQuest();
      expect(status).toBe(503);
      expect(body.retryable).toBe(true);
      expect(body.sig).toBeUndefined();
    }
  });

  it('refuses to verify while the USDC SAC id is not configured', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_USDC_SAC_ID', '');
    ({ POST } = (await import('./route')) as { POST: Post });
    simulateSpy.mockResolvedValueOnce(oneShot()).mockResolvedValueOnce(open());
    const { status, body } = await claimQuest();
    expect(status).toBe(422);
    expect(body.error).toBe('USDC contract not configured');
    expect(events).not.toHaveBeenCalled();
  });
});
