/**
 * Number and date formatting for a locale (#493) — one place that decides how a figure or
 * date reads, so the same Social XP never shows as "1.234" on one page, "1234" on the next
 * and the server's default on a third. Server-safe on purpose (no `'use client'`, like
 * lib/locale): a server component calls getFormat with the locale cookie; client components
 * use useFormat from lib/i18n, which follows the active locale.
 */
import type { Locale } from './locale';

/** Locale → BCP-47 tag: en groups thousands with ',' (1,234), tr with '.' (1.234). */
export const LOCALE_TAG: Record<Locale, string> = { en: 'en-US', tr: 'tr-TR' };

export interface Formatters {
  /** A figure with the locale's digit grouping; `options` for decimals (e.g. a balance). */
  number: (value: number, options?: Intl.NumberFormatOptions) => string;
  /** A calendar date, medium style: "Sep 30, 2026" | "30 Eyl 2026". Date or epoch ms. */
  date: (value: Date | number) => string;
}

const FORMATTERS = new Map<Locale, Formatters>();

/** The formatters for `locale` (English for anything unknown), cached so the value is stable. */
export function getFormat(locale: Locale): Formatters {
  const known: Locale = Object.prototype.hasOwnProperty.call(LOCALE_TAG, locale) ? locale : 'en';
  let f = FORMATTERS.get(known);
  if (!f) {
    const tag = LOCALE_TAG[known];
    const numbers = new Intl.NumberFormat(tag);
    const dates = new Intl.DateTimeFormat(tag, { dateStyle: 'medium' });
    f = {
      number: (value, options) =>
        (options ? new Intl.NumberFormat(tag, options) : numbers).format(value),
      date: (value) => dates.format(value),
    };
    FORMATTERS.set(known, f);
  }
  return f;
}
