import { beforeEach, describe, it, expect, vi } from 'vitest';
import { scValToNative, type xdr } from '@stellar/stellar-sdk';

const { readPublicMock, readContractMock, invokeAndWaitMock } = vi.hoisted(() => ({
  readPublicMock: vi.fn(),
  readContractMock: vi.fn(),
  invokeAndWaitMock: vi.fn(),
}));

vi.mock('./contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./contracts')>()),
  questId: () => 'CQUEST',
  readPublic: readPublicMock,
  readContract: readContractMock,
  invokeAndWait: invokeAndWaitMock,
}));
import { completeQuest, getCompleted, getStreak, getWeekBounds, timeUntilReset } from './quests';
import type { Wallet } from './wallet';

beforeEach(() => {
  readPublicMock.mockReset();
  readContractMock.mockReset();
});

describe('completeQuest', () => {
  it('hits the attester and surfaces its error (no on-chain submit)', async () => {
    // The attester rejects the evidence — completeQuest must surface it and never
    // reach the on-chain award_quest call.
    const fetchSpy = vi.fn(async () => ({
      ok: false,
      status: 422,
      json: async () => ({ error: 'PR not merged' }),
    }));
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch);

    const wallet: Wallet = {
      kind: 'freighter',
      address: 'G'.padEnd(56, 'A'),
      sign: async (x) => x,
      signMessage: vi.fn(),
    };

    const r = await completeQuest(wallet, 2, { type: 'github_pr', ref: 'owner/repo#1' });

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not merged/i);
    expect(fetchSpy).toHaveBeenCalledOnce();

    vi.unstubAllGlobals();
  });

  it('explains an award refused by the attester key’s daily budget (#7)', async () => {
    vi.stubGlobal('fetch', (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ attester: '00'.repeat(32), sig: btoa('s'.repeat(64)) }),
    })) as unknown as typeof fetch);
    invokeAndWaitMock.mockRejectedValueOnce(
      new Error('HostError: Error(Contract, #7)\nEvent log (newest first): ...'),
    );
    const wallet: Wallet = {
      kind: 'freighter',
      address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      sign: async (x) => x,
      signMessage: vi.fn(),
    };

    const r = await completeQuest(wallet, 2, { type: 'referral_tx', ref: 'G'.padEnd(56, 'B') });

    expect(r).toEqual({
      ok: false,
      error: 'Quest rewards hit today’s limit — try again after 00:00 UTC.',
    });
    expect(invokeAndWaitMock).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});

describe('getCompleted', () => {
  const OWNER = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

  it('reads one flag per quest id, keyed by id, with one get_completed call', async () => {
    readContractMock.mockResolvedValueOnce([true, false, true]);
    const done = await getCompleted(OWNER, [2, 3, 4], OWNER);
    expect(done).toEqual(new Map([[2, true], [3, false], [4, true]]));
    expect(readContractMock).toHaveBeenCalledOnce();
    const [contract, method, callArgs, source] = readContractMock.mock.calls[0];
    expect([contract, method, source]).toEqual(['CQUEST', 'get_completed', OWNER]);
    expect(callArgs.map((a: xdr.ScVal) => scValToNative(a))).toEqual([OWNER, [2, 3, 4]]);
    expect(callArgs[1].vec().map((v: xdr.ScVal) => v.switch().name)).toEqual([
      'scvU32',
      'scvU32',
      'scvU32',
    ]);
  });

  it('reads wallet-free when no source is given', async () => {
    readPublicMock.mockResolvedValueOnce([false]);
    await expect(getCompleted(OWNER, [2])).resolves.toEqual(new Map([[2, false]]));
    expect(readPublicMock).toHaveBeenCalledWith('CQUEST', 'get_completed', expect.any(Array));
    expect(readContractMock).not.toHaveBeenCalled();
  });

  it('is null when the deployed contract predates get_completed', async () => {
    readContractMock.mockRejectedValueOnce(
      new Error('simulate get_completed failed: HostError: Error(WasmVm, MissingValue)'),
    );
    await expect(getCompleted(OWNER, [2, 3], OWNER)).resolves.toBeNull();
  });

  it('is null for a reply that is not one boolean per id', async () => {
    for (const v of [undefined, [], [true], [true, false, true], [true, 1], ['true', false]]) {
      readContractMock.mockResolvedValueOnce(v);
      await expect(getCompleted(OWNER, [2, 3], OWNER), JSON.stringify(v)).resolves.toBeNull();
    }
  });
});

describe('completeQuest on a completed quest', () => {
  const wallet: Wallet = {
    kind: 'freighter',
    address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    sign: async (x) => x,
    signMessage: vi.fn(),
  };

  beforeEach(() => invokeAndWaitMock.mockReset());

  it('flags the attester’s 409 as completed and never submits', async () => {
    vi.stubGlobal('fetch', (async () => ({
      ok: false,
      status: 409,
      json: async () => ({ error: 'You’ve already completed this quest.' }),
    })) as unknown as typeof fetch);
    await expect(completeQuest(wallet, 2, { type: 'vouch_back', ref: '' })).resolves.toEqual({
      ok: false,
      error: 'You’ve already completed this quest.',
      completed: true,
    });
    expect(invokeAndWaitMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('flags the contract’s AlreadyClaimed (#5) as completed', async () => {
    vi.stubGlobal('fetch', (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ attester: '00'.repeat(32), sig: btoa('s'.repeat(64)) }),
    })) as unknown as typeof fetch);
    invokeAndWaitMock.mockRejectedValueOnce(new Error('HostError: Error(Contract, #5)'));
    await expect(completeQuest(wallet, 2, { type: 'vouch_back', ref: '' })).resolves.toEqual({
      ok: false,
      error: 'You’ve already completed this quest.',
      completed: true,
    });
    // Any other failure leaves the quest available.
    invokeAndWaitMock.mockRejectedValueOnce(new Error('HostError: Error(Contract, #6)'));
    const r = await completeQuest(wallet, 2, { type: 'vouch_back', ref: '' });
    expect(r.completed).toBeUndefined();
    vi.unstubAllGlobals();
  });
});

describe('getStreak', () => {
  const OWNER = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

  it('reads wallet-free when no source is given (public profile)', async () => {
    readPublicMock.mockResolvedValueOnce({ weeks: 2, best: 5, last_week: 2900n });
    await expect(getStreak(OWNER)).resolves.toEqual({ weeks: 2, best: 5, lastWeek: 2900 });
    expect(readPublicMock).toHaveBeenCalledWith('CQUEST', 'get_streak', expect.any(Array));
    expect(readContractMock).not.toHaveBeenCalled();
  });

  it('keeps the source-account read when a source is given', async () => {
    readContractMock.mockResolvedValueOnce(undefined);
    await expect(getStreak(OWNER, OWNER)).resolves.toEqual({ weeks: 0, best: 0, lastWeek: 0 });
    expect(readContractMock).toHaveBeenCalledWith('CQUEST', 'get_streak', expect.any(Array), OWNER);
  });
});

describe('getWeekBounds', () => {
  const OWNER = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
  // Thursday 2026-10-01 00:00:00 UTC through Wednesday 2026-10-07 23:59:59 UTC.
  const START = 1_790_812_800;
  const END = START + 604_800 - 1;

  beforeEach(() => {
    readPublicMock.mockReset();
    readContractMock.mockReset();
  });

  it('maps the (start, end) u64 tuple', async () => {
    readContractMock.mockResolvedValueOnce([BigInt(START), BigInt(END)]);
    await expect(getWeekBounds(OWNER)).resolves.toEqual({ start: START, end: END });
    expect(readContractMock).toHaveBeenCalledWith('CQUEST', 'get_week_bounds', [], OWNER);
  });

  it('reads wallet-free when no source is given', async () => {
    readPublicMock.mockResolvedValueOnce([BigInt(START), BigInt(END)]);
    await expect(getWeekBounds()).resolves.toEqual({ start: START, end: END });
    expect(readPublicMock).toHaveBeenCalledWith('CQUEST', 'get_week_bounds', []);
    expect(readContractMock).not.toHaveBeenCalled();
  });

  it('is null when the deployed contract predates get_week_bounds', async () => {
    readContractMock.mockRejectedValueOnce(
      new Error('simulate get_week_bounds failed: HostError: Error(WasmVm, MissingValue)'),
    );
    await expect(getWeekBounds(OWNER)).resolves.toBeNull();
  });

  it('is null for a value that is not a week', async () => {
    for (const v of [undefined, [], [BigInt(START)], [BigInt(END), BigInt(START)], [0n, 0n]]) {
      readContractMock.mockResolvedValueOnce(v);
      await expect(getWeekBounds(OWNER), String(v)).resolves.toBeNull();
    }
  });
});

describe('timeUntilReset', () => {
  const bounds = { start: 604_800, end: 2 * 604_800 - 1 }; // the week resets at 1_209_600
  const RESET = 2 * 604_800;

  it('counts down to the second after end', () => {
    expect(timeUntilReset(bounds, bounds.start)).toEqual({ days: 7, hours: 0, minutes: 0 });
    expect(timeUntilReset(bounds, RESET - (2 * 86_400 + 3 * 3_600 + 4 * 60))).toEqual({
      days: 2,
      hours: 3,
      minutes: 4,
    });
  });

  it('rounds up to the minute so time left never reads as 0m', () => {
    expect(timeUntilReset(bounds, bounds.end)).toEqual({ days: 0, hours: 0, minutes: 1 });
    expect(timeUntilReset(bounds, RESET - 61)).toEqual({ days: 0, hours: 0, minutes: 2 });
    expect(timeUntilReset(bounds, RESET - 3_599)).toEqual({ days: 0, hours: 1, minutes: 0 });
  });

  it('is null from the reset on', () => {
    expect(timeUntilReset(bounds, RESET)).toBeNull();
    expect(timeUntilReset(bounds, RESET + 90)).toBeNull();
  });
});
