import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepEvent } from './events';

const m = vi.hoisted(() => ({
  network: 'testnet',
  reputation: vi.fn(),
  tips: vi.fn(),
  quests: vi.fn(),
  myVouches: vi.fn(),
  getVouch: vi.fn(),
}));

vi.mock('./stellar', () => ({
  config: {
    get network() {
      return m.network;
    },
  },
}));
vi.mock('./events', () => ({
  fetchReputationEvents: m.reputation,
  fetchTipEvents: m.tips,
  fetchQuestEvents: m.quests,
}));
vi.mock('./myvouches', () => ({ getMyVouches: m.myVouches }));
vi.mock('./reputation', () => ({ getVouch: m.getVouch }));

import { INBOX_READ_EVENT, itemsFromEvents, loadInbox, markInboxRead } from './inbox';

const ME = 'GME';
const ALICE = 'GALICE';
const BOB = 'GBOB';

const ev = (topics: unknown[], data: unknown, ledger: number, extra: Partial<RepEvent> = {}): RepEvent => ({
  topics,
  data,
  ledger,
  ...extra,
});

// What the three shared windows hold: my claimed vouch among others, tips to me and to
// someone else, a quest awarded to me and to someone else, and streaks.
const REPUTATION = [
  ev(['vouch', 'claimed'], [7, ME, ALICE], 100, { closedAt: 1_000 }),
  ev(['vouch', 'claimed'], [8, BOB, ME], 101), // I claimed Bob's card: not my news
  ev(['vouch', 'minted'], [9, ME], 102),
];
const TIPS = [
  ev(['tipped', BOB, ME], 25_000_000n, 110, { id: 'tip-a', closedAt: 1_100 }),
  ev(['tipped', ME, ALICE], 10_000_000n, 111, { id: 'tip-b' }), // I sent it
];
const QUESTS = [
  ev(['quest', 'awarded'], [2, ME], 120, { id: 'q-a' }),
  ev(['quest', 'awarded'], [2, ALICE], 121, { id: 'q-b' }),
  ev(['streak', ME], [1, 1], 120, { id: 's-1' }), // week one: the award itself
  ev(['streak', ME], [3, 3], 130, { id: 's-3' }),
  ev(['quest', 'created'], [5], 90),
];

beforeEach(() => {
  m.network = 'testnet';
  localStorage.clear();
  m.reputation.mockReset().mockResolvedValue(REPUTATION);
  m.tips.mockReset().mockResolvedValue(TIPS);
  m.quests.mockReset().mockResolvedValue(QUESTS);
  m.myVouches.mockReset().mockReturnValue([]);
  m.getVouch.mockReset().mockResolvedValue(null);
});

describe('itemsFromEvents', () => {
  it('keeps only what happened TO the wallet', () => {
    const items = itemsFromEvents(ME, { reputation: REPUTATION, tips: TIPS, quests: QUESTS });
    expect(items).toEqual([
      { id: 'claim:7', kind: 'claim', ledger: 100, at: 1_000, peer: ALICE, vouchId: 7 },
      { id: 'tip:tip-a', kind: 'tip', ledger: 110, at: 1_100, peer: BOB, amount: '25000000' },
      { id: 'quest:q-a', kind: 'quest', ledger: 120, questId: 2 },
      { id: 'streak:s-3', kind: 'streak', ledger: 130, weeks: 3 },
    ]);
  });
});

describe('loadInbox', () => {
  it('reads the shared windows, newest first, all unread at first', async () => {
    const { items, unread } = await loadInbox(ME);
    expect(m.reputation).toHaveBeenCalledWith();
    expect(m.tips).toHaveBeenCalledWith();
    expect(m.quests).toHaveBeenCalledWith();
    expect(items.map((i) => i.id)).toEqual(['streak:s-3', 'quest:q-a', 'tip:tip-a', 'claim:7']);
    expect([...unread].sort()).toEqual(items.map((i) => i.id).sort());
  });

  it('keeps items past the RPC window, stored as plain JSON (amounts as strings)', async () => {
    await loadInbox(ME);
    m.reputation.mockResolvedValue([]);
    m.tips.mockResolvedValue([]);
    m.quests.mockResolvedValue([]);
    const { items } = await loadInbox(ME);
    expect(items.map((i) => i.id)).toEqual(['streak:s-3', 'quest:q-a', 'tip:tip-a', 'claim:7']);
    const stored = JSON.parse(localStorage.getItem('alvinmunk.inbox.testnet.GME')!);
    expect(stored.items.find((i: { kind: string }) => i.kind === 'tip').amount).toBe('25000000');
  });

  it('marking read clears the unread set, tells the dot, and new items come in unread', async () => {
    const first = await loadInbox(ME);
    const onRead = vi.fn();
    window.addEventListener(INBOX_READ_EVENT, onRead);
    markInboxRead(ME, [...first.unread]);
    window.removeEventListener(INBOX_READ_EVENT, onRead);
    expect(onRead).toHaveBeenCalledTimes(1);
    expect((await loadInbox(ME)).unread.size).toBe(0);

    m.tips.mockResolvedValue([...TIPS, ev(['tipped', ALICE, ME], 5_000_000n, 140, { id: 'tip-c' })]);
    const next = await loadInbox(ME);
    expect([...next.unread]).toEqual(['tip:tip-c']);
    expect(next.items[0].id).toBe('tip:tip-c');
  });

  it('never shows one network’s inbox on the other (a G… key is the same on both)', async () => {
    await loadInbox(ME);
    m.network = 'mainnet';
    m.reputation.mockResolvedValue([]);
    m.tips.mockResolvedValue([]);
    m.quests.mockResolvedValue([]);
    expect((await loadInbox(ME)).items).toEqual([]);
  });

  it("finds claims of this device's vouches older than the window, reading only unknown ones", async () => {
    m.myVouches.mockReturnValue([
      { id: 7, note: 'in the window', created: 1 },
      { id: 3, note: 'old', created: 1 },
      { id: 4, note: 'still open', created: 1 },
      { id: 5, note: 'someone else minted it on this device', created: 1 },
    ]);
    m.getVouch.mockImplementation(async (id: number) =>
      id === 3
        ? { id, from: ME, claimed: true, claimer: BOB }
        : id === 5
          ? { id, from: ALICE, claimed: true, claimer: BOB }
          : { id, from: ME, claimed: false, claimer: null },
    );
    const { items } = await loadInbox(ME);
    expect(m.getVouch).not.toHaveBeenCalledWith(7); // the window already has it
    expect(items.filter((i) => i.kind === 'claim')).toEqual([
      { id: 'claim:7', kind: 'claim', ledger: 100, at: 1_000, peer: ALICE, vouchId: 7 },
      { id: 'claim:3', kind: 'claim', ledger: 0, peer: BOB, vouchId: 3 }, // undated: last
    ]);

    m.getVouch.mockClear();
    await loadInbox(ME);
    expect(m.getVouch).not.toHaveBeenCalledWith(3); // stored now
  });

  it('still shows the stored inbox when every window fails', async () => {
    await loadInbox(ME);
    m.reputation.mockRejectedValue(new Error('rpc down'));
    m.tips.mockRejectedValue(new Error('rpc down'));
    m.quests.mockRejectedValue(new Error('rpc down'));
    await expect(loadInbox(ME)).resolves.toMatchObject({ items: expect.arrayContaining([expect.objectContaining({ id: 'tip:tip-a' })]) });
  });

  it('shares one load between the tab and the page mounting together', async () => {
    const [a, b] = await Promise.all([loadInbox(ME), loadInbox(ME)]);
    expect(b).toBe(a);
    expect(m.tips).toHaveBeenCalledTimes(1);
  });
});
