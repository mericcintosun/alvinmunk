import { Account, Contract, Keypair, Networks, nativeToScVal, rpc, scValToNative, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { NextResponse } from 'next/server';
import roster from '@/data/onboarded-wallets.json';
import { aggregateVouchFunnel, type VouchRecord } from '@/lib/vouch-funnel';

/**
 * Network stats — unique wallets that have interacted with the app's contracts, per network.
 *
 * Two sources, unioned:
 *  1. A committed **roster** (`data/onboarded-wallets.json`) — the durable, cumulative set of
 *     onboarded wallets. Soroban RPC only keeps ~7 days of events, so a pure `getEvents` count
 *     silently decays once seed activity ages out of the retention window (this is why the page
 *     once dropped to "1"). The roster is the permanent floor and never decays.
 *  2. A **live** `getEvents` scan over a short recent window — catches brand-new wallets that
 *     onboarded after the roster was last captured, so the number still grows organically.
 *
 * Refresh the roster by re-running `scripts/scan-roster.mjs` (widens the window + fully
 * paginates) and committing its output. A durable indexer (issue #12) would fold both paths.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Live scan: a short, dense window so the serverless call stays fast. The roster carries
// history; this only needs to see the last day or so of fresh onboarding.
const LIVE_WINDOW = 17_280; // ~1 day of ledgers
const MAX_PAGES = 25;
const ADDR = /^[GC][A-Z2-7]{55}$/;

type NetKey = 'testnet' | 'mainnet';
const BASE_FEE = '1000000';

const NETWORKS: Record<
  NetKey,
  { rpc: string; rep?: string; registry?: string; exclude?: (string | undefined)[] }
> = {
  testnet: {
    rpc: process.env.NEXT_PUBLIC_RPC_URL || 'https://soroban-testnet.stellar.org',
    rep: process.env.NEXT_PUBLIC_REPUTATION_CONTRACT_ID,
    registry: process.env.NEXT_PUBLIC_REGISTRY_CONTRACT_ID,
    // The app's own contracts appear in event topics (e.g. the quest_registry as att_set
    // issuer); they are NOT users, so exclude them from the count.
    exclude: [
      process.env.NEXT_PUBLIC_REPUTATION_CONTRACT_ID,
      process.env.NEXT_PUBLIC_REGISTRY_CONTRACT_ID,
      process.env.NEXT_PUBLIC_REWARDS_CONTRACT_ID,
      process.env.NEXT_PUBLIC_QUEST_REGISTRY_CONTRACT_ID,
      process.env.NEXT_PUBLIC_GATE_CONTRACT_ID,
      process.env.NEXT_PUBLIC_USDC_SAC_ID,
    ],
  },
  mainnet: {
    rpc: process.env.MAINNET_RPC_URL || 'https://mainnet.sorobanrpc.com',
    rep: process.env.MAINNET_REPUTATION_CONTRACT_ID,
    registry: process.env.MAINNET_REGISTRY_CONTRACT_ID,
    exclude: [
      process.env.MAINNET_REPUTATION_CONTRACT_ID,
      process.env.MAINNET_REGISTRY_CONTRACT_ID,
      process.env.MAINNET_REWARDS_CONTRACT_ID,
      process.env.MAINNET_QUEST_REGISTRY_CONTRACT_ID,
      process.env.MAINNET_GATE_CONTRACT_ID,
      process.env.MAINNET_USDC_SAC_ID,
    ],
  },
};

// Progress targets from the belt program: testnet 50 (Blue), mainnet 20 (Black).
const TARGET: Record<NetKey, number> = { testnet: 50, mainnet: 20 };

function collectAddrs(v: unknown, out: Set<string>): void {
  if (typeof v === 'string') {
    if (ADDR.test(v)) out.add(v);
  } else if (Array.isArray(v)) {
    for (const x of v) collectAddrs(x, out);
  } else if (v && typeof v === 'object') {
    for (const x of Object.values(v)) collectAddrs(x, out);
  }
}

function decode(v: xdr.ScVal | string): unknown {
  try {
    const sv = typeof v === 'string' ? xdr.ScVal.fromXDR(v, 'base64') : v;
    return scValToNative(sv);
  } catch {
    return null;
  }
}

/** Live scan of the recent window. Returns the fresh addresses and the latest ledger. */
async function liveScan(cfg: (typeof NETWORKS)[NetKey]): Promise<{ seen: Set<string>; latest: number }> {
  const seen = new Set<string>();
  const ids = [cfg.rep, cfg.registry].filter(Boolean) as string[];
  if (ids.length === 0) return { seen, latest: 0 };
  const server = new rpc.Server(cfg.rpc);
  let latest = 0;
  try {
    latest = (await server.getLatestLedger()).sequence;
  } catch {
    return { seen, latest: 0 };
  }
  const startLedger = Math.max(1, latest - LIVE_WINDOW);
  try {
    const filters = [{ type: 'contract' as const, contractIds: ids, topics: [['*', '*']] }];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await server.getEvents(
        cursor ? { filters, cursor, limit: 1000 } : { filters, startLedger, limit: 1000 },
      );
      for (const ev of res.events) {
        for (const t of ev.topic as Array<xdr.ScVal | string>) collectAddrs(decode(t), seen);
        collectAddrs(decode(ev.value as xdr.ScVal | string), seen);
      }
      cursor = res.cursor;
      // Keep paging while the RPC hands back a cursor — a page can legitimately be empty when
      // the scanned sub-range holds no events. Stopping on an empty page (the old bug) capped
      // the count at "whatever is in the last few thousand ledgers", i.e. sometimes 1.
      if (!cursor) break;
    }
  } catch {
    /* return what we have */
  }
  return { seen, latest };
}

async function statsFor(net: NetKey) {
  const cfg = NETWORKS[net];
  const rosterList = ((roster as Record<string, string[]>)[net] ?? []).filter((a) => ADDR.test(a));
  const configured = Boolean(cfg.rep || cfg.registry) || rosterList.length > 0;

  // Durable floor: the committed roster. Never decays.
  const seen = new Set<string>(rosterList);

  // Organic growth: union in anything new from the live window.
  const { seen: live, latest } = await liveScan(cfg);
  for (const a of live) seen.add(a);

  // Drop the app's own contract addresses so only real user wallets are counted.
  for (const id of cfg.exclude ?? []) if (id) seen.delete(id);

  let funnel: ReturnType<typeof aggregateVouchFunnel> | null = null;
  let funnelError: string | undefined;
  if (cfg.rep) {
    try {
      const records = await readVouches(cfg, net);
      const excluded = new Set((cfg.exclude ?? []).filter(Boolean) as string[]);
      funnel = aggregateVouchFunnel(records.filter((v) => !excluded.has(v.from) && (!v.claimer || !excluded.has(v.claimer))));
    } catch (error) {
      // Older deployed contracts may not have vouch_count yet. Keep wallet stats available
      // while surfacing why the contract-backed funnel cannot be read.
      funnelError = error instanceof Error ? error.message : 'Unable to read vouch state';
    }
  }

  const addresses = [...seen];
  return {
    network: net,
    configured,
    users: addresses.length,
    target: TARGET[net],
    latestLedger: latest || undefined,
    roster: rosterList.length,
    addresses: addresses.slice(0, 300),
    funnel,
    funnelError,
  };
}

type NetworkConfig = (typeof NETWORKS)[NetKey];

/** Read sequential vouch records directly from durable contract state, independent of events. */
async function readVouches(cfg: NetworkConfig, net: NetKey): Promise<VouchRecord[]> {
  if (!cfg.rep) return [];
  const server = new rpc.Server(cfg.rpc);
  const passphrase = net === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
  const source = new Account(Keypair.random().publicKey(), '0');
  async function call(method: string, ...args: xdr.ScVal[]) {
    const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: passphrase })
      .addOperation(new Contract(cfg.rep!).call(method, ...args))
      .setTimeout(30)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw new Error(`simulate ${method} failed: ${sim.error}`);
    const retval = sim.result?.retval;
    return retval ? scValToNative(retval) : undefined;
  }

  const count = Number(await call('vouch_count') ?? 0);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid vouch count returned by contract');
  const out: VouchRecord[] = [];
  // Bound concurrent simulations to keep the route within serverless RPC limits.
  for (let start = 1; start <= count; start += 16) {
    const end = Math.min(count, start + 15);
    const batch = await Promise.all(Array.from({ length: end - start + 1 }, (_, i) =>
      call('get_vouch', nativeToScVal(BigInt(start + i), { type: 'u64' })),
    ));
    for (const value of batch) {
      if (!value || typeof value !== 'object') continue;
      const v = value as Record<string, unknown>;
      out.push({
        id: Number(v.id),
        from: String(v.from),
        claimed: Boolean(v.claimed),
        claimer: v.claimer == null ? null : String(v.claimer),
        created: Number(v.created),
        slashed: Boolean(v.slashed),
      });
    }
  }
  return out;
}

export async function GET(req: Request) {
  const net = (new URL(req.url).searchParams.get('network') || 'testnet') as NetKey;
  if (net !== 'testnet' && net !== 'mainnet') {
    return NextResponse.json({ error: 'bad network' }, { status: 400 });
  }
  const data = await statsFor(net);
  return NextResponse.json(data, { headers: { 'cache-control': 'public, s-maxage=300, stale-while-revalidate=60' } });
}
