import { describe, it, expect, vi } from 'vitest';
import { completeQuest } from './quests';
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
