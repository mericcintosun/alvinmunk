/**
 * MVP leaderboard (Yellow belt): read `social` events straight from RPC and fold
 * them into a ranking (no standing indexer — belts/00-strategy). The fold/rank logic
 * is the pure, tested `rankLeaderboard` in @passport/shared.
 */
import { scValToNative, xdr } from '@stellar/stellar-sdk';
import {
  rankLeaderboard,
  EVENTS,
  type SocialRecord,
  type LeaderboardEntry,
} from '@passport/shared';
import { server, config } from './stellar';

function toNative(v: xdr.ScVal | string): unknown {
  const sv = typeof v === 'string' ? xdr.ScVal.fromXDR(v, 'base64') : v;
  return scValToNative(sv);
}

/** Pull recent `social` events and parse them into running-total records. */
export async function fetchSocialRecords(): Promise<SocialRecord[]> {
  if (!config.contracts.reputation) return [];

  let startLedger: number;
  try {
    const latest = await server.getLatestLedger();
    startLedger = Math.max(1, latest.sequence - 16000); // ~24h, within RPC retention
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
      limit: 200,
    });
  } catch {
    return []; // outside retention window / RPC hiccup — empty board, not a crash
  }

  const records: SocialRecord[] = [];
  for (const ev of res.events) {
    const topics = (ev.topic as Array<xdr.ScVal | string>).map(toNative);
    if (topics[0] !== EVENTS.SOCIAL) continue; // ('social', addr)
    const data = toNative(ev.value as xdr.ScVal | string);
    const total = Array.isArray(data) ? Number(data[1]) : Number(data); // (amount, newTotal)
    records.push({ address: String(topics[1]), total, ledger: ev.ledger });
  }
  return records;
}

export async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  return rankLeaderboard(await fetchSocialRecords());
}
