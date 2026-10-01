/**
 * The saved language (#236). Server-safe on purpose — no `'use client'` — so the root layout
 * can read the same cookie `I18nProvider` writes (a client module's exports are only client
 * references on the server).
 */
export type Locale = 'en' | 'tr';

/** localStorage key and cookie name of the chosen locale. */
export const LOCALE_KEY = 'alvinmunk_locale';

/** A stored value as a locale; null for anything else (absent, stale, tampered). */
export function parseLocale(value: string | null | undefined): Locale | null {
  return value === 'en' || value === 'tr' ? value : null;
}
