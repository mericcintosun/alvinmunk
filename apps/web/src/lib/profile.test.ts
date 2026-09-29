import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadProfile,
  saveProfile,
  clearProfile,
  normalizeHandle,
  sanitizeBio,
  bioBytes,
  BIO_MAX_BYTES,
} from './profile';

describe('normalizeHandle', () => {
  it('lowercases, strips non-alnum, and truncates to 20', () => {
    expect(normalizeHandle('Kaan!! Designer')).toBe('kaandesigner');
    expect(normalizeHandle('a'.repeat(40))).toHaveLength(20);
  });
  it('drops non-ascii characters', () => {
    expect(normalizeHandle('Renée')).toBe('rene');
  });
  it('keeps underscores and digits', () => {
    expect(normalizeHandle('dev_007')).toBe('dev_007');
  });
});

describe('profile persistence', () => {
  beforeEach(() => clearProfile());

  it('round-trips through localStorage', () => {
    saveProfile({ handle: 'kaan', address: 'GABC', createdAt: 1 });
    const p = loadProfile();
    expect(p?.handle).toBe('kaan');
    expect(p?.address).toBe('GABC');
  });

  it('round-trips an optional avatar choice', () => {
    saveProfile({ handle: 'kaan', address: 'GABC', createdAt: 1, avatar: { kind: 'face', id: 'face-03' } });
    expect(loadProfile()?.avatar).toEqual({ kind: 'face', id: 'face-03' });
  });

  it('stays backward-compatible with avatar-less profiles', () => {
    saveProfile({ handle: 'old', address: 'GOLD', createdAt: 1 });
    const p = loadProfile();
    expect(p?.handle).toBe('old');
    expect(p?.avatar).toBeUndefined();
  });

  it('returns null when nothing saved', () => {
    expect(loadProfile()).toBeNull();
  });

  it('clear removes the profile', () => {
    saveProfile({ handle: 'x', address: 'G', createdAt: 1 });
    clearProfile();
    expect(loadProfile()).toBeNull();
  });

  it('degrades gracefully when localStorage getter throws', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('SecurityError', 'SecurityError');
      },
      configurable: true,
    });

    try {
      expect(loadProfile()).toBeNull();
      expect(() => saveProfile({ handle: 'x', address: 'G', createdAt: 1 })).not.toThrow();
      expect(() => clearProfile()).not.toThrow();
    } finally {
      if (original) {
        Object.defineProperty(window, 'localStorage', original);
      }
    }
  });
});

describe('bio (registry set_meta rules)', () => {
  it('counts UTF-8 bytes, not characters', () => {
    expect(bioBytes('abc')).toBe(3);
    expect(bioBytes('ş')).toBe(2);
    expect(bioBytes('€')).toBe(3);
    expect(bioBytes('🌟')).toBe(4);
  });

  it('cuts to 80 bytes on a character boundary', () => {
    expect(sanitizeBio('a'.repeat(100))).toBe('a'.repeat(80));
    expect(sanitizeBio('ş'.repeat(41))).toBe('ş'.repeat(40)); // 82 bytes → 80
    expect(sanitizeBio('€'.repeat(27))).toBe('€'.repeat(26)); // 81 bytes → 78, never half a char
    expect(sanitizeBio('🌟'.repeat(21))).toBe('🌟'.repeat(20));
    for (const s of ['x'.repeat(79) + 'ş', 'ab' + '🌟'.repeat(30)]) {
      expect(bioBytes(sanitizeBio(s))).toBeLessThanOrEqual(BIO_MAX_BYTES);
    }
  });

  it('drops what the contract rejects and keeps it to one line', () => {
    expect(sanitizeBio('line\nbreak\ttab\r\nend')).toBe('line break tab end');
    expect(sanitizeBio('nul\u0000 del\u007f c1\u0085')).toBe('nul del c1');
    expect(sanitizeBio('a\u2028b\u2029c')).toBe('a b c');
    expect(sanitizeBio('evil\u202Etxt\u2066x\u2069')).toBe('eviltxtx');
    expect(sanitizeBio('lone \uD800 surrogate')).toBe('lone surrogate');
    expect(sanitizeBio('  lots   of   space  ')).toBe('lots of space');
  });

  it('keeps ordinary text, emoji and markup-looking characters as plain text', () => {
    const s = 'Builder — ship it! 👩‍💻 çğış <b>&amp;</b>';
    expect(sanitizeBio(s)).toBe(s);
  });

  it('can leave a trailing space while typing', () => {
    expect(sanitizeBio('hello ', { trim: false })).toBe('hello ');
    expect(sanitizeBio('hello ')).toBe('hello');
  });
});
