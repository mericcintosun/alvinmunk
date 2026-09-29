/**
 * Inbox — surfaces what happened to the signed-in user while they were away.
 *
 * Three durable item kinds, oldest-first from the chain then newest-first for the UI:
 *   1. vouch-claimed  — half-card this device minted was claimed (from myvouches + RPC)
 *   2. tip-received   — tipped event on the rewards contract where `to === me`
 *   3. quest-awarded  — quest event ("quest","awarded") where the recipient is `me`
 *
 * Seen items are persisted in localStorage so they survive beyond the RPC 24h window and
 * outlive a page refresh. A last-read timestamp clears the unread dot when the inbox is
 * opened. When the durable read API (#109) ships, swap the `fetchContractEvents` calls
 * for it here — one-file change, as per belts/00-strategy §5.
 *
 * `getInboxItems()` is intentionally wallet-agnostic: the caller passes the user's
 * address so the same function works for any account without touching a global wallet
 * singleton.
 */

import { Address, xdr } from '@stellar/stellar-sdk';
import { EVENTS } from '@alvinmunk/shared';
import { fetchContractEvents, PAGE_SIZE, MAX_PAGES, EVENT_WINDOW_TTL_MS } from './events';
import { config } from './stellar';
import { getVouch } from './reputation';
import { getMyVouches } from './myvouches';
import { reverseHandles } from './registry';
import { readJSON, writeJSON } from './storage';

// ── Inbox item types ────────────────────────────────────────────────────────

export type InboxKind = 'vouch-claimed' | 'tip-received' | 'quest-awarded';

export interface InboxItem {
  /** Stable, deterministic id so the seen-set deduplicates across loads. */
  id: string;
  kind: InboxKind;
  /** Ledger this event landed in (0 for items sourced from localStorage only). */
  ledger: number;
  /** Unix milliseconds — synthesized from ledger via a close-time estimate, or from localStorage. */
  ts: number;
  /** The other party's Stellar address (voucher → claimer, tipper, quest issuer). */
  peerAddress: string;
  /** @handle of the peer, when it could be resolved. */
  peerHandle: string | null;
  /** Human-readable message text. */
  message: string;
  /** Extra payload; depends on kind. */
  meta: VouchClaimedMeta | TipReceivedMeta | QuestAwardedMeta;
}

export interface VouchClaimedMeta {
  kind: 'vouch-claimed';
  vouchId: number;
  note: string;
  claimer: string;
}

export interface TipReceivedMeta {
  kind: 'tip-received';
  /** Amount in stroops (bigint from the contract). */
  amount: bigint;
  from: string;
}

export interface QuestAwardedMeta {
  kind: 'quest-awarded';
  questId: number | string;
  recipient: string;
}

// ── localStorage persistence ────────────────────────────────────────────────

const INBOX_SEEN_KEY = 'alvinmunk.inbox.seen';
const INBOX_LAST_READ_KEY = 'alvinmunk.inbox.lastRead';
/** Items persisted so they survive beyond the ~24h RPC event window. Max per wallet. */
const MAX_PERSISTED_ITEMS = 200;

/**
 * The set of item IDs the user has "seen" (the inbox was opened after they arrived).
 * An ID only enters this set when `markInboxRead()` is called.
 */
export function getSeenIds(): Set<string> {
  return new Set(readJSON<string[]>(INBOX_SEEN_KEY, []));
}

/** Epoch ms of the last time the user opened their inbox. */
export function getLastReadMs(): number {
  return readJSON<number>(INBOX_LAST_READ_KEY, 0);
}

/**
 * Mark every currently-known item id as seen and record the last-read timestamp.
 * Call this when the user opens the inbox view.
 */
export function markInboxRead(itemIds: string[]): void {
  const existing = readJSON<string[]>(INBOX_SEEN_KEY, []);
  const next = Array.from(new Set([...existing, ...itemIds])).slice(-MAX_PERSISTED_ITEMS);
  writeJSON(INBOX_SEEN_KEY, next);
  writeJSON(INBOX_LAST_READ_KEY, Date.now());
}

// Persisted items cache (across sessions, beyond RPC window).
const INBOX_ITEMS_KEY = 'alvinmunk.inbox.items';

function loadPersistedItems(address: string): InboxItem[] {
  const all = readJSON<Record<string, InboxItem[]>>(INBOX_ITEMS_KEY, {});
  return all[address] ?? [];
}

function persistItems(address: string, items: InboxItem[]): void {
  const all = readJSON<Record<string, InboxItem[]>>(INBOX_ITEMS_KEY, {});
  // Keep the newest MAX_PERSISTED_ITEMS, deduped by id.
  const merged = mergeItems(loadPersistedItems(address), items);
  all[address] = merged.slice(0, MAX_PERSISTED_ITEMS);
  writeJSON(INBOX_ITEMS_KEY, all);
}

/** Merge two item lists: union by id, newest-ledger wins on conflict, sorted newest-first. */
function mergeItems(existing: InboxItem[], fresh: InboxItem[]): InboxItem[] {
  const byId = new Map<string, InboxItem>();
  for (const item of [...existing, ...fresh]) {
    const prev = byId.get(item.id);
    if (!prev || item.ledger >= prev.ledger) byId.set(item.id, item);
  }
  return Array.from(byId.values()).sort((a, b) => b.ledger - a.ledger || b.ts - a.ts);
}

// ── Approximate timestamp from ledger ──────────────────────────────────────

/** Stellar ledger closes every ~5s. Approximates the unix ms for a given ledger. */
function ledgerToMs(ledger: number, latestLedger: number, nowMs = Date.now()): number {
  return nowMs - (latestLedger - ledger) * 5_000;
}

// ── Vouch-claimed items ─────────────────────────────────────────────────────

async function fetchVouchClaimedItems(me: string, latestLedger: number): Promise<InboxItem[]> {
  const mine = getMyVouches();
  if (mine.length === 0) return [];

  const items: InboxItem[] = [];
  await Promise.all(
    mine.slice(0, 50).map(async (m) => {
      const vouch = await getVouch(m.id).catch(() => null);
      if (!vouch?.claimed || !vouch.claimer || vouch.from !== me) return;
      const id = `vouch-claimed:${m.id}`;
      const ts = ledgerToMs(Number(vouch.created), latestLedger);
      items.push({
        id,
        kind: 'vouch-claimed',
        ledger: Number(vouch.created),
        ts,
        peerAddress: vouch.claimer,
        peerHandle: null, // resolved in a batch below
        message: `Your vouch "${m.note}" was claimed`,
        meta: {
          kind: 'vouch-claimed',
          vouchId: m.id,
          note: m.note,
          claimer: vouch.claimer,
        } satisfies VouchClaimedMeta,
      });
    }),
  );
  return items;
}

// ── Tip-received items ──────────────────────────────────────────────────────

async function fetchTipReceivedItems(me: string, latestLedger: number): Promise<InboxItem[]> {
  if (!config.contracts.rewards) return [];

  let recipient: string;
  try {
    recipient = new Address(me).toScVal().toXDR('base64');
  } catch {
    return [];
  }
  const tipped = xdr.ScVal.scvSymbol(EVENTS.TIPPED).toXDR('base64');

  const events = await fetchContractEvents(
    config.contracts.rewards,
    [tipped, '*', recipient],
    PAGE_SIZE * MAX_PAGES,
    { maxAgeMs: EVENT_WINDOW_TTL_MS },
  );

  return events.map((ev) => {
    const [, from] = ev.topics as [unknown, string, unknown];
    const amount = (ev.data ?? 0n) as bigint;
    const id = `tip-received:${ev.ledger}:${String(from)}:${String(amount)}`;
    return {
      id,
      kind: 'tip-received' as const,
      ledger: ev.ledger,
      ts: ledgerToMs(ev.ledger, latestLedger),
      peerAddress: String(from),
      peerHandle: null,
      message: `You received a tip of ${formatUsdc(amount)} USDC`,
      meta: {
        kind: 'tip-received',
        amount,
        from: String(from),
      } satisfies TipReceivedMeta,
    };
  });
}

/** Format a USDC amount in stroops (7 decimals) to a readable string. */
function formatUsdc(stroops: bigint): string {
  const whole = stroops / 10_000_000n;
  const frac = stroops % 10_000_000n;
  if (frac === 0n) return String(whole);
  return `${whole}.${String(frac).padStart(7, '0').replace(/0+$/, '')}`;
}

// ── Quest-awarded items ─────────────────────────────────────────────────────

async function fetchQuestAwardedItems(me: string, latestLedger: number): Promise<InboxItem[]> {
  if (!config.contracts.questRegistry) return [];

  const quest = xdr.ScVal.scvSymbol(EVENTS.QUEST).toXDR('base64');
  const awarded = xdr.ScVal.scvSymbol('awarded').toXDR('base64');

  const events = await fetchContractEvents(
    config.contracts.questRegistry,
    [quest, awarded],
    PAGE_SIZE * MAX_PAGES,
    { maxAgeMs: EVENT_WINDOW_TTL_MS },
  );

  const items: InboxItem[] = [];
  for (const ev of events) {
    // data = (quest_id, recipient) — recipient is the address that got the XP
    const data = ev.data as { 0?: unknown; 1?: unknown } | unknown[] | null;
    let questId: number | string = 0;
    let recipient: string = '';
    if (Array.isArray(data)) {
      questId = data[0] as number | string;
      recipient = String(data[1]);
    } else if (data && typeof data === 'object') {
      questId = (data as Record<string, unknown>)[0] as number | string;
      recipient = String((data as Record<string, unknown>)[1]);
    }
    if (recipient !== me) continue;
    const id = `quest-awarded:${ev.ledger}:${String(questId)}`;
    items.push({
      id,
      kind: 'quest-awarded' as const,
      ledger: ev.ledger,
      ts: ledgerToMs(ev.ledger, latestLedger),
      peerAddress: me,
      peerHandle: null,
      message: `Your quest was verified — Earned XP added`,
      meta: {
        kind: 'quest-awarded',
        questId,
        recipient,
      } satisfies QuestAwardedMeta,
    });
  }
  return items;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Fetch all inbox items for `me`, merge with persisted items, resolve handles, and
 * return newest-first. Degrades gracefully: a failure fetching one kind does not
 * blank the others. Persists the result to localStorage so items outlive the RPC window.
 *
 * Pass the latest ledger sequence from a recent RPC call for accurate timestamps;
 * pass 0 to have the function use current time as-of-latest.
 */
export async function getInboxItems(me: string, latestLedger = 0): Promise<InboxItem[]> {
  if (!me) return [];

  // Fetch from chain in parallel; each degrades to [] on failure.
  const [vouches, tips, quests] = await Promise.all([
    fetchVouchClaimedItems(me, latestLedger).catch(() => []),
    fetchTipReceivedItems(me, latestLedger).catch(() => []),
    fetchQuestAwardedItems(me, latestLedger).catch(() => []),
  ]);

  const fresh = [...vouches, ...tips, ...quests];

  // Merge with locally persisted items (covers the > 24h window).
  const merged = mergeItems(loadPersistedItems(me), fresh);

  // Batch-resolve all peer handles in one call.
  const peerAddresses = [...new Set(merged.map((i) => i.peerAddress))].filter((a) => a && a !== me);
  let handles: Record<string, string | null> = {};
  if (peerAddresses.length > 0) {
    handles = await reverseHandles(peerAddresses).catch(() => ({}));
  }

  const withHandles = merged.map((item) => ({
    ...item,
    peerHandle: handles[item.peerAddress] ?? null,
  }));

  // Persist the enriched list.
  persistItems(me, withHandles);

  return withHandles;
}

/**
 * Count of inbox items that arrived AFTER the last-read timestamp.
 * Pass the same array returned by `getInboxItems` to avoid a second fetch.
 */
export function countUnread(items: InboxItem[]): number {
  const lastRead = getLastReadMs();
  return items.filter((i) => i.ts > lastRead).length;
}
