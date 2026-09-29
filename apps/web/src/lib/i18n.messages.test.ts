import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import tr from '../../messages/tr.json';

type Messages = Record<string, string>;

describe('message tables (#238)', () => {
  it('keeps en and tr keys in lockstep', () => {
    expect(Object.keys(tr as Messages).sort()).toEqual(Object.keys(en as Messages).sort());
  });

  it('has every money-flow string in both locales', () => {
    const prefixes = ['tip.', 'quests.', 'rewards.', 'unlockables.'];
    const keys = Object.keys(en as Messages).filter((k) => prefixes.some((p) => k.startsWith(p)));
    // tip/quests/rewards/unlockables — the four untranslated surfaces from #238.
    expect(keys.length).toBeGreaterThan(80);
    for (const k of keys) {
      expect((en as Messages)[k], `en ${k}`).toBeTruthy();
      expect((tr as Messages)[k], `tr ${k}`).toBeTruthy();
    }
  });
});
