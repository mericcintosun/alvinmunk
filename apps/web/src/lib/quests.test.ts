import { describe, it, expect, vi } from 'vitest';

const { readPublicMock, readContractMock } = vi.hoisted(() => ({
  readPublicMock: vi.fn(),
  readContractMock: vi.fn(),
}));

vi.mock('./contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./contracts')>()),
  questId: () => 'CQUEST',
  readPublic: readPublicMock,
  readContract: readContractMock,
}));

import { completeQuest, getStreak } from './quests';
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
