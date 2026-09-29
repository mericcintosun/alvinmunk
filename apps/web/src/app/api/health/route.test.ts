import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getLatestLedgerMock, state } = vi.hoisted(() => ({
  getLatestLedgerMock: vi.fn(),
  state: { configErrors: [] as string[] },
}));

vi.mock('@stellar/stellar-sdk', () => ({
  rpc: {
    Server: class {
      getLatestLedger(...args: unknown[]) {
        return getLatestLedgerMock(...args);
      }
    },
  },
}));

// Same specifier the route imports, so it is intercepted for sure. `configErrors` is a
// live getter so each test can change the resolved config's problems.
vi.mock('../../../lib/stellar', () => ({
  config: {
    network: 'mainnet',
    rpcUrl: 'https://mainnet.sorobanrpc.com',
    horizonUrl: 'https://horizon.stellar.org',
    networkPassphrase: 'Public Global Stellar Network ; September 2015',
    contracts: {
      reputation: 'CREP',
      questRegistry: 'CQUEST',
      rewards: 'CREWARDS',
      usdcSac: 'CUSDC',
      registry: 'CREGISTRY',
      gate: 'CGATE',
    },
  },
  get configErrors() {
    return state.configErrors;
  },
}));

import { GET } from './route';

describe('/api/health', () => {
  beforeEach(() => {
    getLatestLedgerMock.mockReset().mockResolvedValue({ sequence: 42 });
    state.configErrors = [];
  });

  it('returns 200 when the config is healthy and RPC is reachable', async () => {
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.configErrors).toEqual([]);
    expect(body.rpcOk).toBe(true);
    expect(body.latestLedger).toBe(42);
  });

  it('returns 503 with the specific reasons when the config is mixed', async () => {
    state.configErrors = [
      'network passphrase does not match mainnet: got "Test SDF Network ; September 2015", expected "Public Global Stellar Network ; September 2015"',
      'rpcUrl still points at testnet on mainnet: https://soroban-testnet.stellar.org',
    ];
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.configErrors).toHaveLength(2);
    expect(body.configErrors[0]).toContain('passphrase');
    expect(body.configErrors[1]).toContain('rpcUrl');
  });

  it('returns 503 when RPC is unreachable even if the config is fine', async () => {
    getLatestLedgerMock.mockRejectedValue(new Error('rpc down'));
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.rpcOk).toBe(false);
    expect(body.configErrors).toEqual([]);
  });
});
