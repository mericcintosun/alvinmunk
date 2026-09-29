/**
 * Inbox (#279) — what happened to the signed-in wallet while it was away:
 *   - `claim`  — a half-card it minted was claimed: `('vouch','claimed')` events whose `from`
 *                is the wallet, plus this device's own vouches (getMyVouches + get_vouch) for
 *                claims older than the event window;
 *   - `tip`    — `('tipped', from, me)`, from the shared tip window (fetchTipEvents);
 *   - `quest`  — `('quest','awarded')` for the wallet, and
 *   - `streak` — `('streak', me)` once a streak runs past its first week, both from one
 *                quest-registry window (fetchQuestEvents).
 * All of it rides the shared event windows (their TTL cache included), so the tab's dot and
 * the page cost no scan the dashboard hasn't already made. Items are kept in localStorage
 * per network and wallet, so they outlive the RPC window; the ids already seen drive the
 * unread dot. The durable read API (#109) can replace the reads here.
 */
import { EVENTS } from '@alvinmunk/shared';
import { fetchQuestEvents, fetchReputationEvents, fetchTipEvents, type RepEvent } from './events';
import { getMyVouches } from './myvouches';
import { getVouch } from './reputation';
import { config } from './stellar';
import { readJSON, writeJSON } from './storage';
import { shareInFlight } from './utils';

export type InboxKind = 'claim' | 'tip' | 'quest' | 'streak';

/** One inbox entry. Plain JSON (no bigint), so it persists as-is. */
export interface InboxItem {
  /** Stable per event, so a re-read never duplicates an item or its seen state. */
  id: string;
  kind: InboxKind;
  /** The ledger it landed in; 0 for a claim known only from get_vouch (older than the window). */
  ledger: number;
  /** Ledger close time in unix seconds, when the RPC reported it. */
  at?: number;
  /** The other party: the claimer (claim) or the tipper (tip). */
  peer?: string;
  /** tip: USDC stroops, as a decimal string. */
  amount?: string;
  vouchId?: number;
  questId?: number;
  /** streak: the consecutive-week count it reached. */
  weeks?: number;
}

/** `('streak', player)` on the quest registry (docs/ON_CHAIN_EVENTS.md). */
const STREAK = 'streak';
/** Newest items kept per wallet. */
const MAX_ITEMS = 200;
/** Device vouches checked with get_vouch per load (the newest). */
const MAX_DEVICE_VOUCHES = 50;

/** Fired on `window` when the inbox is marked read, so the unread dot clears at once. */
export const INBOX_READ_EVENT = 'alvinmunk:inbox-read';

interface Stored {
  items: InboxItem[];
  seen: string[];
}

/** Per network AND wallet: a G… address is the same key on testnet and mainnet. */
const storageKey = (me: string) => `alvinmunk.inbox.${config.network}.${me}`;
function load(me: string): Stored {
  const s = readJSON<Partial<Stored> | null>(storageKey(me), null);
  return { items: Array.isArray(s?.items) ? s.items : [], seen: Array.isArray(s?.seen) ? s.seen : [] };
}

const at = (ev: RepEvent) => (ev.closedAt ? { at: ev.closedAt } : {});
/** An event's own id when the RPC gave one, else what identifies it within its ledger. */
const eventKey = (ev: RepEvent, fallback: string) => ev.id ?? `${ev.ledger}:${fallback}`;

/** The wallet's items in the current windows, oldest-first. */
export function itemsFromEvents(
  me: string,
  { reputation, tips, quests }: { reputation: RepEvent[]; tips: RepEvent[]; quests: RepEvent[] },
): InboxItem[] {
  const out: InboxItem[] = [];
  for (const ev of reputation) {
    // ('vouch','claimed') → (id, from, claimer)
    if (ev.topics[0] !== EVENTS.VOUCH || ev.topics[1] !== 'claimed' || !Array.isArray(ev.data)) continue;
    if (String(ev.data[1]) !== me) continue;
    const vouchId = Number(ev.data[0]);
    out.push({ id: `claim:${vouchId}`, kind: 'claim', ledger: ev.ledger, ...at(ev), peer: String(ev.data[2]), vouchId });
  }
  for (const ev of tips) {
    // ('tipped', from, to) → amount
    if (ev.topics[0] !== EVENTS.TIPPED || String(ev.topics[2]) !== me) continue;
    const from = String(ev.topics[1]);
    const amount = String(ev.data ?? '0');
    out.push({ id: `tip:${eventKey(ev, `${from}:${amount}`)}`, kind: 'tip', ledger: ev.ledger, ...at(ev), peer: from, amount });
  }
  for (const ev of quests) {
    if (ev.topics[0] === EVENTS.QUEST && ev.topics[1] === 'awarded' && Array.isArray(ev.data)) {
      // ('quest','awarded') → (quest_id, recipient)
      if (String(ev.data[1]) !== me) continue;
      const questId = Number(ev.data[0]);
      out.push({ id: `quest:${eventKey(ev, String(questId))}`, kind: 'quest', ledger: ev.ledger, ...at(ev), questId });
    } else if (ev.topics[0] === STREAK && String(ev.topics[1]) === me && Array.isArray(ev.data)) {
      // ('streak', player) → (weeks, best). Week 1 is just the award above; only a streak
      // that carried on is news.
      const weeks = Number(ev.data[0]);
      if (weeks < 2) continue;
      out.push({ id: `streak:${eventKey(ev, String(weeks))}`, kind: 'streak', ledger: ev.ledger, ...at(ev), weeks });
    }
  }
  return out;
}

/** Newest first; a claim with no known ledger sorts after every dated item. */
function newestFirst(a: InboxItem, b: InboxItem): number {
  return b.ledger - a.ledger || (b.at ?? 0) - (a.at ?? 0);
}

/**
 * Claims of this device's vouches that neither the window nor the stored inbox knows yet —
 * the durable path for claims older than the RPC window. Only vouches not already in the
 * inbox are read, and get_vouch reads are memoized (lib/reputation).
 */
async function deviceClaims(me: string, known: Set<string>): Promise<InboxItem[]> {
  const unknown = getMyVouches() // newest first
    .slice(0, MAX_DEVICE_VOUCHES)
    .filter((v) => !known.has(`claim:${v.id}`));
  const found = await Promise.all(
    unknown.map(async (v): Promise<InboxItem | null> => {
      const vouch = await getVouch(v.id).catch(() => null);
      if (!vouch?.claimed || !vouch.claimer || vouch.from !== me) return null;
      return { id: `claim:${v.id}`, kind: 'claim', ledger: 0, peer: vouch.claimer, vouchId: v.id };
    }),
  );
  return found.filter((i): i is InboxItem => i !== null);
}

export interface Inbox {
  /** Newest first. */
  items: InboxItem[];
  /** Ids not seen yet (the inbox hasn't been opened since they arrived). */
  unread: Set<string>;
}

const pending = new Map<string, Promise<Inbox>>();

/**
 * The wallet's inbox: the windows' items merged into the stored ones (and stored back), plus
 * what is unread. Never rejects — a window that can't be read adds nothing, and the stored
 * items still show. The tab and the page mounting together share one load.
 */
export function loadInbox(me: string): Promise<Inbox> {
  return shareInFlight(pending, `${config.network}|${me}`, async () => {
    const [reputation, tips, quests] = await Promise.all([
      fetchReputationEvents().catch(() => []),
      fetchTipEvents().catch(() => []),
      fetchQuestEvents().catch(() => []),
    ]);
    const stored = load(me);
    const byId = new Map(stored.items.map((i) => [i.id, i]));
    // A window item replaces a stored one: it may add the ledger a get_vouch claim lacked.
    for (const item of itemsFromEvents(me, { reputation, tips, quests })) byId.set(item.id, item);
    for (const item of await deviceClaims(me, new Set(byId.keys()))) byId.set(item.id, item);

    const items = [...byId.values()].sort(newestFirst).slice(0, MAX_ITEMS);
    const kept = new Set(items.map((i) => i.id));
    const seen = stored.seen.filter((id) => kept.has(id));
    writeJSON<Stored>(storageKey(me), { items, seen });
    const seenSet = new Set(seen);
    return { items, unread: new Set(items.filter((i) => !seenSet.has(i.id)).map((i) => i.id)) };
  });
}

/** Mark these ids seen (the inbox is open) and tell the unread dot. */
export function markInboxRead(me: string, ids: string[]): void {
  const stored = load(me);
  writeJSON<Stored>(storageKey(me), { ...stored, seen: [...new Set([...stored.seen, ...ids])] });
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(INBOX_READ_EVENT));
}
