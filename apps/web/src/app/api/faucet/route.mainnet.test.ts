// @vitest-environment node
/**
 * The faucet's mainnet hard-disable, driven from the real env (#181). route.test.ts mocks
 * lib/stellar, so it cannot notice a typo in the env name or in the `=== 'mainnet'`
 * comparison. Here nothing but the Stellar clients is stubbed: each test sets env with
 * vi.stubEnv, then resets modules and imports the route, so the module-level IS_MAINNET is
 * read from NEXT_PUBLIC_STELLAR_NETWORK the way a deploy reads it. docs/DEPLOY_MAINNET.md
 * relies on this guard.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@stellar/stellar-sdk')>();
  // `new …Server(...)`: the implementation is constructed, so it must be a `function`.
  return {
    ...actual,
    rpc: { ...actual.rpc, Server: vi.fn().mockImplementation(function () { return {}; }) },
    Horizon: { ...actual.Horizon, Server: vi.fn().mockImplementation(function () { return {}; }) },
  };
});

const G_ADDR = 'GC4TEBCIRYGH7Z4JWPE4YGKNQ5MXXQFNK4KZTDXWVDKAFQOK7Z4JZPO6';
const C_ADDR = 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526';
const ISSUER_SECRET = 'SCPN4CXC2SYVU2C7MOR3X34IPREMYGLWMA7PQSVGIGWTNLOGIHADBT6H';

/** A complete, consistent mainnet config, so the 503 misconfiguration guard stays out of the way. */
const MAINNET_ENV: Record<string, string> = {
  NEXT_PUBLIC_STELLAR_NETWORK: 'mainnet',
  NEXT_PUBLIC_NETWORK_PASSPHRASE: 'Public Global Stellar Network ; September 2015',
  NEXT_PUBLIC_RPC_URL: 'https://rpc.mainnet.example',
  NEXT_PUBLIC_HORIZON_URL: 'https://horizon.stellar.org',
  NEXT_PUBLIC_REPUTATION_CONTRACT_ID: C_ADDR,
  NEXT_PUBLIC_QUEST_REGISTRY_CONTRACT_ID: C_ADDR,
  NEXT_PUBLIC_REWARDS_CONTRACT_ID: C_ADDR,
  NEXT_PUBLIC_USDC_SAC_ID: C_ADDR,
  NEXT_PUBLIC_REGISTRY_CONTRACT_ID: C_ADDR,
  NEXT_PUBLIC_GATE_CONTRACT_ID: C_ADDR,
};

type PostFn = (req: Request) => Promise<Response>;

/** Stub `env`, then import a fresh route so its module-level constants read it. */
async function loadRoute(env: Record<string, string>): Promise<PostFn> {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.resetModules();
  const { POST } = (await import('./route')) as { POST: PostFn };
  // lib/stellar builds its own shared clients at import; only what the route builds counts.
  const sdk = await import('@stellar/stellar-sdk');
  vi.mocked(sdk.rpc.Server).mockClear();
  vi.mocked(sdk.Horizon.Server).mockClear();
  return POST;
}

function makeReq(recipient: string): Request {
  return new Request('http://localhost/api/faucet', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
    body: JSON.stringify({ recipient }),
  });
}

beforeEach(() => {
  delete process.env.USDC_ISSUER_SECRET_KEY;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/faucet on mainnet (real env → config → IS_MAINNET)', () => {
  it('returns 403 for both recipient kinds and constructs no Stellar client', async () => {
    const POST = await loadRoute({ ...MAINNET_ENV, USDC_ISSUER_SECRET_KEY: ISSUER_SECRET });

    for (const recipient of [G_ADDR, C_ADDR]) {
      const res = await POST(makeReq(recipient));
      expect(res.status).toBe(403);
      expect((await res.json()).error).toMatch(/disabled on mainnet/);
    }

    const sdk = await import('@stellar/stellar-sdk');
    expect(sdk.rpc.Server).not.toHaveBeenCalled();
    expect(sdk.Horizon.Server).not.toHaveBeenCalled();
  });

  it('refuses before the issuer secret is read: 403, not the 500 for a missing secret', async () => {
    const POST = await loadRoute(MAINNET_ENV);
    const res = await POST(makeReq(G_ADDR));
    expect(res.status).toBe(403);
  });

  it('refuses a network name that only normalises to mainnet', async () => {
    const POST = await loadRoute({ ...MAINNET_ENV, NEXT_PUBLIC_STELLAR_NETWORK: ' Mainnet ' });
    const res = await POST(makeReq(G_ADDR));
    expect(res.status).toBe(403);
  });

  it('does not refuse on testnet (the same request reaches the secret check)', async () => {
    const POST = await loadRoute({ NEXT_PUBLIC_STELLAR_NETWORK: 'testnet' });
    const res = await POST(makeReq(G_ADDR));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/USDC_ISSUER_SECRET_KEY/);
  });
});
