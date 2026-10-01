// @vitest-environment node
/**
 * GET /api/stats caching (#175): a scan is shared by concurrent requests and reused for 30 s,
 * and the response is cacheable by the CDN for the same window.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Address, Keypair, rpc, xdr } from '@stellar/stellar-sdk';

vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@stellar/stellar-sdk')>();
  return { ...actual, rpc: { ...actual.rpc, Server: vi.fn() } };
});

// The funnel has its own cache and storage reads; keep it out of the scan count.
vi.mock('@/lib/vouch-funnel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/vouch-funnel')>();
  return { ...actual, readVouchRecords: vi.fn().mockResolvedValue({ total: 0, records: [] }) };
});

// Mutable so a test can make the roster read throw.
const { rosterState } = vi.hoisted(() => ({ rosterState: { throwOnce: false } }));
vi.mock('@/data/onboarded-wallets.json', () => ({
  default: {
    get testnet() {
      if (rosterState.throwOnce) {
        rosterState.throwOnce = false;
        throw new Error('roster unreadable');
      }
      return [];
    },
    mainnet: [],
  },
}));

type GetFn = (req: Request) => Promise<Response>;

const USER = Keypair.random().publicKey();
const event = {
  topic: [xdr.ScVal.scvSymbol('vouch'), new Address(USER).toScVal()],
  value: xdr.ScVal.scvVoid(),
};

let getLatestLedger: ReturnType<typeof vi.fn>;
let getEvents: ReturnType<typeof vi.fn>;
let GET: GetFn;

const req = (network = 'testnet') => new Request(`http://localhost/api/stats?network=${network}`);

/** Resolves once every pending promise callback (the route's awaits) has run. */
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  vi.stubEnv('NEXT_PUBLIC_RPC_URL', 'https://rpc.test');
  vi.stubEnv('NEXT_PUBLIC_REPUTATION_CONTRACT_ID', 'CREP');
  vi.stubEnv('NEXT_PUBLIC_REGISTRY_CONTRACT_ID', 'CREG');
  vi.stubEnv('MAINNET_RPC_URL', 'https://mainnet-rpc.test');
  vi.stubEnv('MAINNET_REPUTATION_CONTRACT_ID', 'CMAINREP');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  rosterState.throwOnce = false;

  getLatestLedger = vi.fn().mockResolvedValue({ sequence: 50_000 });
  getEvents = vi.fn().mockResolvedValue({ events: [event], cursor: undefined });
  vi.mocked(rpc.Server).mockReset();
  // Constructed with `new`, so the implementation must be a `function`, not an arrow.
  vi.mocked(rpc.Server).mockImplementation(function () {
    return { getLatestLedger, getEvents } as unknown as InstanceType<typeof rpc.Server>;
  });

  // A fresh module per test: the caches live at module scope.
  vi.resetModules();
  ({ GET } = (await import('./route')) as { GET: GetFn });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('GET /api/stats caching', () => {
  it('runs one scan for two requests within the TTL', async () => {
    const first = await GET(req());
    vi.setSystemTime(Date.now() + 29_000);
    const second = await GET(req());

    expect(getLatestLedger).toHaveBeenCalledTimes(1);
    expect(getEvents).toHaveBeenCalledTimes(1);
    const a = (await first.json()) as { users: number; latestLedger: number };
    expect(a).toMatchObject({ users: 1, latestLedger: 50_000 });
    expect(await second.json()).toEqual(a);
  });

  it('shares one in-flight scan between concurrent requests', async () => {
    let release!: (v: { sequence: number }) => void;
    getLatestLedger.mockReturnValueOnce(new Promise((r) => (release = r)));

    const pending = [GET(req()), GET(req()), GET(req())];
    await flush();
    release({ sequence: 50_000 });
    const responses = await Promise.all(pending);

    expect(getLatestLedger).toHaveBeenCalledTimes(1);
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
  });

  it('never runs a slow scan twice: the TTL starts when the scan finishes', async () => {
    let release!: (v: { sequence: number }) => void;
    getLatestLedger.mockReturnValueOnce(new Promise((r) => (release = r)));

    const slow = GET(req());
    await flush();
    vi.setSystemTime(Date.now() + 45_000); // longer than the TTL, still in flight
    const joined = GET(req());
    release({ sequence: 50_000 });
    await Promise.all([slow, joined]);
    expect(getLatestLedger).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 29_000); // within the TTL of the finished scan
    await GET(req());
    expect(getLatestLedger).toHaveBeenCalledTimes(1);
  });

  it('scans again once the TTL has passed', async () => {
    await GET(req());
    vi.setSystemTime(Date.now() + 30_001);
    getLatestLedger.mockResolvedValueOnce({ sequence: 50_100 });
    const res = await GET(req());

    expect(getLatestLedger).toHaveBeenCalledTimes(2);
    expect(await res.json()).toMatchObject({ latestLedger: 50_100 });
  });

  it('caches each network separately', async () => {
    await GET(req('testnet'));
    await GET(req('mainnet'));
    await GET(req('testnet'));
    await GET(req('mainnet'));

    expect(getLatestLedger).toHaveBeenCalledTimes(2);
    const urls = vi.mocked(rpc.Server).mock.calls.map((c) => c[0]);
    expect(urls).toContain('https://rpc.test');
    expect(urls).toContain('https://mainnet-rpc.test');
  });

  it('does not keep a scan that threw, so the next request retries', async () => {
    rosterState.throwOnce = true;
    const failed = await GET(req());
    expect(failed.status).toBe(500);

    const retried = await GET(req());
    expect(retried.status).toBe(200);
    expect(await retried.json()).toMatchObject({ users: 1 });
  });

  it('lets the CDN cache the response for the same window', async () => {
    const res = await GET(req());
    expect(res.headers.get('cache-control')).toBe('public, s-maxage=30, stale-while-revalidate=120');
  });

  it('does not mark a rejected network as publicly cacheable', async () => {
    const res = await GET(req('devnet'));
    expect(res.status).toBe(400);
    expect(res.headers.get('cache-control')).toBeNull();
    expect(getLatestLedger).not.toHaveBeenCalled();
  });
});
