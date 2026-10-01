'use client';

import { useLocale, type Locale } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const LOCALES: { code: Locale; label: string; flag: string }[] = [
  { code: 'en', label: 'EN', flag: '🇬🇧' },
  { code: 'tr', label: 'TR', flag: '🇹🇷' },
];

interface Props {
  /** 'pill' renders both options side-by-side (footer default).
   *  'icon' renders a compact toggle (e.g. navbar). */
  variant?: 'pill' | 'icon';
  className?: string;
}

/**
 * Language switcher — drops into the footer (pill variant) or navbar (icon variant).
 * Persists choice to localStorage; missing keys always fall back to English.
 */
export function LanguageSwitcher({ variant = 'pill', className }: Props) {
  const { locale, setLocale } = useLocale();

  if (variant === 'icon') {
    const next = locale === 'en' ? 'tr' : 'en';
    const nextItem = LOCALES.find((l) => l.code === next)!;
    return (
      <button
        onClick={() => setLocale(next)}
        aria-label={`Switch to ${nextItem.label}`}
        className={cn(
          'inline-flex items-center gap-1 rounded-full border border-border/60 px-2.5 py-1 font-mono text-2xs uppercase tracking-wider text-muted-foreground transition-colors hover:border-border hover:text-foreground',
          className,
        )}
      >
        {nextItem.flag} {nextItem.label}
      </button>
    );
  }

  // pill — both options visible
  return (
    <div
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full border border-border/50 p-0.5',
        className,
      )}
      role="group"
      aria-label="Language"
    >
      {LOCALES.map((l) => (
        <button
          key={l.code}
          onClick={() => setLocale(l.code)}
          aria-pressed={locale === l.code}
          aria-label={`Switch to ${l.label}`}
          className={cn(
            'rounded-full px-2.5 py-0.5 font-mono text-2xs uppercase tracking-wider transition-colors',
            locale === l.code
              ? 'bg-primary/15 text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {l.flag} {l.label}
        </button>
      ))}
    </div>
  );
}
