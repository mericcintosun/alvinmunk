import { describe, it, expect } from 'vitest';
import { usdcToStroops, stroopsToUsdc } from './rewards';

/**
 * Money-handling helpers are pure but high-stakes (a wrong factor mis-sends USDC), so
 * they get their own unit + round-trip coverage. USDC has 7 decimals (1 = 10_000_000).
 */
describe('usdcToStroops', () => {
  it('parses whole + fractional USDC into stroops', () => {
    expect(usdcToStroops('1')).toBe(10_000_000n);
    expect(usdcToStroops('2.5')).toBe(25_000_000n);
    expect(usdcToStroops('0.0000001')).toBe(1n);
    expect(usdcToStroops('0')).toBe(0n);
    expect(usdcToStroops('')).toBe(0n);
    expect(usdcToStroops(' 3 ')).toBe(30_000_000n);
  });

  it('truncates beyond 7 decimals (never rounds up → never over-pays)', () => {
    expect(usdcToStroops('1.123456789')).toBe(11_234_567n);
  });
});

describe('stroopsToUsdc', () => {
  it('formats stroops back to a trimmed display string', () => {
    expect(stroopsToUsdc(10_000_000n)).toBe('1');
    expect(stroopsToUsdc(25_000_000n)).toBe('2.5');
    expect(stroopsToUsdc(1n)).toBe('0.0000001');
    expect(stroopsToUsdc(0n)).toBe('0');
    expect(stroopsToUsdc(5_000_000n)).toBe('0.5');
  });
});

describe('round-trip', () => {
  it('display -> stroops -> display is stable', () => {
    for (const v of ['1', '2.5', '0.5', '12.3456789', '100', '0.0000001']) {
      const back = stroopsToUsdc(usdcToStroops(v));
      expect(usdcToStroops(back)).toBe(usdcToStroops(v));
    }
  });
});
