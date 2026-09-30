import { describe, expect, it } from 'vitest';
import { getFormat } from './format';
import type { Locale } from './locale';

// A fixed noon UTC, so the calendar day is the same in every test-runner time zone.
const SEP_30 = Date.UTC(2026, 8, 30, 12);

describe('getFormat (#493)', () => {
  it('groups thousands for the locale: 1,234 in English, 1.234 in Turkish', () => {
    expect(getFormat('en').number(1234)).toBe('1,234');
    expect(getFormat('tr').number(1234)).toBe('1.234');
    expect(getFormat('en').number(99_999)).toBe('99,999');
    expect(getFormat('tr').number(1_234_567)).toBe('1.234.567');
    expect(getFormat('en').number(0)).toBe('0');
    expect(getFormat('tr').number(999)).toBe('999');
  });

  it('takes number options, e.g. a two-decimal balance', () => {
    const two = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
    expect(getFormat('en').number(1234.5, two)).toBe('1,234.50');
    expect(getFormat('tr').number(1234.5, two)).toBe('1.234,50');
    // The options never leak into the plain formatter.
    expect(getFormat('en').number(1234.5)).toBe('1,234.5');
  });

  it('formats a date for the locale, from a Date or epoch milliseconds', () => {
    expect(getFormat('en').date(SEP_30)).toBe('Sep 30, 2026');
    expect(getFormat('tr').date(SEP_30)).toBe('30 Eyl 2026');
    expect(getFormat('en').date(new Date(SEP_30))).toBe('Sep 30, 2026');
  });

  it('is stable per locale and falls back to English for an unknown one', () => {
    expect(getFormat('tr')).toBe(getFormat('tr'));
    expect(getFormat('xx' as Locale).number(1234)).toBe('1,234');
    expect(getFormat('constructor' as Locale).number(1234)).toBe('1,234');
  });
});
