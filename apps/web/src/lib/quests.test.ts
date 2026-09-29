import { beforeEach, describe, it, expect, vi } from 'vitest';

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
      u64: identity,
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

import { completeQuest, getStreak, getWeekBounds, timeUntilReset } from './quests';
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
      signMessage: vi.fn(),
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

  const wallet: Wallet = {
    kind: 'freighter',
    address: OWNER,
    sign: async (x) => x,
    signMessage: vi.fn(),
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
      json: async () => ({ attester: ATTESTER_HEX, sig: SIG_B64 }),
    }));
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch);
    invokeAndWaitMock.mockResolvedValueOnce('HASH');

    const r = await completeQuest(wallet, 2, { type: 'github_pr', ref: 'owner/repo#1' });

    expect(r.ok).toBe(true);
    expect(invokeAndWaitMock).toHaveBeenCalledOnce();
    const [, method, callArgs] = invokeAndWaitMock.mock.calls[0];
    expect(method).toBe('award_quest');
    expect(callArgs).toHaveLength(4);
    const [attester, sig, questId, recipient] = callArgs as [Uint8Array, Uint8Array, number, string];
    expect(attester).toBeInstanceOf(Uint8Array);
    expect(attester).toHaveLength(32);
    expect(Array.from(attester)).toEqual(Array.from(Buffer.from('ab'.repeat(32), 'hex')));
    expect(sig).toBeInstanceOf(Uint8Array);
    expect(sig).toHaveLength(64);
    expect(Array.from(sig)).toEqual(Array.from(Buffer.alloc(64, 7)));
    expect(questId).toBe(2);
    expect(recipient).toBe(OWNER);

    vi.unstubAllGlobals();
  });

  it('accepts a 0x-prefixed attester hex', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ attester: ATTESTER_HEX, sig: SIG_B64 }),
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
      json: async () => ({ attester: ATTESTER_HEX, sig: SIG_B64 }),
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
