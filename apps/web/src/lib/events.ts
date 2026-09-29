/**
 * Shared contract-event reader. `constellation`, `feed`, `leaderboard` and `badges` all need
 * the same RPC `getEvents` window + ScVal decode — this is the one place that knows how to
 * pull and decode them, so the durable-indexer swap (Blue/Black, belts/00-strategy) is a
 * one-file change. RPC-direct for the MVP; degrades to [] on any failure.
 */
import { Address, scValToNative, xdr, type rpc } from '@stellar/stellar-sdk';
import { EVENTS } from '@alvinmunk/shared';
import { server, config } from './stellar';
import { shareInFlight } from './utils';
import type { ReadNetwork } from './read-network';

/**
 * RPC event retention is ~24h; staying within ~9000 ledgers keeps `getEvents` returning
 * rows instead of an out-of-range error (≥16k returns 0 events). It must also stay under
 * the 10,000 ledgers stellar-rpc scans per request: only then does a short page mean the
 * scan reached the latest ledger (see `scanContractEvents`).
 */
export const EVENT_LEDGER_WINDOW = 9000;

/** Events per `getEvents` page — well under stellar-rpc's default 10,000 `limit` ceiling. */
export const PAGE_SIZE = 1000;

/**
 * Most pages one scan follows (10 × 1000 = 10,000 events), so a hot window — or the
 * leaderboard's 5s poll — can't fan out into unbounded requests. A window holding more
 * than that returns only its oldest 10,000 events; at that volume the durable indexer
 * (#109) has to replace RPC-direct reads.
 */
export const MAX_PAGES = 10;

/**
 * How long a settled window scan (`fetchReputationEvents`, `fetchTipEvents`) is reused. The
 * dashboard's readers mount seconds apart — the 3D hero waits for its bundle, the feed
 * doesn't — so sharing only in-flight scans still read the same window twice per load.
 */
export const EVENT_WINDOW_TTL_MS = 15_000;

/** How a window read may be served. */
export interface WindowReadOptions {
  /** Reject when the RPC fails instead of degrading to []. */
  throwOnError?: boolean;
  /** Reuse a settled scan up to this old (default `EVENT_WINDOW_TTL_MS`); 0 always scans. */
  maxAgeMs?: number;
}

/** A decoded contract event: topics + value already run through scValToNative. */
export interface RepEvent {
  topics: unknown[];
  data: unknown;
  ledger: number;
  /** The RPC's event id (unique per event), when it reported one. */
  id?: string;
  /** Ledger close time in unix seconds, when the RPC reported it. */
  closedAt?: number;
}

/**
 * Decode an XDR/base64 ScVal to its native JS value.
 * Returns null on malformed input so that contract-event callers (leaderboard,
 * feed, constellation) degrade gracefully instead of crashing on bad data.
 */
export function decodeScVal(v: xdr.ScVal | string): unknown {
  try {
    const sv = typeof v === 'string' ? xdr.ScVal.fromXDR(v, 'base64') : v;
    return scValToNative(sv);
  } catch {
    return null;
  }
}

/**
 * Every reputation-contract event in the window (decoded), in RPC order (oldest-first), so
 * the last element is the newest — the scan follows the RPC cursor across pages up to
 * MAX_PAGES. Returns [] if the contract isn't deployed or RPC is unavailable so every
 * caller degrades gracefully. Concurrent callers (feed, constellation, badges mounting
 * together) share one scan, and a settled one is reused for `EVENT_WINDOW_TTL_MS`.
 */
export async function fetchReputationEvents(
  options?: WindowReadOptions & {
    /** Read another network (the ?network= override); default: the deployment's. */
    net?: ReadNetwork | null;
  },
): Promise<RepEvent[]> {
  const { net, ...window } = options ?? {};
  const contractId = net ? net.contracts.reputation : config.contracts.reputation;
  return fetchContractEvents(
    contractId,
    ['*', '*'],
    PAGE_SIZE * MAX_PAGES,
    { maxAgeMs: EVENT_WINDOW_TTL_MS, ...window },
    net,
  );
}

/**
 * Every `tipped` event in the window (topics ('tipped', from, to) · data amount), decoded,
 * oldest-first — the same window as `fetchReputationEvents`, so the feed can merge tips and
 * vouches by ledger. It filters on the event name with three segments: RPC topic filters
 * only match events with exactly as many topics, so a 2-segment wildcard never sees tips.
 * Returns [] if the contract isn't deployed or RPC is unavailable.
 */
export async function fetchTipEvents(options?: WindowReadOptions): Promise<RepEvent[]> {
  const tipped = xdr.ScVal.scvSymbol(EVENTS.TIPPED).toXDR('base64');
  return fetchContractEvents(config.contracts.rewards, [tipped, '*', '*'], PAGE_SIZE * MAX_PAGES, {
    maxAgeMs: EVENT_WINDOW_TTL_MS,
    ...options,
  });
}

/**
 * Every quest-registry event in the window with two topics — `('quest', created | awarded |
 * att_bind | att_clear)` and `('streak', player)` — decoded, oldest-first, sharing the
 * window cache like the reads above. Returns [] if the contract isn't deployed or RPC is
 * unavailable.
 */
export async function fetchQuestEvents(options?: WindowReadOptions): Promise<RepEvent[]> {
  return fetchContractEvents(config.contracts.questRegistry, ['*', '*'], PAGE_SIZE * MAX_PAGES, {
    maxAgeMs: EVENT_WINDOW_TTL_MS,
    ...options,
  });
}

/**
 * `tipped` events SENT by `from` (topics ('tipped', from, to) · data amount), oldest-first.
 * RPC topic filters only match events with exactly as many topics as segments, so the
 * 2-segment wildcard above never sees these 3-topic events; filtering on the sender here
 * also keeps the read to one wallet's tips instead of the whole rewards contract.
 *
 * Since the contract validates a tip (#144) every event here has `amount > 0` and
 * `to !== from`, so each one is a real USDC transfer out of `from` — safe to count as
 * activity. Events from a contract deployed before that rule are not re-validated, so a
 * historical zero/self tip can still appear; the UI reads the amount off the event.
 */
export async function fetchTipsSent(from: string, limit = 1): Promise<RepEvent[]> {
  let sender: string;
  try {
    sender = new Address(from).toScVal().toXDR('base64');
  } catch {
    return []; // not a valid G…/C… address
  }
  const tipped = xdr.ScVal.scvSymbol(EVENTS.TIPPED).toXDR('base64');
  return fetchContractEvents(config.contracts.rewards, [tipped, sender, '*'], limit);
}

const pendingScans = new Map<string, Promise<RepEvent[]>>();
const settledScans = new Map<string, { events: RepEvent[]; at: number }>();

/** Forget every settled scan, so the next read of each window goes to the RPC. */
export function clearEventCache(): void {
  settledScans.clear();
}

/**
 * One scan per window however callers ask for it: callers that degrade and callers that
 * `throwOnError` share the same (throwing) scan, and only a successful one is kept — a
 * failed read must not blank every reader for the TTL. The wrappers above are the usual
 * way in; it is exported for a contract/topic window they don't cover (#279).
 */
export function fetchContractEvents(
  contractId: string,
  topics: string[],
  limit: number,
  { throwOnError, maxAgeMs = 0 }: WindowReadOptions = {},
  net?: ReadNetwork | null,
): Promise<RepEvent[]> {
  if (!contractId) {
    if (throwOnError) return Promise.reject(new Error('No contract ID'));
    return Promise.resolve([]);
  }
  // One network's window never answers for the other's (the ?network= override).
  const key = `${net?.network ?? ''}|${contractId}|${topics.join(',')}|${limit}`;
  const hit = settledScans.get(key);
  if (hit && Date.now() - hit.at < maxAgeMs) return Promise.resolve(hit.events);
  const scan = shareInFlight(pendingScans, key, async () => {
    const events = await scanContractEvents(net?.server ?? server, contractId, topics, limit);
    settledScans.set(key, { events, at: Date.now() });
    return events;
  });
  return throwOnError ? scan : scan.catch(() => []);
}

/**
 * The first `limit` matching events of the window, oldest-first, paged through with the
 * RPC cursor (at most MAX_PAGES requests). stellar-rpc's `getEvents` contract:
 *   - `startLedger` and `cursor` are mutually exclusive, so only the first page sends
 *     `startLedger`; every later page sends just the previous response's `cursor`.
 *   - Each request scans at most 10,000 ledgers from its start and returns up to `limit`
 *     events, ascending. A full page's `cursor` is its last event; a short page's is the
 *     end of the scanned range — and as the window fits in one scan, that end is the
 *     latest ledger, so a short page means the scan has caught up.
 * A request failing part-way rejects the whole scan (plain callers read []): an oldest-only
 * prefix would read to every caller as "nothing happened since".
 */
async function scanContractEvents(
  server: rpc.Server,
  contractId: string,
  topics: string[],
  limit: number,
): Promise<RepEvent[]> {
  const latest = await server.getLatestLedger();
  const startLedger = Math.max(1, latest.sequence - EVENT_LEDGER_WINDOW);

  const filters: rpc.Api.EventFilter[] = [
    { type: 'contract', contractIds: [contractId], topics: [topics] },
  ];
  const out: RepEvent[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES && out.length < limit; page++) {
    const pageLimit = Math.min(PAGE_SIZE, limit - out.length);
    const res = await server.getEvents(
      cursor ? { filters, cursor, limit: pageLimit } : { filters, startLedger, limit: pageLimit },
    );
    for (const ev of res.events) {
      const closedAt = Math.floor(Date.parse(ev.ledgerClosedAt) / 1000);
      out.push({
        topics: (ev.topic as Array<xdr.ScVal | string>).map(decodeScVal),
        data: decodeScVal(ev.value as xdr.ScVal | string),
        ledger: ev.ledger,
        ...(ev.id ? { id: ev.id } : {}),
        ...(Number.isFinite(closedAt) ? { closedAt } : {}),
      });
    }
    // Caught up — or a full page without a cursor, which must not restart from startLedger.
    if (res.events.length < pageLimit || !res.cursor) break;
    cursor = res.cursor;
  }
  return out;
}
