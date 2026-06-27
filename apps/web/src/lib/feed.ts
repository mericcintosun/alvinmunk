/**
 * Activity feed — recent `vouch:claimed` edges from RPC (the sky is moving): "@x lit a
 * star for @y". Social proof of life on the dashboard, even when you're idle. RPC-direct
 * (durable indexer deferred); newest-first, capped.
 */
import { EVENTS } from '@alvinmunk/shared';
import { fetchReputationEvents } from './events';

export interface FeedItem {
  from: string;
  to: string;
  ledger: number;
}

export async function fetchActivity(max = 12): Promise<FeedItem[]> {
  const events = await fetchReputationEvents();

  const items: FeedItem[] = [];
  for (let i = events.length - 1; i >= 0; i--) {
    const { topics, data, ledger } = events[i];
    if (topics[0] !== EVENTS.VOUCH || topics[1] !== 'claimed') continue;
    if (!Array.isArray(data)) continue;
    // ('vouch','claimed') -> (vouch_id, from, claimer)
    items.push({ from: String(data[1]), to: String(data[2]), ledger });
    if (items.length >= max) break;
  }
  return items;
}
