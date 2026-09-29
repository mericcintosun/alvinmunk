import { beforeEach, describe, it, expect, vi } from 'vitest';
import { scValToNative, type xdr } from '@stellar/stellar-sdk';

const { readPublicMock, readContractMock, invokeAndWaitMock, argsMock } = vi.hoisted(() => {
  // Identity stand-ins for every `args.*` ScVal builder (real ./contracts) so
  // completeQuest's tests can assert the raw bytes/number/string it hands
  // invokeAndWait, instead of an opaque ScVal. Every other caller in this file
  // (getStreak, getWeekBounds) only asserts it was called with `expect.any(Array)`,
  // so passing the raw value through unwrapped doesn't affect them.
  const identity = (v: unknown) => v;
  return {
    readPublicMock: vi.fn(),
    readContractMock: vi.fn(),
    invokeAndWaitMock: vi.fn(),
    argsMock: {
      addr: identity,
      addrs: identity,
      u32: identity,
      u32s: identity,
      u64: vi.fn(identity),
      i128: identity,
      bool: identity,
      str: identity,
      sym: identity,
      bytes: identity,
    },
  };
});

vi.mock('./contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./contracts')>()),
  questId: () => 'CQUEST',
  readPublic: readPublicMock,
  readContract: readContractMock,
  invokeAndWait: invokeAndWaitMock,
  args: argsMock,
}));

import { completeQuest, getCompleted, getQuestPeriods, getStreak, getWeekBounds, timeUntilReset } from './quests';
import type { Wallet } from './wallet';

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
    };

    const r = await completeQuest(wallet, 2, { type: 'github_pr', ref: 'owner/repo#1' });

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not merged/i);
    expect(fetchSpy).toHaveBeenCalledOnce();

    vi.unstubAllGlobals();
  });

  const OWNER = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
  const ATTESTER_HEX = '0x' + 'ab'.repeat(32);
  const SIG_B64 = Buffer.alloc(64, 7).toString('base64');
  const EXPIRES_AT = 1_790_813_400; // the signature's expiry, unix seconds

  const wallet: Wallet = {
    kind: 'freighter',
    address: OWNER,
    sign: async (x) => x,
  };

  beforeEach(() => {
    invokeAndWaitMock.mockReset();
    readPublicMock.mockReset();
    readContractMock.mockReset();
  });

  it('builds award_quest with the attester key, signature, quest id and recipient', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ attester: ATTESTER_HEX, sig: SIG_B64, expiresAt: EXPIRES_AT }),
    }));
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch);
    invokeAndWaitMock.mockResolvedValueOnce('HASH');

    const r = await completeQuest(wallet, 2, { type: 'github_pr', ref: 'owner/repo#1' });

    expect(r.ok).toBe(true);
    expect(invokeAndWaitMock).toHaveBeenCalledOnce();
    const [, method, callArgs] = invokeAndWaitMock.mock.calls[0];
    expect(method).toBe('award_quest');
    expect(callArgs).toHaveLength(5);
    const [attester, sig, questId, recipient, expiresAt] = callArgs as [
      Uint8Array,
      Uint8Array,
      number,
      string,
      bigint,
    ];
    expect(attester).toBeInstanceOf(Uint8Array);
    expect(attester).toHaveLength(32);
    expect(Array.from(attester)).toEqual(Array.from(Buffer.from('ab'.repeat(32), 'hex')));
    expect(sig).toBeInstanceOf(Uint8Array);
    expect(sig).toHaveLength(64);
    expect(Array.from(sig)).toEqual(Array.from(Buffer.alloc(64, 7)));
    expect(questId).toBe(2);
    expect(recipient).toBe(OWNER);
    expect(expiresAt).toBe(BigInt(EXPIRES_AT));

    vi.unstubAllGlobals();
  });

  it('accepts a 0x-prefixed attester hex', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ attester: ATTESTER_HEX, sig: SIG_B64, expiresAt: EXPIRES_AT }),
    }));
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch);
    invokeAndWaitMock.mockResolvedValueOnce('HASH');

    await completeQuest(wallet, 2, { type: 'github_pr', ref: 'owner/repo#1' });

    const [, , callArgs] = invokeAndWaitMock.mock.calls[0];
    const [attester] = callArgs as [Uint8Array, Uint8Array, number, string];
    expect(attester).toHaveLength(32);
    expect(Array.from(attester)).toEqual(Array.from(Buffer.from('ab'.repeat(32), 'hex')));

    vi.unstubAllGlobals();
  });

  it('fails when the attester omits sig', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ attester: ATTESTER_HEX }),
    }));
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch);

    const r = await completeQuest(wallet, 2, { type: 'github_pr', ref: 'owner/repo#1' });

    expect(r.ok).toBe(false);
    expect(invokeAndWaitMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('humanizes a contract error from invokeAndWait', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ attester: ATTESTER_HEX, sig: SIG_B64, expiresAt: EXPIRES_AT }),
    }));
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch);
    invokeAndWaitMock.mockRejectedValueOnce(new Error('HostError: Error(Contract, #3)'));

    const r = await completeQuest(wallet, 2, { type: 'github_pr', ref: 'owner/repo#1' });

    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();

    vi.unstubAllGlobals();
  });

  it('posts only what the attester reads — no timestamp (#182)', async () => {
    // Ownership is proven on-chain by require_auth, so the route reads no timestamp.
    const fetchSpy = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: false,
      status: 422,
      json: async () => ({ error: 'PR not merged' }),
    }));
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch);
    const evidence = { type: 'github_pr', ref: 'owner/repo#1' } as const;

    await completeQuest(wallet, 2, evidence);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/attest');
    expect(JSON.parse(init.body as string)).toEqual({ questId: 2, recipient: OWNER, evidence });
    vi.unstubAllGlobals();
  });

  it('explains an award refused by the attester key’s daily budget (#7)', async () => {
    vi.stubGlobal('fetch', (async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        attester: '00'.repeat(32),
        sig: btoa('s'.repeat(64)),
        expiresAt: 1_790_813_400,
      }),
    })) as unknown as typeof fetch);
    invokeAndWaitMock.mockRejectedValueOnce(
      new Error('HostError: Error(Contract, #7)\nEvent log (newest first): ...'),
    );
    const wallet: Wallet = {
      kind: 'freighter',
      address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      sign: async (x) => x,
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

describe('completeQuest signature expiry', () => {
  const wallet: Wallet = {
    kind: 'freighter',
    address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    sign: async (x) => x,
  };
  const attested = (extra: Record<string, unknown>) =>
    vi.stubGlobal('fetch', (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ attester: '00'.repeat(32), sig: btoa('s'.repeat(64)), ...extra }),
    })) as unknown as typeof fetch);

  beforeEach(() => invokeAndWaitMock.mockReset());

  it('submits the signed expiry as the fifth award_quest argument, a u64', async () => {
    attested({ expiresAt: 1_790_813_400 });
    invokeAndWaitMock.mockResolvedValueOnce(undefined);
    await expect(completeQuest(wallet, 2, { type: 'vouch_back', ref: '' })).resolves.toEqual({
      ok: true,
    });
    const [contract, method, callArgs] = invokeAndWaitMock.mock.calls[0];
    expect([contract, method, callArgs.length]).toEqual(['CQUEST', 'award_quest', 5]);
    // `args` is an identity stand-in here (see the top of the file): the raw value, and
    // that it went through the u64 builder.
    expect(callArgs[4]).toBe(1_790_813_400n);
    expect(argsMock.u64).toHaveBeenLastCalledWith(1_790_813_400n);
    vi.unstubAllGlobals();
  });

  it('refuses an attester response without a usable expiry, before any submit', async () => {
    for (const expiresAt of [undefined, null, '1790813400', 1.5, -1 / 0]) {
      attested({ expiresAt });
      const r = await completeQuest(wallet, 2, { type: 'vouch_back', ref: '' });
      expect(r.ok, String(expiresAt)).toBe(false);
    }
    expect(invokeAndWaitMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('explains a signature that expired before it reached the chain (#8)', async () => {
    attested({ expiresAt: 1_790_813_400 });
    invokeAndWaitMock.mockRejectedValueOnce(
      new Error('HostError: Error(Contract, #8)\nEvent log (newest first): ...'),
    );
    const r = await completeQuest(wallet, 2, { type: 'vouch_back', ref: '' });
    expect(r).toEqual({
      ok: false,
      error: 'The quest approval expired before it reached the chain — complete the quest again.',
    });
    vi.unstubAllGlobals();
  });
});

describe('getCompleted', () => {
  const OWNER = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

  beforeEach(() => {
    readPublicMock.mockReset();
    readContractMock.mockReset();
  });

  it('reads one flag per quest id, keyed by id, with one get_completed call', async () => {
    readContractMock.mockResolvedValueOnce([true, false, true]);
    const done = await getCompleted(OWNER, [2, 3, 4], OWNER);
    expect(done).toEqual(new Map([[2, true], [3, false], [4, true]]));
    expect(readContractMock).toHaveBeenCalledOnce();
    const [contract, method, callArgs, source] = readContractMock.mock.calls[0];
    expect([contract, method, source]).toEqual(['CQUEST', 'get_completed', OWNER]);
    // `args` is an identity stand-in here (see the top of the file): the raw (who, ids).
    expect(callArgs).toEqual([OWNER, [2, 3, 4]]);
  });

  it('encodes the ids as a vector of u32, the type get_completed takes', async () => {
    const { args } = await vi.importActual<typeof import('./contracts')>('./contracts');
    const ids = args.u32s([2, 3, 4]);
    expect(ids.vec()!.map((v: xdr.ScVal) => v.switch().name)).toEqual(['scvU32', 'scvU32', 'scvU32']);
    expect(scValToNative(ids)).toEqual([2, 3, 4]);
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
      json: async () => ({
        attester: '00'.repeat(32),
        sig: btoa('s'.repeat(64)),
        expiresAt: 1_790_813_400,
      }),
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

  beforeEach(() => {
    readPublicMock.mockReset();
    readContractMock.mockReset();
  });

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

  it('defaults a missing struct to zeros', async () => {
    readPublicMock.mockResolvedValueOnce(undefined);
    await expect(getStreak(OWNER)).resolves.toEqual({ weeks: 0, best: 0, lastWeek: 0 });
    expect(readPublicMock).toHaveBeenCalledWith('CQUEST', 'get_streak', expect.any(Array));
    expect(readContractMock).not.toHaveBeenCalled();
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

describe('getQuestPeriods', () => {
  const OWNER = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

  beforeEach(() => {
    readPublicMock.mockReset();
    readContractMock.mockReset();
  });

  it('reads one period per quest id, keyed by id, with one get_quest_periods call', async () => {
    readContractMock.mockResolvedValueOnce([0n, 604_800n, 0n]);
    await expect(getQuestPeriods([2, 3, 4], OWNER)).resolves.toEqual(
      new Map([[2, 0], [3, 604_800], [4, 0]]),
    );
    expect(readContractMock).toHaveBeenCalledWith('CQUEST', 'get_quest_periods', [[2, 3, 4]], OWNER);
  });

  it('reads wallet-free when no source is given', async () => {
    readPublicMock.mockResolvedValueOnce([86_400n]);
    await expect(getQuestPeriods([2])).resolves.toEqual(new Map([[2, 86_400]]));
    expect(readContractMock).not.toHaveBeenCalled();
  });

  it('is null when the view is missing, the read fails or the reply is not one period per id', async () => {
    readContractMock.mockRejectedValueOnce(new Error('simulate get_quest_periods failed'));
    await expect(getQuestPeriods([2, 3], OWNER)).resolves.toBeNull();
    for (const reply of [[0n], 'x', [0n, -1], [0n, 'week']]) {
      readContractMock.mockResolvedValueOnce(reply);
      await expect(getQuestPeriods([2, 3], OWNER)).resolves.toBeNull();
    }
  });
});
