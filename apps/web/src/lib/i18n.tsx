/**
 * Minimal i18n — no external dependency.
 *
 * Usage (client components):
 *   const t = useTranslations();
 *   t('nav.howItWorks')           // → "How it works" | "Nasıl çalışır"
 *   t('onboard.landing.handleFree', { handle: 'beko' }) // → "✓ @beko is free"
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

// ─── types ────────────────────────────────────────────────────────────────────

export type Locale = 'en' | 'tr';
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

const STORAGE_KEY = 'alvinmunk_locale';

function readStoredLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  const stored = getItem(STORAGE_KEY);
  if (stored === 'en' || stored === 'tr') return stored;
  // Auto-detect from browser language if no preference stored yet.
  const lang = navigator.language?.slice(0, 2).toLowerCase();
  return lang === 'tr' ? 'tr' : 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  // Start with 'en' to avoid hydration mismatch; swap after mount.
  const [locale, setLocaleState] = useState<Locale>('en');

  useEffect(() => {
    setLocaleState(readStoredLocale());
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    setItem(STORAGE_KEY, l);
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
