import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { rpc } from '@stellar/stellar-sdk';

const { state } = vi.hoisted(() => ({
  state: {
    configErrors: [] as string[],
    config: {
      network: 'testnet',
      rpcUrl: 'https://rpc.test',
      contracts: { reputation: 'CREP', questRegistry: 'CQUEST', rewards: 'CREWARDS' },
    },
  },
}));

vi.mock('@stellar/stellar-sdk', () => {
  return {
    rpc: {
      Server: vi.fn(),
    },
  };
});

// The route reads the app's one resolved config; each test can change it (live getters).
vi.mock('../../../lib/stellar', () => ({
  get config() {
    return state.config;
  },
  get configErrors() {
    return state.configErrors;
  },
}));

import { GET } from './route';

/** A `getLatestLedger()` response whose ledger closed `ageSeconds` ago. */
function freshLatestLedger(ageSeconds = 0) {
  return {
    id: 'abc',
    sequence: 100,
    protocolVersion: '21',
    closeTime: String(Math.floor(Date.now() / 1000) - ageSeconds),
  };
}

function mockServer(getHealth: ReturnType<typeof vi.fn>, getLatestLedger: ReturnType<typeof vi.fn>) {
  vi.mocked(rpc.Server).mockImplementation(() => {
    return { getHealth, getLatestLedger } as unknown as InstanceType<typeof rpc.Server>;
  });
}

/** An RPC that is up, fresh and keeps a long enough history. */
function healthyRpc() {
  mockServer(
    vi.fn().mockResolvedValue({ status: 'healthy', latestLedger: 100, ledgerRetentionWindow: 20000 }),
    vi.fn().mockResolvedValue(freshLatestLedger(2)),
  );
}

describe('/api/health', () => {
  beforeEach(() => {
    state.configErrors = [];
    state.config.contracts.rewards = 'CREWARDS';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 200 ok when healthy and fresh', async () => {
    const getHealthMock = vi.fn().mockResolvedValue({
      status: 'healthy',
      latestLedger: 100,
      ledgerRetentionWindow: 20000,
    });
    const getLatestLedgerMock = vi.fn().mockResolvedValue(freshLatestLedger(2));
    mockServer(getHealthMock, getLatestLedgerMock);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.rpc).toBe('ok');
    expect(body.latestLedger).toBe(100);
    expect(body.ledgerRetentionWindow).toBe(20000);
    expect(body.rpcWarning).toBeUndefined();
  });

  it('adds warning when retention is too small', async () => {
    const getHealthMock = vi.fn().mockResolvedValue({
      status: 'healthy',
      latestLedger: 100,
      ledgerRetentionWindow: 100,
    });
    const getLatestLedgerMock = vi.fn().mockResolvedValue(freshLatestLedger(2));
    mockServer(getHealthMock, getLatestLedgerMock);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.rpcWarning).toMatch(/RPC retention window \(100\) is smaller than required \(17280\)/);
  });

  it('returns 503 when unhealthy', async () => {
    const getHealthMock = vi.fn().mockResolvedValue({
      status: 'unhealthy',
    });
    const getLatestLedgerMock = vi.fn().mockResolvedValue(freshLatestLedger(2));
    mockServer(getHealthMock, getLatestLedgerMock);

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.rpc).toBe('unhealthy');
  });

  it('returns 503 within the timeout bound when the RPC never responds', async () => {
    vi.useFakeTimers();
    const neverResolves = vi.fn().mockImplementation(() => new Promise(() => {}));
    mockServer(neverResolves, neverResolves);

    const promise = GET();
    // Well past the 5s bound the probe promises, but the promise above never
    // resolves on its own — if the race weren't wired to the RPC calls, this
    // would hang forever instead of settling here.
    await vi.advanceTimersByTimeAsync(6000);

    const res = await promise;
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.rpc).toBe('timeout');
    vi.useRealTimers();
  });

  it('returns 503 when the RPC responds but the latest ledger is stale (stalled ingestion)', async () => {
    const getHealthMock = vi.fn().mockResolvedValue({
      status: 'healthy',
      latestLedger: 100,
      ledgerRetentionWindow: 20000,
    });
    // The RPC answers successfully, but the ledger it reports closed 10
    // minutes ago — well past MAX_LEDGER_AGE_SECONDS, so ingestion is stalled.
    const getLatestLedgerMock = vi.fn().mockResolvedValue(freshLatestLedger(600));
    mockServer(getHealthMock, getLatestLedgerMock);

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.rpc).toBe('stalled');
    expect(body.rpcWarning).toMatch(/stalled/i);
  });

  it('clears the timeout timer once the RPC responds, so it never fires later', async () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    const getHealthMock = vi.fn().mockResolvedValue({
      status: 'healthy',
      latestLedger: 100,
      ledgerRetentionWindow: 20000,
    });
    const getLatestLedgerMock = vi.fn().mockResolvedValue(freshLatestLedger(2));
    mockServer(getHealthMock, getLatestLedgerMock);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(clearTimeoutSpy).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('probes the RPC of the resolved config', async () => {
    healthyRpc();
    await GET();
    expect(rpc.Server).toHaveBeenCalledWith('https://rpc.test', { allowHttp: false });
  });

  it('returns 503 with each specific reason when the network config is mixed', async () => {
    healthyRpc();
    state.configErrors = [
      'NEXT_PUBLIC_NETWORK_PASSPHRASE is the testnet passphrase, but the network is mainnet',
      'NEXT_PUBLIC_RPC_URL points at testnet, but the network is mainnet: https://soroban-testnet.stellar.org',
    ];

    const res = await GET();

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.rpc).toBe('ok'); // the RPC is fine — the config alone fails the probe
    expect(body.configErrors).toEqual(state.configErrors);
  });

  it('reports an empty configErrors list when the config is consistent', async () => {
    healthyRpc();
    const body = await (await GET()).json();
    expect(body.configErrors).toEqual([]);
    expect(body.network).toBe('testnet');
  });

  it('still returns 503 without a rewards contract id', async () => {
    healthyRpc();
    state.config.contracts.rewards = '';
    const res = await GET();
    expect(res.status).toBe(503);
    expect((await res.json()).contracts.rewards).toBeNull();
  });
});
