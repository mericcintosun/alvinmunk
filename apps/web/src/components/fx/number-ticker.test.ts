import { describe, expect, it } from 'vitest';
import { formatNumber } from './number-ticker';

describe('formatNumber (#238)', () => {
  it('uses en-US separators for the en locale', () => {
    expect(formatNumber(1234.5, 2, 'en')).toBe('1,234.50');
    expect(formatNumber(1234, 0, 'en')).toBe('1,234');
  });

  it('uses tr-TR separators for the tr locale', () => {
    expect(formatNumber(1234.5, 2, 'tr')).toBe('1.234,50');
    expect(formatNumber(1234, 0, 'tr')).toBe('1.234');
  });
});
