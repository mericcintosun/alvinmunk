// @vitest-environment node
/**
 * GET /api/stats against the configured RPC URL (#174): an `http://` URL (a local quickstart
 * node) works, and a URL the SDK rejects falls back to the roster-only count instead of a 500.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Address, Keypair, rpc, xdr } from '@stellar/stellar-sdk';
import { readVouchRecords } from '@/lib/vouch-funnel';

const { actualServer } = vi.hoisted(() => ({ actualServer: { ctor: null as unknown } }));

vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@stellar/stellar-sdk')>();
  actualServer.ctor = actual.rpc.Server;
  return { ...actual, rpc: { ...actual.rpc, Server: vi.fn() } };
});

vi.mock('@/lib/vouch-funnel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/vouch-funnel')>();
  return { ...actual, readVouchRecords: vi.fn() };
});

const { ROSTER } = vi.hoisted(() => ({
  ROSTER: [
    'CB4N3WR2IM273X5D44246YEG67KRIKIFPVORCLH7Q2GCJZLBHIGOD37B',
    'CBGHZW7M5XX36VN7ZVCVG4J2XBV7XWBLQ3OW2SEDIATJ3ZFFER5NM2VN',
  ],
}));
vi.mock('@/data/onboarded-wallets.json', () => ({ default: { testnet: ROSTER, mainnet: [] } }));

type GetFn = (req: Request) => Promise<Response>;
type ServerOpts = ConstructorParameters<typeof rpc.Server>[1];

const HTTP_RPC = 'http://localhost:8000/soroban/rpc';
const LIVE_USER = Keypair.random().publicKey();

let getLatestLedger: ReturnType<typeof vi.fn>;
let getEvents: ReturnType<typeof vi.fn>;

const req = (network = 'testnet') => new Request(`http://localhost/api/stats?network=${network}`);

/** A fresh route module for `env`: the network table and the funnel cache are module state. */
async function loadRoute(env: Record<string, string>): Promise<GetFn> {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  vi.resetModules();
  return ((await import('./route')) as { GET: GetFn }).GET;
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_REPUTATION_CONTRACT_ID', 'CREP');
  vi.stubEnv('NEXT_PUBLIC_REGISTRY_CONTRACT_ID', 'CREG');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  getLatestLedger = vi.fn().mockResolvedValue({ sequence: 50_000 });
  getEvents = vi.fn().mockResolvedValue({
    events: [{ topic: [xdr.ScVal.scvSymbol('vouch'), new Address(LIVE_USER).toScVal()], value: xdr.ScVal.scvVoid() }],
    cursor: undefined,
  });
  vi.mocked(readVouchRecords).mockReset().mockResolvedValue({ total: 0, records: [] });
  vi.mocked(rpc.Server).mockReset();
  // The real constructor still validates the URL (and throws on an insecure one without
  // `allowHttp`, as stellar-sdk does); only the network calls are faked. A `function`, not an
  // arrow: the route calls it with `new`.
  vi.mocked(rpc.Server).mockImplementation(function (url: string, opts?: ServerOpts) {
    new (actualServer.ctor as typeof rpc.Server)(url, opts);
    return { getLatestLedger, getEvents } as unknown as InstanceType<typeof rpc.Server>;
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('GET /api/stats RPC URL', () => {
  it('works with an http:// RPC URL', async () => {
    const GET = await loadRoute({ NEXT_PUBLIC_RPC_URL: HTTP_RPC });
    const res = await GET(req());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ users: 3, roster: 2, latestLedger: 50_000 });
    expect(rpc.Server).toHaveBeenCalledWith(HTTP_RPC, { allowHttp: true });
    // The funnel read gets a working client too, not a swallowed constructor error.
    expect(vi.mocked(rpc.Server).mock.calls.every(([, o]) => o?.allowHttp === true)).toBe(true);
    expect(readVouchRecords).toHaveBeenCalledTimes(1);
  });

  it('trims the URL before deciding allowHttp, like the validated app config', async () => {
    const GET = await loadRoute({ NEXT_PUBLIC_RPC_URL: `  ${HTTP_RPC}\n` });
    const res = await GET(req());

    expect(await res.json()).toMatchObject({ users: 3, latestLedger: 50_000 });
    expect(rpc.Server).toHaveBeenCalledWith(HTTP_RPC, { allowHttp: true });
  });

  it('keeps allowHttp off for an https:// RPC URL', async () => {
    const GET = await loadRoute({ NEXT_PUBLIC_RPC_URL: 'https://rpc.example.test' });
    const res = await GET(req());

    expect(await res.json()).toMatchObject({ users: 3, latestLedger: 50_000 });
    expect(rpc.Server).toHaveBeenCalledWith('https://rpc.example.test', { allowHttp: false });
  });

  it('falls back to the roster-only count for an invalid RPC URL instead of a 500', async () => {
    const GET = await loadRoute({ NEXT_PUBLIC_RPC_URL: 'not a url' });
    const res = await GET(req());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { users: number; latestLedger?: number; funnelError?: string };
    expect(body.users).toBe(ROSTER.length);
    expect(body.latestLedger).toBeUndefined();
    expect(body.funnelError).toMatch(/could not be read/);
    expect(getLatestLedger).not.toHaveBeenCalled();
  });

  it('allows an http:// mainnet RPC URL too', async () => {
    const GET = await loadRoute({ MAINNET_RPC_URL: HTTP_RPC, MAINNET_REPUTATION_CONTRACT_ID: 'CMAINREP' });
    const res = await GET(req('mainnet'));

    expect(await res.json()).toMatchObject({ users: 1, latestLedger: 50_000 });
    expect(rpc.Server).toHaveBeenCalledWith(HTTP_RPC, { allowHttp: true });
  });
});
