import { describe, it, expect } from 'vitest';
import { addrHue, timeAgo } from './constellation';

const NOW = Math.floor(Date.now() / 1000);

describe('addrHue', () => {
  it('is deterministic for the same address', () => {
    const a = 'G'.padEnd(56, 'A');
    expect(addrHue(a)).toBe(addrHue(a));
  });

  it('stays within the 0-359 hue range', () => {
    for (const a of ['', 'G'.padEnd(56, 'A'), 'G'.padEnd(56, 'B'), 'short']) {
      const h = addrHue(a);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });

  it('differs for different addresses', () => {
    expect(addrHue('G'.padEnd(56, 'A'))).not.toBe(addrHue('G'.padEnd(56, 'B')));
  });
});

describe('timeAgo', () => {
  it('returns empty for a falsy timestamp', () => {
    expect(timeAgo(0)).toBe('');
  });

  it('reads recent times warmly', () => {
    expect(timeAgo(NOW)).toBe('today');
    expect(timeAgo(NOW - 86_400)).toBe('yesterday');
    expect(timeAgo(NOW - 3 * 86_400)).toBe('3 days ago');
  });

  it('rolls up into weeks and months', () => {
    expect(timeAgo(NOW - 14 * 86_400)).toBe('2 weeks ago');
    expect(timeAgo(NOW - 7 * 86_400)).toBe('1 week ago');
    expect(timeAgo(NOW - 60 * 86_400)).toBe('2 months ago');
  });
});
