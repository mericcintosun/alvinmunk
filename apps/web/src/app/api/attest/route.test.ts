// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { Address, Keypair, StrKey, nativeToScVal, rpc } from '@stellar/stellar-sdk';

// POST /api/attest must refuse to sign a quest id for any evidence type other than the one
// bound to it, and must do so before verifying anything over the network.

const RECIPIENT = Keypair.random().publicKey();
const REFERRED = Keypair.random().publicKey();
const QUEST_CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 7));
const REGISTRY_CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 9));
const PASSKEY_REFERRED = StrKey.encodeContract(Buffer.alloc(32, 3));

/** One simulation reply: a view's return value, or a simulation error. */
const sim = (retval: unknown) =>
  ({ result: { retval } }) as unknown as rpc.Api.SimulateTransactionResponse;
const simError = (error: string) => ({ error }) as unknown as rpc.Api.SimulateTransactionResponse;
const score = (n: number) => sim(nativeToScVal(n, { type: 'u64' }));
const address = (a: string) => sim(new Address(a).toScVal());
const payload = () => sim(nativeToScVal(Buffer.from('payload')));

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
  vi.stubEnv('ATTESTER_SECRET_KEY', Keypair.random().secret());
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
    simulateSpy.mockResolvedValueOnce(score(5));
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
    simulateSpy.mockResolvedValueOnce(score(5)).mockResolvedValueOnce(payload());
    const res = await attest({ questId: 2, evidence: { type: 'referral_tx', ref: REFERRED } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; questId: number; sig: string };
    expect(body.ok).toBe(true);
    expect(body.questId).toBe(2);
    expect(body.sig).toBeTruthy();
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

  const methods = () =>
    simulateSpy.mock.calls.map(([tx]) => {
      const op = (tx as unknown as { operations: { func: { invokeContract(): { functionName(): Buffer } } }[] })
        .operations[0];
      return op.func.invokeContract().functionName().toString();
    });

  it('signs for a passkey account whose binding names the recipient, without Horizon', async () => {
    simulateSpy
      .mockResolvedValueOnce(score(5))
      .mockResolvedValueOnce(address(RECIPIENT))
      .mockResolvedValueOnce(payload());
    const res = await attest({ questId: 2, evidence: { type: 'referral_tx', ref: PASSKEY_REFERRED } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { sig: string }).sig).toBeTruthy();
    expect(methods()).toEqual(['get_score', 'invited_by', 'quest_payload']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a binding to a different inviter, even with a matching manageData marker', async () => {
    const marker = Buffer.from(RECIPIENT, 'utf8').toString('base64');
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ data: { referral: marker } })));
    simulateSpy
      .mockResolvedValueOnce(score(5))
      .mockResolvedValueOnce(address(Keypair.random().publicKey()));
    const res = await attest({ questId: 2, evidence: { type: 'referral_tx', ref: REFERRED } });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'that wallet was invited by a different account' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('gives an empty account bound to the recipient nothing', async () => {
    simulateSpy.mockResolvedValueOnce(score(0)).mockResolvedValueOnce(address(RECIPIENT));
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
      .mockResolvedValueOnce(score(5))
      .mockResolvedValueOnce(
        simError('HostError: Error(WasmVm, MissingValue) trying to invoke non-existent contract function'),
      )
      .mockResolvedValueOnce(payload());
    const res = await attest({ questId: 2, evidence: { type: 'referral_tx', ref: REFERRED } });
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('refuses rather than falling back when the registry read fails', async () => {
    const marker = Buffer.from(RECIPIENT, 'utf8').toString('base64');
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ data: { referral: marker } })));
    simulateSpy.mockResolvedValueOnce(score(5)).mockResolvedValueOnce(simError('rpc overloaded'));
    const res = await attest({ questId: 2, evidence: { type: 'referral_tx', ref: REFERRED } });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: 'couldn’t read who invited that wallet right now — try again',
    });
  });
});
