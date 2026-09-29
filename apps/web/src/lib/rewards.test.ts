import { describe, it, expect } from 'vitest';
import { usdcToStroops, stroopsToUsdc, InvalidAmountError, isValidAmount } from './rewards';

/**
 * Money-handling helpers are pure but high-stakes (a wrong factor mis-sends USDC), so
 * they get their own unit + round-trip coverage. USDC has 7 decimals (1 = 10_000_000).
 */
describe('usdcToStroops', () => {
  it('parses whole + fractional USDC into stroops', () => {
    expect(usdcToStroops('1')).toBe(10_000_000n);
    expect(usdcToStroops('2.5')).toBe(25_000_000n);
    expect(usdcToStroops('0.0000001')).toBe(1n);
    expect(usdcToStroops(' 3 ')).toBe(30_000_000n);
  });

  it('accepts comma as decimal separator (locale-tolerant)', () => {
    expect(usdcToStroops('2,5')).toBe(25_000_000n);
    expect(usdcToStroops('1,23')).toBe(12_300_000n);
    expect(usdcToStroops('0,5')).toBe(5_000_000n);
  });

  it('truncates beyond 7 decimals (never rounds up → never over-pays)', () => {
    expect(usdcToStroops('1.123456789')).toBe(11_234_567n);
    expect(usdcToStroops('2,999999999')).toBe(29_999_999n);
  });

  it('rejects negative amounts', () => {
    expect(() => usdcToStroops('-1.5')).toThrow(InvalidAmountError);
    expect(() => usdcToStroops('-0.5')).toThrow(InvalidAmountError);
    expect(() => usdcToStroops('-1')).toThrow(InvalidAmountError);
  });

  it('rejects multi-dot inputs', () => {
    expect(() => usdcToStroops('1.2.3')).toThrow(InvalidAmountError);
    expect(() => usdcToStroops('1,2,3')).toThrow(InvalidAmountError);
    expect(() => usdcToStroops('1.2,3')).toThrow(InvalidAmountError);
  });

  it('rejects exponent notation', () => {
    expect(() => usdcToStroops('1e3')).toThrow(InvalidAmountError);
    expect(() => usdcToStroops('1E3')).toThrow(InvalidAmountError);
    expect(() => usdcToStroops('1.5e2')).toThrow(InvalidAmountError);
  });

  it('rejects non-numeric input', () => {
    expect(() => usdcToStroops('abc')).toThrow(InvalidAmountError);
    expect(() => usdcToStroops('1abc')).toThrow(InvalidAmountError);
    expect(() => usdcToStroops('1.5abc')).toThrow(InvalidAmountError);
  });

  it('rejects zero or empty input', () => {
    expect(() => usdcToStroops('0')).toThrow(InvalidAmountError);
    expect(() => usdcToStroops('0.0')).toThrow(InvalidAmountError);
    expect(() => usdcToStroops('')).toThrow(InvalidAmountError);
    expect(() => usdcToStroops('  ')).toThrow(InvalidAmountError);
  });

  it('rejects sub-stroop input (values that round to zero)', () => {
    expect(() => usdcToStroops('0.00000001')).toThrow(InvalidAmountError);
    expect(() => usdcToStroops('0.000000001')).toThrow(InvalidAmountError);
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
    for (const v of ['1', '2.5', '0.5', '12.3456789', '100']) {
      const back = stroopsToUsdc(usdcToStroops(v));
      expect(usdcToStroops(back)).toBe(usdcToStroops(v));
    }
  });

  it('works with comma separator too', () => {
    const back = stroopsToUsdc(usdcToStroops('2,5'));
    expect(back).toBe('2.5');
    expect(usdcToStroops(back)).toBe(usdcToStroops('2,5'));
  });
});

describe('isValidAmount', () => {
  it('returns true for valid amounts', () => {
    expect(isValidAmount('1')).toBe(true);
    expect(isValidAmount('2.5')).toBe(true);
    expect(isValidAmount('2,5')).toBe(true);
    expect(isValidAmount('0.5')).toBe(true);
    expect(isValidAmount('100')).toBe(true);
    expect(isValidAmount('0.0000001')).toBe(true);
  });

  it('returns false for invalid amounts', () => {
    expect(isValidAmount('0')).toBe(false);
    expect(isValidAmount('')).toBe(false);
    expect(isValidAmount('-1.5')).toBe(false);
    expect(isValidAmount('1.2.3')).toBe(false);
    expect(isValidAmount('1e3')).toBe(false);
    expect(isValidAmount('abc')).toBe(false);
    expect(isValidAmount('0.00000001')).toBe(false);
  });
});
