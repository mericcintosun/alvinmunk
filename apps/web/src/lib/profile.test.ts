import { describe, it, expect, beforeEach } from 'vitest';
import { loadProfile, saveProfile, clearProfile, normalizeHandle } from './profile';

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

  it('returns null when nothing saved', () => {
    expect(loadProfile()).toBeNull();
  });

  it('clear removes the profile', () => {
    saveProfile({ handle: 'x', address: 'G', createdAt: 1 });
    clearProfile();
    expect(loadProfile()).toBeNull();
  });
});
