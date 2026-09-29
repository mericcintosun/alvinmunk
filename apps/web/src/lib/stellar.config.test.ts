// @vitest-environment node
// (server-side behaviour: no `window`, so lib/stellar logs a bad config the way a route would)
/**
 * One resolved network config for the client and every server route (issue #289): lib/stellar
 * resolves and validates it once, and nothing that signs or submits runs on an inconsistent
 * one — no wallet is handed out, and the attester and faucet answer 503 with the reasons.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PASSPHRASE } from '@alvinmunk/shared';

const ID = 'C'.padEnd(56, 'A');
const G = 'G'.padEnd(56, 'A');

/** A fully-wired mainnet config whose RPC was left on testnet — a half-applied cutover. */
const HALF_CUTOVER = {
  NEXT_PUBLIC_STELLAR_NETWORK: 'mainnet',
  NEXT_PUBLIC_RPC_URL: 'https://soroban-testnet.stellar.org',
  NEXT_PUBLIC_HORIZON_URL: 'https://horizon.stellar.org',
  NEXT_PUBLIC_NETWORK_PASSPHRASE: PASSPHRASE.mainnet,
  NEXT_PUBLIC_REPUTATION_CONTRACT_ID: ID,
  NEXT_PUBLIC_QUEST_REGISTRY_CONTRACT_ID: ID,
  NEXT_PUBLIC_REWARDS_CONTRACT_ID: ID,
  NEXT_PUBLIC_USDC_SAC_ID: ID,
  NEXT_PUBLIC_REGISTRY_CONTRACT_ID: ID,
  NEXT_PUBLIC_GATE_CONTRACT_ID: ID,
};
const REASON =
  'NEXT_PUBLIC_RPC_URL points at testnet, but the network is mainnet: https://soroban-testnet.stellar.org';

/** Evaluate a module afresh under `env`, as a new deployment would. */
async function loadWith<T>(env: Record<string, string>, path: string): Promise<T> {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return (await import(/* @vite-ignore */ path)) as T;
}
type Stellar = typeof import('./stellar');

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('lib/stellar — the resolved config', () => {
  it('is consistent for the testnet defaults, and blocks nothing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = await loadWith<Stellar>({ NEXT_PUBLIC_STELLAR_NETWORK: 'testnet' }, './stellar');

    expect(s.configErrors).toEqual([]);
    expect(s.networkPassphrase).toBe(PASSPHRASE.testnet);
    expect(() => s.assertNetworkConfig()).not.toThrow();
    expect(s.misconfiguredResponse()).toBeNull();
    expect(error).not.toHaveBeenCalled();
  });

  it('reports a half-applied cutover, logs it on the server, and refuses to go on', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = await loadWith<Stellar>(HALF_CUTOVER, './stellar');

    expect(s.configErrors).toEqual([REASON]);
    expect(error).toHaveBeenCalledWith(`[config] inconsistent network config: ${REASON}`);
    expect(() => s.assertNetworkConfig()).toThrow(`This deployment is misconfigured, so nothing can be sent: ${REASON}`);

    const res = s.misconfiguredResponse()!;
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'network config is inconsistent', configErrors: [REASON] });
  });

  it('signs with the configured passphrase override — and flags one that disagrees', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = await loadWith<Stellar>(
      { NEXT_PUBLIC_STELLAR_NETWORK: 'testnet', NEXT_PUBLIC_NETWORK_PASSPHRASE: PASSPHRASE.mainnet },
      './stellar',
    );

    expect(s.networkPassphrase).toBe(PASSPHRASE.mainnet);
    expect(s.configErrors).toEqual([
      `NEXT_PUBLIC_NETWORK_PASSPHRASE is the mainnet passphrase, but the network is testnet ("${PASSPHRASE.testnet}")`,
    ]);
  });
});

describe('on an inconsistent config', () => {
  it('hands out no wallet — and funds none on the wrong network', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const wallet = await loadWith<typeof import('./wallet')>(HALF_CUTOVER, './wallet');
    const kit = (await import('./wallet-kit')) as typeof import('./wallet-kit');

    for (const connect of [wallet.getWallet, wallet.connectFreighter, wallet.connectAlbedo, kit.connectViaKit]) {
      await expect(connect()).rejects.toThrow(/^This deployment is misconfigured/);
    }
    expect(fetchMock).not.toHaveBeenCalled(); // no Friendbot, no relayer
  });

  it.each([
    ['/api/attest', '@/app/api/attest/route'],
    ['/api/faucet', '@/app/api/faucet/route'],
  ])('%s answers 503 with the reasons before doing anything', async (url, path) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('ATTESTER_SECRET_KEY', 'S'.padEnd(56, 'A'));
    vi.stubEnv('USDC_ISSUER_SECRET_KEY', 'S'.padEnd(56, 'A'));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const route = await loadWith<{ POST: (req: Request) => Promise<Response> }>(HALF_CUTOVER, path);

    const res = await route.POST(
      new Request(`http://localhost${url}`, { method: 'POST', body: JSON.stringify({ recipient: G }) }),
    );

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'network config is inconsistent', configErrors: [REASON] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
