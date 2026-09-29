// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { Keypair, Networks, StrKey, rpc } from '@stellar/stellar-sdk';
import { QUEST_SIG_TTL_SECS, questPayload } from '../../../lib/attest';

// POST /api/attest must refuse to sign a quest id for any evidence type other than the one
// bound to it, and must do so before verifying anything over the network.

const RECIPIENT = Keypair.random().publicKey();
const REFERRED = Keypair.random().publicKey();
const QUEST_CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 7));
const ATTESTER = Keypair.random();

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
  // The dashboard defaults: 2 = referral_tx, 3 = invite_converts, 4 = vouch_back; no GitHub quest.
  vi.stubEnv('NEXT_PUBLIC_DEFAULT_QUEST_ID', '');
  vi.stubEnv('NEXT_PUBLIC_INVITE_QUEST_ID', '');
  vi.stubEnv('NEXT_PUBLIC_VOUCHBACK_QUEST_ID', '');
  vi.stubEnv('QUEST_GITHUB_ID', '');
  fetchSpy = vi.fn(async () => new Response('{}', { status: 404 }));
  vi.stubGlobal('fetch', fetchSpy);
  simulateSpy = vi.spyOn(rpc.Server.prototype, 'simulateTransaction');
  ledgerSpy = vi.spyOn(rpc.Server.prototype, 'getLatestLedger');
  ({ POST } = (await import('./route')) as { POST: Post });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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
    const res = await attest({ questId: 2, evidence: { type: 'referral_tx', ref: REFERRED } });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'referred account not found on-chain' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain(`/accounts/${REFERRED}`);
  });

  it('signs the bound quest once its evidence verifies', async () => {
    const marker = Buffer.from(RECIPIENT, 'utf8').toString('base64');
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { referral: marker } }), { status: 200 }),
    );
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
    expect(simulateSpy).not.toHaveBeenCalled();
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
