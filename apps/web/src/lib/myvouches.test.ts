/**
 * getOwedBonuses — the voucher bonuses still waiting on the people you vouched (#275).
 * Chain reads are mocked; the stored vouches are real localStorage entries.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PendingBonusView, VouchView } from './reputation';

const { getVouchMock, getPendingMock, reverseHandleMock } = vi.hoisted(() => ({
  getVouchMock: vi.fn(),
  getPendingMock: vi.fn(),
  reverseHandleMock: vi.fn(),
}));

vi.mock('./reputation', () => ({
  getVouch: getVouchMock,
  getPending: getPendingMock,
  VOUCH_TTL_SECS: 604_800,
}));
vi.mock('./registry', () => ({ reverseHandle: reverseHandleMock }));
vi.mock('./push', () => ({ subscribeToPush: vi.fn() }));

import { addMyVouch, getOwedBonuses } from './myvouches';

const ME = 'GME';
const OTHER_WALLET = 'GOTHER';
const BOB = 'GBOB';
const EVE = 'GEVE';
const CAROL = 'GCAROL';

/** Store vouch `id` locally and make get_vouch report it. */
function mint(id: number, opts: { claimer?: string | null; from?: string; note?: string } = {}) {
  addMyVouch({ id, secret: 's', note: opts.note ?? `note ${id}`, created: 0 });
  const v: VouchView = {
    id,
    from: opts.from ?? ME,
    note: opts.note ?? `note ${id}`,
    claimed: !!opts.claimer,
    claimer: opts.claimer ?? null,
    created: 0,
    stake: 5,
    slashed: false,
  };
  vouches.set(id, v);
}

let vouches: Map<number, VouchView>;
let pending: Map<string, PendingBonusView[]>;

beforeEach(() => {
  localStorage.clear();
  vouches = new Map();
  pending = new Map();
  getVouchMock.mockReset().mockImplementation(async (id: number) => vouches.get(id) ?? null);
  getPendingMock.mockReset().mockImplementation(async (c: string) => pending.get(c) ?? []);
  reverseHandleMock.mockReset().mockResolvedValue(null);
});

describe('getOwedBonuses', () => {
  it('is empty without stored vouches, and reads nothing', async () => {
    expect(await getOwedBonuses(ME)).toEqual([]);
    expect(getVouchMock).not.toHaveBeenCalled();
    expect(getPendingMock).not.toHaveBeenCalled();
  });

  it('skips unclaimed half-cards (no bonus is queued before a claim)', async () => {
    mint(1, { claimer: null });
    expect(await getOwedBonuses(ME)).toEqual([]);
    expect(getPendingMock).not.toHaveBeenCalled();
  });

  it('lists the bonus a claimer owes me, named by @handle', async () => {
    mint(1, { claimer: BOB, note: 'unblocked me at 2am' });
    pending.set(BOB, [{ voucher: ME, amount: 5 }]);
    reverseHandleMock.mockImplementation(async (a: string) => (a === BOB ? 'bob' : null));

    expect(await getOwedBonuses(ME)).toEqual([
      { claimer: BOB, handle: 'bob', note: 'unblocked me at 2am', amount: 5 },
    ]);
    expect(getPendingMock).toHaveBeenCalledWith(BOB);
  });

  it('drops the row once the claimer verifies and their queue is paid out', async () => {
    mint(1, { claimer: BOB });
    pending.set(BOB, [{ voucher: ME, amount: 5 }]);
    expect(await getOwedBonuses(ME)).toHaveLength(1);

    pending.set(BOB, []); // first verified quest: the contract flushes Pending(bob)
    expect(await getOwedBonuses(ME)).toEqual([]);
  });

  it("counts only my entries in a claimer's queue", async () => {
    mint(1, { claimer: BOB });
    pending.set(BOB, [
      { voucher: CAROL, amount: 5 },
      { voucher: ME, amount: 5 },
      { voucher: EVE, amount: 5 },
    ]);
    expect(await getOwedBonuses(ME)).toMatchObject([{ claimer: BOB, amount: 5 }]);
  });

  it('is empty when the queue only holds other vouchers', async () => {
    mint(1, { claimer: BOB });
    pending.set(BOB, [{ voucher: CAROL, amount: 5 }]);
    expect(await getOwedBonuses(ME)).toEqual([]);
  });

  it('gives one row per person, reading their queue once', async () => {
    mint(1, { claimer: BOB, note: 'first' });
    mint(2, { claimer: BOB, note: 'again' }); // repeat pair
    pending.set(BOB, [{ voucher: ME, amount: 5 }]);

    const rows = await getOwedBonuses(ME);
    expect(rows).toHaveLength(1);
    expect(rows[0].note).toBe('again'); // newest vouch first
    expect(getPendingMock).toHaveBeenCalledTimes(1);
  });

  it('ignores vouches another wallet minted in this browser', async () => {
    mint(1, { claimer: BOB, from: OTHER_WALLET });
    pending.set(BOB, [{ voucher: OTHER_WALLET, amount: 5 }]);
    expect(await getOwedBonuses(ME)).toEqual([]);
    expect(getPendingMock).not.toHaveBeenCalled();
  });

  it('lists several people, largest bonus first', async () => {
    mint(1, { claimer: BOB });
    mint(2, { claimer: EVE });
    pending.set(BOB, [{ voucher: ME, amount: 5 }]);
    pending.set(EVE, [{ voucher: ME, amount: 10 }]);

    const rows = await getOwedBonuses(ME);
    expect(rows.map((r) => [r.claimer, r.amount])).toEqual([
      [EVE, 10],
      [BOB, 5],
    ]);
  });

  it('drops only the person whose read failed (e.g. a contract without get_pending)', async () => {
    mint(1, { claimer: BOB });
    mint(2, { claimer: EVE });
    mint(3, { claimer: CAROL });
    pending.set(EVE, [{ voucher: ME, amount: 5 }]);
    getPendingMock.mockImplementation(async (c: string) => {
      if (c === BOB) throw new Error('simulate get_pending failed: MissingValue');
      return pending.get(c) ?? [];
    });
    getVouchMock.mockImplementation(async (id: number) => {
      if (id === 3) throw new Error('rpc timeout');
      return vouches.get(id) ?? null;
    });

    expect(await getOwedBonuses(ME)).toMatchObject([{ claimer: EVE, amount: 5 }]);
  });

  it('falls back to the address when the handle lookup fails', async () => {
    mint(1, { claimer: BOB });
    pending.set(BOB, [{ voucher: ME, amount: 5 }]);
    reverseHandleMock.mockRejectedValue(new Error('registry down'));
    expect(await getOwedBonuses(ME)).toMatchObject([{ claimer: BOB, handle: null }]);
  });
});
