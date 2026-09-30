/**
 * Minimal i18n — no external dependency.
 *
 * Usage (client components):
 *   const t = useTranslations();
 *   t('nav.howItWorks')           // → "How it works" | "Nasıl çalışır"
 *   t('onboard.handleFree', { handle: 'beko' }) // → "✓ @beko is free"
 *
 * Usage (server components / outside React):
 *   import { getTranslations } from '@/lib/i18n';
 *   const t = getTranslations('en');
 *   t('nav.howItWorks')
 *
 * Missing keys fall back to the English message; if that is also missing the key itself
 * is returned so there is never a blank or crash.
 */

'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { getItem, setItem } from './storage';
import { LOCALE_KEY, parseLocale, type Locale } from './locale';

// ─── types ────────────────────────────────────────────────────────────────────

export type { Locale };
export type Messages = Record<string, string>;
export type TFn = (key: string, vars?: Record<string, string>) => string;

// ─── static message imports ───────────────────────────────────────────────────
// Imported statically so both locales are bundled (they're small JSON files).

import en from '../../messages/en.json';
import tr from '../../messages/tr.json';

const MESSAGES: Record<Locale, Messages> = { en, tr };

// ─── interpolation helper ────────────────────────────────────────────────────

function interpolate(template: string, vars?: Record<string, string>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

// ─── core lookup (usable outside React) ──────────────────────────────────────

export function getTranslations(locale: Locale): TFn {
  const messages = MESSAGES[locale] ?? MESSAGES.en;
  const fallback = MESSAGES.en;
  return (key: string, vars?: Record<string, string>) => {
    const raw = messages[key] ?? fallback[key] ?? key;
    return interpolate(raw, vars);
  };
}

// ─── React context ────────────────────────────────────────────────────────────

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: TFn;
}

const I18nContext = createContext<I18nContextValue | null>(null);

/** A choice only localStorage holds (saved before the cookie existed), else the browser's language. */
function readClientLocale(): Locale | null {
  const stored = parseLocale(getItem(LOCALE_KEY));
  if (stored) return stored;
  const lang = navigator.language?.slice(0, 2).toLowerCase();
  return lang === 'tr' ? 'tr' : null;
}

/** Mirror the locale into the cookie the root layout reads, so the next load is rendered in it. */
function writeLocaleCookie(l: Locale) {
  try {
    document.cookie = `${LOCALE_KEY}=${l}; path=/; max-age=31536000; SameSite=Lax`;
  } catch {
    /* cookies unavailable */
  }
}

/**
 * `initialLocale` is the saved choice the root layout read from the cookie; the server HTML
 * and the first client render both use it, so a returning Turkish user never sees English
 * first (#236). Without a cookie, the page starts in English and, after mount, adopts a
 * choice only localStorage has or a Turkish browser language — and writes the cookie.
 */
export function I18nProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale ?? 'en');

  useEffect(() => {
    if (initialLocale) return; // the cookie already decided, on the server
    const detected = readClientLocale();
    if (!detected) return;
    setLocaleState(detected);
    writeLocaleCookie(detected);
  }, [initialLocale]);

  // <html lang> follows every switch, so assistive tech reads Turkish as Turkish (WCAG 3.1.1).
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    setItem(LOCALE_KEY, l);
    writeLocaleCookie(l);
  }, []);

  const t = useCallback<TFn>(
    (key, vars) => getTranslations(locale)(key, vars),
    [locale],
  );

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

// ─── consumer hook ────────────────────────────────────────────────────────────

export function useTranslations(): TFn {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Outside provider — return English silently (e.g. during tests or RSC).
    return getTranslations('en');
  }
  return ctx.t;
}

export function useLocale(): { locale: Locale; setLocale: (l: Locale) => void } {
  const ctx = useContext(I18nContext);
  if (!ctx) return { locale: 'en', setLocale: () => {} };
  return { locale: ctx.locale, setLocale: ctx.setLocale };
}
