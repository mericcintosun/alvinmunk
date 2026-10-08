'use client';

import { useLocale, useTranslations, type Locale } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// Each option is named in its own language, so the names read the same in both catalogs — an
// endonym is never translated. The keys keep that text beside every other string.
const LOCALES: { code: Locale; nameKey: string }[] = [
  { code: 'en', nameKey: 'language.en' },
  { code: 'tr', nameKey: 'language.tr' },
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
 *
 * No flags: Windows renders a regional-indicator pair as the bare letters ("GB EN" /
 * "TR TR"), which reads as a typo (#511). The label is the endonym instead, and every
 * option carries its own `lang` so assistive tech pronounces it in that language.
 */
export function LanguageSwitcher({ variant = 'pill', className }: Props) {
  const { locale, setLocale } = useLocale();
  const t = useTranslations();
  const name = (code: Locale) => t(LOCALES.find((l) => l.code === code)!.nameKey);

  if (variant === 'icon') {
    const next = locale === 'en' ? 'tr' : 'en';
    const action = t('language.switchTo', { language: name(next) });
    return (
      <button
        type="button"
        onClick={() => setLocale(next)}
        aria-label={action}
        title={action}
        className={cn(
          'inline-flex items-center gap-1 rounded-full border border-border/60 px-2.5 py-1 font-mono text-2xs tracking-wider text-muted-foreground transition-colors hover:border-border hover:text-foreground',
          className,
        )}
      >
        <span lang={next}>{name(next)}</span>
      </button>
    );
  }

  // pill — both options visible. The name is the button's own label (carrying its `lang`),
  // so the group's label plus `aria-pressed` say which language is active.
  return (
    <div
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full border border-border/50 p-0.5',
        className,
      )}
      role="group"
      aria-label={t('language.label')}
    >
      {LOCALES.map((l) => (
        <button
          key={l.code}
          type="button"
          onClick={() => setLocale(l.code)}
          aria-pressed={locale === l.code}
          lang={l.code}
          className={cn(
            'rounded-full px-2.5 py-0.5 font-mono text-2xs tracking-wider transition-colors',
            locale === l.code
              ? 'bg-primary/15 text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {name(l.code)}
        </button>
      ))}
    </div>
  );
}
