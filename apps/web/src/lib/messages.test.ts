import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import tr from '../../messages/tr.json';

describe('messages', () => {
  it('defines the same keys in en and tr', () => {
    expect(Object.keys(tr).sort()).toEqual(Object.keys(en).sort());
  });

  // #240: landing and /app onboarding share one `onboard.*` set. The claim page and the
  // app-only account-restore copy keep their own namespaces, but never re-declare a shared key.
  it('keeps one set of onboarding messages', () => {
    const keys = Object.keys(en);
    expect(keys.filter((k) => k.startsWith('onboard.landing.'))).toEqual([]);
    const shared = new Set(keys.filter((k) => /^onboard\.[^.]+$/.test(k)).map((k) => k.slice('onboard.'.length)));
    const redeclared = keys.filter((k) => k.startsWith('onboard.app.') && shared.has(k.slice('onboard.app.'.length)));
    expect(redeclared).toEqual([]);
  });
});
