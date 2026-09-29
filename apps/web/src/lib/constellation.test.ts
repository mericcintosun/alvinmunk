import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RepEvent } from './events';

const { getCountsMock, fetchEventsMock } = vi.hoisted(() => ({
  getCountsMock: vi.fn(),
  fetchEventsMock: vi.fn(),
}));

vi.mock('./reputation', () => ({ getCounts: getCountsMock, getVouch: vi.fn() }));
vi.mock('./events', () => ({ fetchReputationEvents: fetchEventsMock }));

import { addrHue, getPeopleCounts, suggestPeople, timeAgo } from './constellation';

const NOW = Math.floor(Date.now() / 1000);

describe('addrHue', () => {
  it('is deterministic for the same address', () => {
    const a = 'G'.padEnd(56, 'A');
    expect(addrHue(a)).toBe(addrHue(a));
  });

  it('stays within the 0-359 hue range', () => {
    for (const a of ['', 'G'.padEnd(56, 'A'), 'G'.padEnd(56, 'B'), 'short']) {
      const h = addrHue(a);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });

  it('differs for different addresses', () => {
    expect(addrHue('G'.padEnd(56, 'A'))).not.toBe(addrHue('G'.padEnd(56, 'B')));
  });
});

describe('timeAgo', () => {
  it('returns empty for a falsy timestamp', () => {
    expect(timeAgo(0)).toBe('');
  });

  it('reads recent times warmly', () => {
    expect(timeAgo(NOW)).toBe('today');
    expect(timeAgo(NOW - 86_400)).toBe('yesterday');
    expect(timeAgo(NOW - 3 * 86_400)).toBe('3 days ago');
  });

  it('rolls up into weeks and months', () => {
    expect(timeAgo(NOW - 14 * 86_400)).toBe('2 weeks ago');
    expect(timeAgo(NOW - 7 * 86_400)).toBe('1 week ago');
    expect(timeAgo(NOW - 60 * 86_400)).toBe('2 months ago');
  });
});

const ME = 'G'.padEnd(56, 'M');
const A = 'G'.padEnd(56, 'A');
const B = 'G'.padEnd(56, 'B');
const C = 'G'.padEnd(56, 'C');

const claimed = (id: number, from: string, claimer: string): RepEvent => ({
  topics: ['vouch', 'claimed'],
  data: [id, from, claimer],
  ledger: id,
});

describe('getPeopleCounts', () => {
  beforeEach(() => {
    getCountsMock.mockReset();
    fetchEventsMock.mockReset();
  });

  it('keeps the durable counters when they exceed the recent window', async () => {
    getCountsMock.mockResolvedValue({ vouchedBy: 4, backed: 2 });
    fetchEventsMock.mockResolvedValue([claimed(1, A, ME)]);
    expect(await getPeopleCounts(ME)).toEqual({ vouchedBy: 4, backed: 2 });
  });

  it('fills a counter that is still 0 from the recent claim events', async () => {
    getCountsMock.mockResolvedValue({ vouchedBy: 3, backed: 0 });
    fetchEventsMock.mockResolvedValue([claimed(1, ME, A), claimed(2, ME, B), claimed(3, C, ME)]);
    expect(await getPeopleCounts(ME)).toEqual({ vouchedBy: 3, backed: 2 });
  });

  it('never reads lower than the distinct people in the window', async () => {
    // A repeat of a pair first claimed before the counters existed: the counter skips it.
    getCountsMock.mockResolvedValue({ vouchedBy: 1, backed: 0 });
    fetchEventsMock.mockResolvedValue([claimed(1, A, ME), claimed(2, B, ME), claimed(3, B, ME)]);
    expect(await getPeopleCounts(ME)).toEqual({ vouchedBy: 2, backed: 0 });
  });

  it('falls back to events when the deployed contract has no get_counts', async () => {
    getCountsMock.mockResolvedValue(null);
    fetchEventsMock.mockResolvedValue([claimed(1, A, ME), claimed(2, B, ME), claimed(3, ME, C)]);
    expect(await getPeopleCounts(ME)).toEqual({ vouchedBy: 2, backed: 1 });
  });

  it('reads 0 for a wallet with no vouches anywhere', async () => {
    getCountsMock.mockResolvedValue({ vouchedBy: 0, backed: 0 });
    fetchEventsMock.mockResolvedValue([claimed(1, A, B)]);
    expect(await getPeopleCounts(ME)).toEqual({ vouchedBy: 0, backed: 0 });
  });
});

// ── suggestPeople ──────────────────────────────────────────────────────────────

/**
 * Helpers for building `vouch:claimed` events in the shape the engine expects.
 * data = [vouchId, from, claimer], topics = ['vouch', 'claimed']
 */
function claimedEdge(vouchId: number, from: string, claimer: string) {
  return { topics: ['vouch', 'claimed'], data: [vouchId, from, claimer] };
}

// Stable test addresses
const ME2 = 'G'.padEnd(56, 'M');
const A2 = 'G'.padEnd(56, 'A');
const B2 = 'G'.padEnd(56, 'B');
const C2 = 'G'.padEnd(56, 'C');
const D2 = 'G'.padEnd(56, 'D');
const E2 = 'G'.padEnd(56, 'E');
const F2 = 'G'.padEnd(56, 'F');

describe('suggestPeople', () => {
  it('returns an empty array when there are no events', () => {
    expect(suggestPeople(ME2, [], 6)).toEqual([]);
  });

  it('returns nothing when the viewer is isolated in the graph', () => {
    // A and B know each other but ME has no edges at all
    const events = [claimedEdge(1, A2, B2)];
    expect(suggestPeople(ME2, events, 6)).toEqual([]);
  });

  it('suggests a second-degree neighbour', () => {
    // ME → A → C: C is second-degree, A is direct
    const events = [
      claimedEdge(1, ME2, A2), // ME directly connected to A
      claimedEdge(2, A2, C2),  // A connected to C
    ];
    const results = suggestPeople(ME2, events, 6);
    expect(results).toHaveLength(1);
    expect(results[0].address).toBe(C2);
    expect(results[0].sharedCount).toBe(1);
    expect(results[0].handle).toBeNull();
  });

  it('never suggests the viewer themselves', () => {
    // A self-loop won't happen on-chain, but the engine must be defensive
    const events = [
      claimedEdge(1, ME2, A2),
      claimedEdge(2, A2, ME2), // A vouched ME back → ME is "second-degree" through A
    ];
    const results = suggestPeople(ME2, events, 6);
    expect(results.every((s) => s.address !== ME2)).toBe(true);
  });

  it('never suggests someone already directly connected', () => {
    // ME – A – B – ME: B is directly vouched by ME, so not a suggestion
    const events = [
      claimedEdge(1, ME2, A2),
      claimedEdge(2, A2, B2),
      claimedEdge(3, ME2, B2), // direct edge ME↔B
    ];
    const results = suggestPeople(ME2, events, 6);
    expect(results.every((s) => s.address !== B2)).toBe(true);
    expect(results.every((s) => s.address !== A2)).toBe(true);
  });

  it('ranks by shared-connection count, highest first', () => {
    // ME knows A and B.
    // C is vouched by A and B   → sharedCount 2
    // D is vouched by A only    → sharedCount 1
    const events = [
      claimedEdge(1, ME2, A2),
      claimedEdge(2, ME2, B2),
      claimedEdge(3, A2, C2),
      claimedEdge(4, B2, C2),
      claimedEdge(5, A2, D2),
    ];
    const results = suggestPeople(ME2, events, 6);
    expect(results[0].address).toBe(C2);
    expect(results[0].sharedCount).toBe(2);
    expect(results[1].address).toBe(D2);
    expect(results[1].sharedCount).toBe(1);
  });

  it('treats vouches as undirected (A vouched B means B also knows A)', () => {
    // ME → A (ME minted a vouch for A).
    // B → A (B minted a vouch for A): B is reachable from ME via A, sharedCount = 1.
    const events = [
      claimedEdge(1, ME2, A2),
      claimedEdge(2, B2, A2), // reversed direction — still an undirected edge A↔B
    ];
    const results = suggestPeople(ME2, events, 6);
    expect(results).toHaveLength(1);
    expect(results[0].address).toBe(B2);
  });

  it('respects the max cap', () => {
    // ME knows A; A knows B, C, D, E, F — five candidates
    const events = [
      claimedEdge(1, ME2, A2),
      claimedEdge(2, A2, B2),
      claimedEdge(3, A2, C2),
      claimedEdge(4, A2, D2),
      claimedEdge(5, A2, E2),
      claimedEdge(6, A2, F2),
    ];
    expect(suggestPeople(ME2, events, 3)).toHaveLength(3);
    expect(suggestPeople(ME2, events, 6)).toHaveLength(5);
  });

  it('is stable and deterministic: same input → same output order', () => {
    const events = [
      claimedEdge(1, ME2, A2),
      claimedEdge(2, A2, C2),
      claimedEdge(3, A2, D2),
    ];
    const r1 = suggestPeople(ME2, events, 6);
    const r2 = suggestPeople(ME2, events, 6);
    expect(r1.map((s) => s.address)).toEqual(r2.map((s) => s.address));
  });

  it('ignores non-vouch events gracefully', () => {
    const events = [
      { topics: ['tipped', ME2, A2], data: [1, ME2, A2] },
      { topics: ['vouch', 'minted'], data: [1, ME2, A2] }, // minted, not claimed
      claimedEdge(2, ME2, A2),
      claimedEdge(3, A2, C2),
    ];
    const results = suggestPeople(ME2, events, 6);
    expect(results).toHaveLength(1);
    expect(results[0].address).toBe(C2);
  });

  it('skips malformed event data without throwing', () => {
    const events = [
      { topics: ['vouch', 'claimed'], data: [] },           // too short
      { topics: ['vouch', 'claimed'], data: [1, ME2] },     // missing claimer
      claimedEdge(2, ME2, A2),
      claimedEdge(3, A2, B2),
    ];
    expect(() => suggestPeople(ME2, events, 6)).not.toThrow();
    const results = suggestPeople(ME2, events, 6);
    expect(results[0].address).toBe(B2);
  });
});
