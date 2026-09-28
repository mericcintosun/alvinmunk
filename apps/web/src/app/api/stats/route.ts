import { isStellarAddress } from '@alvinmunk/shared';
import { NextResponse } from 'next/server';
import { rpc, scValToNative, xdr } from '@stellar/stellar-sdk';
import roster from '@/data/onboarded-wallets.json';

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
type NetKey = 'testnet' | 'mainnet';

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
    if (isStellarAddress(v)) out.add(v);
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
  const rosterList = ((roster as Record<string, string[]>)[net] ?? []).filter((a) => isStellarAddress(a));
  const configured = Boolean(cfg.rep || cfg.registry) || rosterList.length > 0;

  // Durable floor: the committed roster. Never decays.
  const seen = new Set<string>(rosterList);

  // Organic growth: union in anything new from the live window.
  const { seen: live, latest } = await liveScan(cfg);
  for (const a of live) seen.add(a);

  // Drop the app's own contract addresses so only real user wallets are counted.
  for (const id of cfg.exclude ?? []) if (id) seen.delete(id);

  const addresses = [...seen];
  return {
    network: net,
    configured,
    users: addresses.length,
    target: TARGET[net],
    latestLedger: latest || undefined,
    roster: rosterList.length,
    addresses: addresses.slice(0, 300),
  };
}

export async function GET(req: Request) {
  const net = (new URL(req.url).searchParams.get('network') || 'testnet') as NetKey;
  if (net !== 'testnet' && net !== 'mainnet') {
    return NextResponse.json({ error: 'bad network' }, { status: 400 });
  }
  const data = await statsFor(net);
  return NextResponse.json(data, { headers: { 'cache-control': 'no-store' } });
}
