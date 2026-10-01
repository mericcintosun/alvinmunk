// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NETWORKS } from '@alvinmunk/sdk';

const deployment = vi.hoisted(() => ({ network: 'mainnet' }));
vi.mock('./stellar', () => ({ config: deployment }));

async function load() {
  vi.resetModules();
  return import('./read-network');
}

describe('readNetworkFor', () => {
  beforeEach(() => {
    deployment.network = 'mainnet';
  });
  afterEach(() => vi.unstubAllEnvs());

  it('reads the built-in testnet deployment for ?network=testnet on a mainnet deployment', async () => {
    const { readNetworkFor } = await load();
    const net = readNetworkFor('testnet')!;
    expect(net).toMatchObject({
      network: 'testnet',
      networkPassphrase: NETWORKS.testnet.passphrase,
      rpcUrl: NETWORKS.testnet.rpcUrl,
      contracts: {
        reputation: NETWORKS.testnet.contracts.reputation,
        registry: NETWORKS.testnet.contracts.registry,
      },
    });
    // Its SDK client reads the same deployment, never the mainnet one.
    expect(net.client).toMatchObject({
      network: 'testnet',
      networkPassphrase: NETWORKS.testnet.passphrase,
      rpcUrl: NETWORKS.testnet.rpcUrl,
    });
    expect(net.client.contracts.reputation).toBe(NETWORKS.testnet.contracts.reputation);
  });

  it('is one shared instance, so pages can use it as an effect dependency', async () => {
    const { readNetworkFor } = await load();
    expect(readNetworkFor('testnet')).toBe(readNetworkFor(' TestNet '));
    expect(readNetworkFor(['testnet', 'mainnet'])).toBe(readNetworkFor('testnet'));
  });

  it.each([undefined, null, '', 'mainnet', 'futurenet', 'testnet2'])(
    'is no override for %s',
    async (param) => {
      const { readNetworkFor } = await load();
      expect(readNetworkFor(param)).toBeNull();
    },
  );

  it('is no override on a testnet deployment, so the same link works before the cutover', async () => {
    deployment.network = 'testnet';
    const { readNetworkFor } = await load();
    expect(readNetworkFor('testnet')).toBeNull();
  });

  it('takes pinned testnet ids and RPC from NEXT_PUBLIC_TESTNET_*', async () => {
    vi.stubEnv('NEXT_PUBLIC_TESTNET_RPC_URL', 'https://testnet-rpc.example.com');
    vi.stubEnv('NEXT_PUBLIC_TESTNET_REPUTATION_CONTRACT_ID', 'CPINNEDREP');
    vi.stubEnv('NEXT_PUBLIC_TESTNET_REGISTRY_CONTRACT_ID', ' CPINNEDREG ');
    const { readNetworkFor } = await load();
    const net = readNetworkFor('testnet')!;
    expect(net.rpcUrl).toBe('https://testnet-rpc.example.com');
    expect(net.contracts).toEqual({ reputation: 'CPINNEDREP', registry: 'CPINNEDREG' });
    expect(net.client.contracts).toMatchObject({ reputation: 'CPINNEDREP', registry: 'CPINNEDREG' });
  });
});

describe('isReadOnlyView / withReadNetwork', () => {
  beforeEach(() => {
    deployment.network = 'mainnet';
  });

  it.each([
    ['/u/alice', true],
    ['/score/GABC', true],
    ['/leaderboard', true],
    ['/leaderboard/', true],
    ['/app', false],
    ['/app/rewards', false],
    ['/claim/7', false],
    ['/u/alice/edit', false],
  ])('%s with ?network=testnet is read-only: %s', async (path, expected) => {
    const { isReadOnlyView } = await load();
    expect(isReadOnlyView(path, 'testnet')).toBe(expected);
    expect(isReadOnlyView(path, null)).toBe(false);
  });

  it('keeps the override on links and share URLs, and only then', async () => {
    const { readNetworkFor, withReadNetwork } = await load();
    expect(withReadNetwork('/leaderboard', readNetworkFor('testnet'))).toBe('/leaderboard?network=testnet');
    expect(withReadNetwork('/leaderboard', null)).toBe('/leaderboard');
  });
});
