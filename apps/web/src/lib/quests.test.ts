import { describe, it, expect, vi } from 'vitest';
import { completeQuest } from './quests';
import type { Wallet } from './wallet';

describe('completeQuest wallet guard', () => {
  it('rejects Freighter before signing or hitting the attester', async () => {
    const signMessage = vi.fn();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const wallet: Wallet = {
      kind: 'freighter',
      address: 'G'.padEnd(56, 'A'),
      sign: async (x) => x,
      signMessage,
    };

    const r = await completeQuest(wallet, 2, { type: 'referral_tx', ref: 'G'.padEnd(56, 'B') });

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/in-app wallet/i);
    expect(signMessage).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
