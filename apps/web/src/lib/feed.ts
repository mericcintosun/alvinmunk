/**
 * Activity feed — recent `vouch:claimed` edges from RPC (the sky is moving): "@x lit a
 * star for @y". Social proof of life on the dashboard, even when you're idle. RPC-direct
 * (durable indexer deferred); newest-first, capped.
 */
import { scValToNative, xdr } from '@stellar/stellar-sdk';
import { EVENTS } from '@passport/shared';
import { server, config } from './stellar';

export interface FeedItem {
  from: string;
  to: string;
  ledger: number;
}

function toNative(v: xdr.ScVal | string): unknown {
  const sv = typeof v === 'string' ? xdr.ScVal.fromXDR(v, 'base64') : v;
  return scValToNative(sv);
}

export async function fetchActivity(max = 12): Promise<FeedItem[]> {
  if (!config.contracts.reputation) return [];
  let startLedger: number;
  try {
    const latest = await server.getLatestLedger();
    startLedger = Math.max(1, latest.sequence - 9000);
  } catch {
    return [];
  }
  let res;
  try {
    res = await server.getEvents({
      startLedger,
      filters: [
        { type: 'contract', contractIds: [config.contracts.reputation], topics: [['*', '*']] },
      ],
      limit: 1000,
    });
  } catch {
    return [];
  }

  const items: FeedItem[] = [];
  for (let i = res.events.length - 1; i >= 0; i--) {
    const ev = res.events[i];
    const topics = (ev.topic as Array<xdr.ScVal | string>).map(toNative);
    if (topics[0] !== EVENTS.VOUCH || topics[1] !== 'claimed') continue;
    const data = toNative(ev.value as xdr.ScVal | string);
    if (!Array.isArray(data)) continue;
    // ('vouch','claimed') -> (vouch_id, from, claimer)
    items.push({ from: String(data[1]), to: String(data[2]), ledger: ev.ledger });
    if (items.length >= max) break;
  }
  return items;
}
