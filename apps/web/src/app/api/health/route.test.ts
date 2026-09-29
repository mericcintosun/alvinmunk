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

  it('returns 200 ok when healthy', async () => {
    const getHealthMock = vi.fn().mockResolvedValue({
      status: 'healthy',
      latestLedger: 100,
      ledgerRetentionWindow: 20000,
    });
    vi.mocked(rpc.Server).mockImplementation(() => {
      return { getHealth: getHealthMock } as any;
    });

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
    vi.mocked(rpc.Server).mockImplementation(() => {
      return { getHealth: getHealthMock } as any;
    });

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
    vi.mocked(rpc.Server).mockImplementation(() => {
      return { getHealth: getHealthMock } as any;
    });

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.rpc).toBe('unhealthy');
  });

  it('returns 503 on timeout', async () => {
    vi.useFakeTimers();
    const getHealthMock = vi.fn().mockImplementation(() => {
      return new Promise((resolve) => setTimeout(resolve, 10000));
    });
    vi.mocked(rpc.Server).mockImplementation(() => {
      return { getHealth: getHealthMock } as any;
    });

    const promise = GET();
    vi.advanceTimersByTime(6000);
    
    const res = await promise;
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.rpc).toBe('timeout');
    vi.useRealTimers();
  });
});
