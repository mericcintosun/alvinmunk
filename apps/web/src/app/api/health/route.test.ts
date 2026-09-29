import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { GET } from './route';
import { rpc } from '@stellar/stellar-sdk';

vi.mock('@stellar/stellar-sdk', () => {
  return {
    rpc: {
      Server: vi.fn(),
    },
  };
});

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

describe('/api/health', () => {
  let envBak: NodeJS.ProcessEnv;

  beforeEach(() => {
    envBak = { ...process.env };
    process.env.NEXT_PUBLIC_REWARDS_CONTRACT_ID = 'C...';
  });

  afterEach(() => {
    process.env = envBak;
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
});
