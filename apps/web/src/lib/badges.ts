/**
 * Milestone badges (Green belt, belts/04 §UX: "milestone badges auto-generated" + a
 * badge gallery on the profile) — badges that NAME PEOPLE.
 *
 * `computeBadges(input)` is PURE: plain counts in, badge states out — no clock, no network,
 * no copy (the gallery localizes). Every input is a public read of Social / verified state,
 * so badges grant nothing and unlock nothing cashable (belts/08 two-track split).
 *
 * Faces over numbers: a badge tied to one person carries that person — the first voucher
 * for First Star ("lit by @alice"), the first tip recipient for Generous.
 *
 * Sources:
 *   - get_counts              → the durable on-chain people counters (first-pair claims)
 *   - `vouch:claimed` events → distinct people on each side of the address, and who was
 *                              first (the counters can't name anyone, and miss pairs
 *                              claimed before they existed)
 *   - `tipped` events         → first tip sent (Generous)
 *   - get_profile.verified    → Verified
 *   - get_streak.best         → Four Weeks
 * The RPC event window is ~12h, so the people seen are kept in a per-address
 * localStorage snapshot (the leaderboard pattern) and union-merged on every load.
 */
import { EVENTS } from '@alvinmunk/shared';
import type { StickerName } from './assets';
import { fetchReputationEvents, fetchTipsSent, type RepEvent } from './events';
import { getCounts, getProfile } from './reputation';
import { getStreak } from './quests';
import { reverseHandle } from './registry';

// ── Public shapes ─────────────────────────────────────────────────────────────

/** A person a badge names: always an address, plus their @handle when they claimed one. */
export interface BadgePerson {
  address: string;
  handle: string | null;
}

/** Everything the pure engine needs — no wallets, no promises. */
export interface BadgeInput {
  /** distinct people who vouched for this address (claimed half-cards) */
  vouchedBy: number;
  /** distinct people this address vouched for */
  vouchedFor: number;
  /** get_profile.verified — at least one attester-verified (Earned) action */
  verified: boolean;
  /** get_streak.best — best run of consecutive quest weeks */
  streakBest: number;
  /** has sent at least one USDC tip */
  tipped: boolean;
  /** the first person who vouched for this address, when known */
  firstVoucher?: BadgePerson;
  /** the first person this address tipped, when known */
  firstTipTo?: BadgePerson;
}

export type BadgeId = 'firstStar' | 'connector' | 'constellation' | 'verified' | 'fourWeeks' | 'generous';

/** Where a badge's next step happens — FOCUS_MODE hides everything but `social`. */
export type BadgeSurface = 'social' | 'quests' | 'tips';

export interface Badge {
  id: BadgeId;
  earned: boolean;
  sticker: StickerName;
  surface: BadgeSurface;
  /** Count milestones: the threshold ("vouched for 5 people"). */
  target?: number;
  /** Count milestones while locked: steps left ("2 more people to back"). */
  remaining?: number;
  /** Person-tied badges once earned: who made it happen ("lit by @alice"). */
  person?: BadgePerson;
}

// ── The catalog (thresholds) ──────────────────────────────────────────────────

export const THRESHOLDS = {
  CONNECTOR: 5,
  CONSTELLATION: 10,
  FOUR_WEEKS: 4,
} as const;

function countBadge(
  id: BadgeId,
  sticker: StickerName,
  surface: BadgeSurface,
  have: number,
  target: number,
): Badge {
  const earned = have >= target;
  return { id, sticker, surface, earned, target, remaining: earned ? undefined : target - have };
}

/** PURE — the whole badge engine, in a fixed catalog order. */
export function computeBadges(input: BadgeInput): Badge[] {
  const lit = input.vouchedBy >= 1;
  return [
    // First Star — the first claimed vouch RECEIVED, named after whoever lit it.
    { id: 'firstStar', sticker: 'star-lime', surface: 'social', earned: lit, person: lit ? input.firstVoucher : undefined },
    // Connector — vouched FOR 5 people (giving, not receiving).
    countBadge('connector', 'hand-shake', 'social', input.vouchedFor, THRESHOLDS.CONNECTOR),
    // Constellation — vouched BY 10 people.
    countBadge('constellation', 'star-arc', 'social', input.vouchedBy, THRESHOLDS.CONSTELLATION),
    // Verified — the first attester-verified action. Social activity can never earn it.
    { id: 'verified', sticker: 'stamp-verified', surface: 'quests', earned: input.verified },
    // Four Weeks — a 4-week best streak on the weekly quests.
    countBadge('fourWeeks', 'stamp-strip', 'quests', input.streakBest, THRESHOLDS.FOUR_WEEKS),
    // Generous — the first USDC tip SENT, named after its recipient.
    { id: 'generous', sticker: 'ticker-coin', surface: 'tips', earned: input.tipped, person: input.tipped ? input.firstTipTo : undefined },
  ];
}

/**
 * FOCUS_MODE hides the quests + tips surface (belts/08), so a LOCKED badge whose next step
 * lives there would be a dead end. Earned badges always stay — they are facts.
 */
export function visibleBadges(badges: Badge[], focusMode: boolean): Badge[] {
  return focusMode ? badges.filter((b) => b.earned || b.surface === 'social') : badges;
}

// ── Event folds (pure) ────────────────────────────────────────────────────────

type ChainEvent = Pick<RepEvent, 'topics' | 'data'>;

/** The people on each side of one address, as seen in some event window. */
export interface VouchEdges {
  vouchedBy: string[];
  vouchedFor: string[];
  /** earliest voucher seen (events are oldest-first) */
  firstVoucher?: string;
}

/**
 * Fold `vouch:claimed` events — data (vouch_id, from, claimer) — into the DISTINCT people
 * who vouched for `address` and whom it vouched for. A repeated pair counts once, like the
 * contract's first-pair-only XP.
 */
export function foldVouchEdges(events: ChainEvent[], address: string): VouchEdges {
  const by = new Set<string>();
  const vouchedFor = new Set<string>();
  let firstVoucher: string | undefined;
  for (const { topics, data } of events) {
    if (topics[0] !== EVENTS.VOUCH || topics[1] !== 'claimed') continue;
    if (!Array.isArray(data) || data.length < 3) continue;
    const from = String(data[1]);
    const claimer = String(data[2]);
    if (from === claimer) continue; // rejected on-chain (SelfVouch); belt and braces
    if (claimer === address) {
      by.add(from);
      firstVoucher ??= from;
    } else if (from === address) {
      vouchedFor.add(claimer);
    }
  }
  return { vouchedBy: [...by], vouchedFor: [...vouchedFor], firstVoucher };
}

/** Fold `tipped` events — topics ('tipped', from, to) — into "has `address` tipped, and whom first". */
export function foldTips(events: ChainEvent[], address: string): { tipped: boolean; firstTipTo?: string } {
  for (const { topics } of events) {
    if (topics[0] === EVENTS.TIPPED && topics.length >= 3 && String(topics[1]) === address) {
      return { tipped: true, firstTipTo: String(topics[2]) };
    }
  }
  return { tipped: false };
}

// ── Snapshot (RPC events are ephemeral; the people seen are not) ──────────────

/** Everything this browser has seen for ONE address. */
export interface BadgeSnapshot extends VouchEdges {
  tipped: boolean;
  firstTipTo?: string;
}

const SNAPSHOT_PREFIX = 'alvinmunk.badges.';

const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];

/**
 * Merge a fresh window into what was seen before: people are only ever added, and the
 * first voucher / first tip recipient seen EARLIER stays first (a later window's "first"
 * is just its oldest event).
 */
export function mergeBadgeSnapshot(prev: BadgeSnapshot | null, fresh: BadgeSnapshot): BadgeSnapshot {
  if (!prev) return fresh;
  return {
    vouchedBy: union(prev.vouchedBy, fresh.vouchedBy),
    vouchedFor: union(prev.vouchedFor, fresh.vouchedFor),
    firstVoucher: prev.firstVoucher ?? fresh.firstVoucher,
    tipped: prev.tipped || fresh.tipped,
    firstTipTo: prev.firstTipTo ?? fresh.firstTipTo,
  };
}

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const optString = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** The snapshot for `address`, or null when absent, unreadable, or not in the current shape. */
export function readBadgeSnapshot(address: string): BadgeSnapshot | null {
  try {
    const raw = JSON.parse(localStorage.getItem(SNAPSHOT_PREFIX + address) ?? 'null') as Record<string, unknown> | null;
    if (!raw || !isStrings(raw.vouchedBy) || !isStrings(raw.vouchedFor)) return null;
    return {
      vouchedBy: raw.vouchedBy,
      vouchedFor: raw.vouchedFor,
      firstVoucher: optString(raw.firstVoucher),
      tipped: raw.tipped === true,
      firstTipTo: optString(raw.firstTipTo),
    };
  } catch {
    return null; // storage blocked or corrupt — the live window still renders
  }
}

function writeBadgeSnapshot(address: string, s: BadgeSnapshot): void {
  try {
    localStorage.setItem(SNAPSHOT_PREFIX + address, JSON.stringify(s));
  } catch {
    // storage blocked (private mode) — badges still render from the live window
  }
}

// ── The one async entry point the UI calls ────────────────────────────────────

async function personOf(address: string | undefined): Promise<BadgePerson | undefined> {
  if (!address) return undefined;
  return { address, handle: await reverseHandle(address).catch(() => null) };
}

/**
 * Read everything the badges need for `address` — the PROFILE OWNER, never the viewer —
 * and compute them. All reads run in parallel and reuse what the page is already fetching:
 * the event scan, get_profile and get_counts are shared with concurrent callers, and the tip
 * read is filtered to this sender on the RPC side. The event, streak and counter reads fail
 * soft; a failed get_profile rejects, so the gallery shows an error instead of fake
 * all-locked badges.
 */
export async function getBadges(address: string): Promise<Badge[]> {
  const [events, tips, profile, streak, counts] = await Promise.all([
    fetchReputationEvents(),
    fetchTipsSent(address),
    getProfile(address),
    getStreak(address).catch(() => ({ best: 0 })),
    getCounts(address),
  ]);

  const seen = mergeBadgeSnapshot(readBadgeSnapshot(address), {
    ...foldVouchEdges(events, address),
    ...foldTips(tips, address),
  });
  writeBadgeSnapshot(address, seen);

  const [firstVoucher, firstTipTo] = await Promise.all([personOf(seen.firstVoucher), personOf(seen.firstTipTo)]);

  // Both are lower bounds on the same number — the counters miss pre-upgrade pairs, the
  // snapshot misses whatever this browser never saw — so the larger one wins.
  return computeBadges({
    vouchedBy: Math.max(seen.vouchedBy.length, counts?.vouchedBy ?? 0),
    vouchedFor: Math.max(seen.vouchedFor.length, counts?.backed ?? 0),
    verified: profile.verified,
    streakBest: streak.best,
    tipped: seen.tipped,
    firstVoucher,
    firstTipTo,
  });
}
