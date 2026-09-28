import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EVENTS } from '@alvinmunk/shared';

const {
  fetchReputationEventsMock,
  fetchTipsSentMock,
  getProfileMock,
  getCountsMock,
  getStreakMock,
  reverseHandleMock,
} = vi.hoisted(() => ({
  fetchReputationEventsMock: vi.fn(),
  fetchTipsSentMock: vi.fn(),
  getProfileMock: vi.fn(),
  getCountsMock: vi.fn(),
  getStreakMock: vi.fn(),
  reverseHandleMock: vi.fn(),
}));

vi.mock('./events', () => ({
  fetchReputationEvents: fetchReputationEventsMock,
  fetchTipsSent: fetchTipsSentMock,
}));
vi.mock('./reputation', () => ({ getProfile: getProfileMock, getCounts: getCountsMock }));
vi.mock('./quests', () => ({ getStreak: getStreakMock }));
vi.mock('./registry', () => ({ reverseHandle: reverseHandleMock }));

import {
  computeBadges,
  visibleBadges,
  foldVouchEdges,
  foldTips,
  mergeBadgeSnapshot,
  readBadgeSnapshot,
  getBadges,
  THRESHOLDS,
  type Badge,
  type BadgeId,
  type BadgeInput,
} from './badges';

const EMPTY: BadgeInput = { vouchedBy: 0, vouchedFor: 0, verified: false, streakBest: 0, tipped: false };
const find = (badges: Badge[], id: BadgeId) => badges.find((b) => b.id === id)!;
const alice = { address: 'GALICE', handle: 'alice' };

// ── computeBadges — pure, per threshold ───────────────────────────────────────

describe('computeBadges', () => {
  it('gives a fresh wallet the six badges, all locked, in catalog order', () => {
    const badges = computeBadges(EMPTY);
    expect(badges.map((b) => b.id)).toEqual([
      'firstStar',
      'connector',
      'constellation',
      'verified',
      'fourWeeks',
      'generous',
    ]);
    expect(badges.every((b) => !b.earned)).toBe(true);
    expect(badges.every((b) => b.person === undefined)).toBe(true);
  });

  it('is deterministic (pure): same input, same output', () => {
    expect(computeBadges({ ...EMPTY, vouchedBy: 3 })).toEqual(computeBadges({ ...EMPTY, vouchedBy: 3 }));
  });

  it('awards First Star on the first vouch received and names who lit it', () => {
    expect(find(computeBadges({ ...EMPTY, firstVoucher: alice }), 'firstStar')).toMatchObject({
      earned: false,
      person: undefined, // nobody is named on a locked badge
    });
    expect(find(computeBadges({ ...EMPTY, vouchedBy: 1, firstVoucher: alice }), 'firstStar')).toMatchObject({
      earned: true,
      person: alice,
    });
  });

  it('awards Connector at vouchedFor = 5 (people BACKED), counting down before it', () => {
    const at = (vouchedFor: number) => find(computeBadges({ ...EMPTY, vouchedFor }), 'connector');
    expect(at(0)).toMatchObject({ earned: false, remaining: 5, target: THRESHOLDS.CONNECTOR });
    expect(at(4)).toMatchObject({ earned: false, remaining: 1 });
    expect(at(5)).toMatchObject({ earned: true, remaining: undefined, target: 5 });
    expect(at(9)).toMatchObject({ earned: true, remaining: undefined });
    // Being vouched BY people never counts toward Connector.
    expect(find(computeBadges({ ...EMPTY, vouchedBy: 50 }), 'connector').earned).toBe(false);
  });

  it('awards Constellation at vouchedBy = 10 (people who vouched for you)', () => {
    const at = (vouchedBy: number) => find(computeBadges({ ...EMPTY, vouchedBy }), 'constellation');
    expect(at(9)).toMatchObject({ earned: false, remaining: 1, target: THRESHOLDS.CONSTELLATION });
    expect(at(10)).toMatchObject({ earned: true, remaining: undefined });
    expect(find(computeBadges({ ...EMPTY, vouchedFor: 50 }), 'constellation').earned).toBe(false);
  });

  it('awards Verified only from the verified (Earned) flag — Social activity never earns it', () => {
    expect(find(computeBadges({ ...EMPTY, vouchedBy: 20, vouchedFor: 20 }), 'verified').earned).toBe(false);
    expect(find(computeBadges({ ...EMPTY, verified: true }), 'verified').earned).toBe(true);
  });

  it('awards Four Weeks at a best streak of 4', () => {
    const at = (streakBest: number) => find(computeBadges({ ...EMPTY, streakBest }), 'fourWeeks');
    expect(at(3)).toMatchObject({ earned: false, remaining: 1, target: THRESHOLDS.FOUR_WEEKS });
    expect(at(4)).toMatchObject({ earned: true, remaining: undefined });
  });

  it('awards Generous on the first tip SENT and names the recipient', () => {
    const bob = { address: 'GBOB', handle: null };
    expect(find(computeBadges(EMPTY), 'generous').earned).toBe(false);
    expect(find(computeBadges({ ...EMPTY, tipped: true, firstTipTo: bob }), 'generous')).toMatchObject({
      earned: true,
      person: bob,
    });
  });
});

describe('visibleBadges', () => {
  const badges = computeBadges({ ...EMPTY, verified: true });

  it('shows everything outside FOCUS_MODE', () => {
    expect(visibleBadges(badges, false)).toHaveLength(6);
  });

  it('under FOCUS_MODE drops locked badges whose next step is on a hidden surface, keeps earned ones', () => {
    // Four Weeks (quests) and Generous (tips) are locked dead ends; Verified is earned → stays.
    expect(visibleBadges(badges, true).map((b) => b.id)).toEqual([
      'firstStar',
      'connector',
      'constellation',
      'verified',
    ]);
  });
});

// ── Event folds — pure ────────────────────────────────────────────────────────

const claimed = (from: string, claimer: string, id = 1) => ({
  topics: [EVENTS.VOUCH, 'claimed'],
  data: [BigInt(id), from, claimer],
});

describe('foldVouchEdges', () => {
  it('collects the distinct people on each side of the address', () => {
    const events = [
      claimed('A', 'ME'),
      claimed('B', 'ME'),
      claimed('A', 'ME', 2), // repeat pair — one person
      claimed('ME', 'C'),
      claimed('ME', 'C', 3), // repeat pair — one person
      claimed('ME', 'D'),
      claimed('X', 'Y'), // someone else's edge
    ];
    expect(foldVouchEdges(events, 'ME')).toEqual({
      vouchedBy: ['A', 'B'],
      vouchedFor: ['C', 'D'],
      firstVoucher: 'A',
    });
  });

  it('ignores other events, minted/slashed cards and malformed payloads', () => {
    const events = [
      { topics: [EVENTS.SOCIAL, 'ME'], data: [5n, 50n] },
      { topics: [EVENTS.VOUCH, 'minted'], data: [2n, 'A'] },
      { topics: [EVENTS.VOUCH, 'slashed'], data: [2n, 'ME', 10n] },
      { topics: [EVENTS.VOUCH, 'claimed'], data: 'junk' },
      { topics: [EVENTS.VOUCH, 'claimed'], data: [3n, 'A'] },
      claimed('B', 'ME'),
    ];
    expect(foldVouchEdges(events, 'ME')).toEqual({ vouchedBy: ['B'], vouchedFor: [], firstVoucher: 'B' });
  });

  it('ignores self-vouch edges defensively', () => {
    expect(foldVouchEdges([claimed('ME', 'ME')], 'ME')).toEqual({
      vouchedBy: [],
      vouchedFor: [],
      firstVoucher: undefined,
    });
  });

  it('keeps the OLDEST voucher as first (events are oldest-first)', () => {
    expect(foldVouchEdges([claimed('A', 'ME'), claimed('B', 'ME')], 'ME').firstVoucher).toBe('A');
  });
});

describe('foldTips', () => {
  // Canonical shape: topics ('tipped', from, to) · data amount.
  const tipped = (from: string, to: string) => ({ topics: [EVENTS.TIPPED, from, to], data: 1_000_000n });

  it('detects a tip sent and keeps the first recipient', () => {
    expect(foldTips([tipped('ME', 'B'), tipped('ME', 'C')], 'ME')).toEqual({ tipped: true, firstTipTo: 'B' });
  });

  it('reports no tip when the address only RECEIVED tips', () => {
    expect(foldTips([tipped('A', 'ME')], 'ME')).toEqual({ tipped: false });
  });

  it('ignores non-tip and short-topic events', () => {
    expect(foldTips([{ topics: [EVENTS.REWARD, 'ME'], data: [1, 2n, 1] }], 'ME').tipped).toBe(false);
    expect(foldTips([{ topics: [EVENTS.TIPPED, 'ME'], data: 1n }], 'ME').tipped).toBe(false);
  });
});

// ── Snapshot merge (the ~12h RPC window rolls; the people seen stay) ──────────

describe('mergeBadgeSnapshot', () => {
  const snap = (over: Partial<Parameters<typeof mergeBadgeSnapshot>[1]> = {}) => ({
    vouchedBy: [],
    vouchedFor: [],
    tipped: false,
    ...over,
  });

  it('UNIONS people across windows (a max of counts would undercount)', () => {
    const merged = mergeBadgeSnapshot(snap({ vouchedBy: ['A', 'B', 'C'] }), snap({ vouchedBy: ['C', 'D', 'E'] }));
    expect(merged.vouchedBy).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('keeps the earlier first voucher / first tip recipient over a later window', () => {
    const merged = mergeBadgeSnapshot(
      snap({ vouchedBy: ['A'], firstVoucher: 'A', tipped: true, firstTipTo: 'B' }),
      snap({ vouchedBy: ['C'], firstVoucher: 'C', tipped: true, firstTipTo: 'D' }),
    );
    expect(merged).toMatchObject({ firstVoucher: 'A', firstTipTo: 'B', tipped: true });
  });

  it('keeps a tip once seen, and takes the fresh window when nothing was stored', () => {
    expect(mergeBadgeSnapshot(snap({ tipped: true, firstTipTo: 'B' }), snap()).tipped).toBe(true);
    const fresh = snap({ vouchedBy: ['A'], firstVoucher: 'A' });
    expect(mergeBadgeSnapshot(null, fresh)).toEqual(fresh);
  });
});

describe('readBadgeSnapshot', () => {
  beforeEach(() => localStorage.clear());

  it('returns null for a missing, corrupt or wrong-shaped entry', () => {
    expect(readBadgeSnapshot('ME')).toBeNull();
    localStorage.setItem('alvinmunk.badges.ME', '{not json');
    expect(readBadgeSnapshot('ME')).toBeNull();
    localStorage.setItem('alvinmunk.badges.ME', JSON.stringify({ backedBy: 3, vouchedFor: 1 }));
    expect(readBadgeSnapshot('ME')).toBeNull();
  });
});

// ── getBadges end-to-end (mocked reads) ───────────────────────────────────────

describe('getBadges', () => {
  beforeEach(() => {
    localStorage.clear();
    fetchReputationEventsMock.mockReset().mockResolvedValue([]);
    fetchTipsSentMock.mockReset().mockResolvedValue([]);
    getProfileMock.mockReset().mockResolvedValue({ social: 0, earned: 0, verified: false });
    getCountsMock.mockReset().mockResolvedValue(null); // contract predates get_counts
    getStreakMock.mockReset().mockResolvedValue({ weeks: 0, best: 0, lastWeek: 0 });
    reverseHandleMock.mockReset().mockResolvedValue(null);
  });

  it('folds events + on-chain reads for the given address and names people by @handle', async () => {
    fetchReputationEventsMock.mockResolvedValue([claimed('GALICE', 'ME')]);
    fetchTipsSentMock.mockResolvedValue([{ topics: [EVENTS.TIPPED, 'ME', 'GBOB'], data: 5n }]);
    getProfileMock.mockResolvedValue({ social: 30, earned: 10, verified: true });
    getStreakMock.mockResolvedValue({ weeks: 4, best: 4, lastWeek: 1 });
    reverseHandleMock.mockImplementation(async (a: string) => (a === 'GALICE' ? 'alice' : null));

    const badges = await getBadges('ME');

    expect(find(badges, 'firstStar')).toMatchObject({ earned: true, person: alice });
    expect(find(badges, 'generous')).toMatchObject({ earned: true, person: { address: 'GBOB', handle: null } });
    expect(find(badges, 'verified').earned).toBe(true);
    expect(find(badges, 'fourWeeks').earned).toBe(true);
    // Every read is for the profile owner; streak is the wallet-free read (no source).
    expect(fetchTipsSentMock).toHaveBeenCalledWith('ME');
    expect(getProfileMock).toHaveBeenCalledWith('ME');
    expect(getStreakMock).toHaveBeenCalledWith('ME');
  });

  it('survives the RPC window rolling over via the per-address snapshot', async () => {
    fetchReputationEventsMock.mockResolvedValue([claimed('A', 'ME'), claimed('B', 'ME')]);
    await getBadges('ME');

    fetchReputationEventsMock.mockResolvedValue([claimed('C', 'ME')]); // A and B left the window
    const badges = await getBadges('ME');
    expect(find(badges, 'constellation').remaining).toBe(THRESHOLDS.CONSTELLATION - 3);
    expect(find(badges, 'firstStar').person?.address).toBe('A');
  });

  it("never mixes one address's history into another's (viewer vs profile owner)", async () => {
    // The viewer's own dashboard persisted five backed people and a tip.
    fetchReputationEventsMock.mockResolvedValue(['P1', 'P2', 'P3', 'P4', 'P5'].map((p) => claimed('VIEWER', p)));
    fetchTipsSentMock.mockResolvedValue([{ topics: [EVENTS.TIPPED, 'VIEWER', 'P1'], data: 1n }]);
    expect(find(await getBadges('VIEWER'), 'connector').earned).toBe(true);

    // Then they open someone else's profile: nothing of theirs may leak in.
    fetchReputationEventsMock.mockResolvedValue([]);
    fetchTipsSentMock.mockResolvedValue([]);
    const owner = await getBadges('OWNER');
    expect(owner.every((b) => !b.earned)).toBe(true);
    expect(readBadgeSnapshot('OWNER')).toEqual({
      vouchedBy: [],
      vouchedFor: [],
      firstVoucher: undefined,
      tipped: false,
      firstTipTo: undefined,
    });
  });

  it('counts people from the on-chain counters when they exceed what the events show', async () => {
    // Older vouches are out of the RPC window and this browser never saw them.
    fetchReputationEventsMock.mockResolvedValue([claimed('GALICE', 'ME')]);
    getCountsMock.mockResolvedValue({ vouchedBy: 10, backed: 4 });
    const badges = await getBadges('ME');
    expect(getCountsMock).toHaveBeenCalledWith('ME');
    expect(find(badges, 'constellation').earned).toBe(true);
    expect(find(badges, 'connector')).toMatchObject({ earned: false, remaining: 1 });
    expect(find(badges, 'firstStar').person?.address).toBe('GALICE');
  });

  it('keeps the event count when the counters started later and read lower', async () => {
    fetchReputationEventsMock.mockResolvedValue(['P1', 'P2', 'P3'].map((p) => claimed(p, 'ME')));
    getCountsMock.mockResolvedValue({ vouchedBy: 1, backed: 0 });
    const badges = await getBadges('ME');
    expect(find(badges, 'constellation').remaining).toBe(THRESHOLDS.CONSTELLATION - 3);
  });

  it('treats a failed streak read as no streak', async () => {
    getStreakMock.mockRejectedValue(new Error('quest registry not deployed'));
    expect(find(await getBadges('ME'), 'fourWeeks')).toMatchObject({ earned: false, remaining: 4 });
  });

  it('rejects when get_profile fails, instead of showing fake all-locked badges', async () => {
    getProfileMock.mockRejectedValue(new Error('rpc down'));
    await expect(getBadges('ME')).rejects.toThrow('rpc down');
  });
});
