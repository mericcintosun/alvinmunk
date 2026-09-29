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

/** A decoded contract event: topics + value already run through scValToNative. */
export interface RepEvent {
  topics: unknown[];
  data: unknown;
  ledger: number;
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
 * together) share one scan.
 */
export async function fetchReputationEvents(options?: { throwOnError?: boolean }): Promise<RepEvent[]> {
  return fetchContractEvents(config.contracts.reputation, ['*', '*'], PAGE_SIZE * MAX_PAGES, options?.throwOnError);
}

/**
 * Every `tipped` event in the window (topics ('tipped', from, to) · data amount), decoded,
 * oldest-first — the same window as `fetchReputationEvents`, so the feed can merge tips and
 * vouches by ledger. It filters on the event name with three segments: RPC topic filters
 * only match events with exactly as many topics, so a 2-segment wildcard never sees tips.
 * Returns [] if the contract isn't deployed or RPC is unavailable.
 */
export async function fetchTipEvents(options?: { throwOnError?: boolean }): Promise<RepEvent[]> {
  const tipped = xdr.ScVal.scvSymbol(EVENTS.TIPPED).toXDR('base64');
  return fetchContractEvents(config.contracts.rewards, [tipped, '*', '*'], PAGE_SIZE * MAX_PAGES, options?.throwOnError);
}

/**
 * `tipped` events SENT by `from` (topics ('tipped', from, to) · data amount), oldest-first.
 * RPC topic filters only match events with exactly as many topics as segments, so the
 * 2-segment wildcard above never sees these 3-topic events; filtering on the sender here
 * also keeps the read to one wallet's tips instead of the whole rewards contract.
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

function fetchContractEvents(contractId: string, topics: string[], limit: number, throwOnError?: boolean): Promise<RepEvent[]> {
  if (!contractId) {
    if (throwOnError) return Promise.reject(new Error('No contract ID'));
    return Promise.resolve([]);
  }
  return shareInFlight(pendingScans, `${contractId}|${topics.join(',')}|${limit}|${throwOnError}`, () =>
    scanContractEvents(contractId, topics, limit, throwOnError),
  );
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
 * A request failing part-way drops the whole scan to []: an oldest-only prefix would read
 * to every caller as "nothing happened since".
 */
async function scanContractEvents(contractId: string, topics: string[], limit: number, throwOnError?: boolean): Promise<RepEvent[]> {
  let startLedger: number;
  try {
    const latest = await server.getLatestLedger();
    startLedger = Math.max(1, latest.sequence - EVENT_LEDGER_WINDOW);
  } catch (err) {
    if (throwOnError) throw err;
    return [];
  }

  const filters: rpc.Api.EventFilter[] = [
    { type: 'contract', contractIds: [contractId], topics: [topics] },
  ];
  const out: RepEvent[] = [];
  try {
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES && out.length < limit; page++) {
      const pageLimit = Math.min(PAGE_SIZE, limit - out.length);
      const res = await server.getEvents(
        cursor ? { filters, cursor, limit: pageLimit } : { filters, startLedger, limit: pageLimit },
      );
      for (const ev of res.events) {
        out.push({
          topics: (ev.topic as Array<xdr.ScVal | string>).map(decodeScVal),
          data: decodeScVal(ev.value as xdr.ScVal | string),
          ledger: ev.ledger,
        });
      }
      // Caught up — or a full page without a cursor, which must not restart from startLedger.
      if (res.events.length < pageLimit || !res.cursor) break;
      cursor = res.cursor;
    }
  } catch (err) {
    if (throwOnError) throw err;
    return [];
  }
  return out;
}
