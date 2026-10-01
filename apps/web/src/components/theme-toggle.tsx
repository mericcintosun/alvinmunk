'use client';

import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslations } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { getItem, remove, setItem } from '@/lib/storage';
import {
  applyTheme,
  syncThemeColor,
  systemTheme,
  THEME_KEY,
  type ThemeChoice,
} from '@/lib/theme';

/** localStorage key for an explicit theme choice. Read by the pre-paint script in the root layout. */
export { THEME_KEY };

function storedChoice(): ThemeChoice {
  const saved = getItem(THEME_KEY);
  return saved === 'light' || saved === 'dark' ? saved : 'system';
}

// One button cycles Light → Dark → System; its icon and label name the next step.
const NEXT: Record<ThemeChoice, ThemeChoice> = { light: 'dark', dark: 'system', system: 'light' };
const LABEL = { light: 'nav.themeLight', dark: 'nav.themeDark', system: 'nav.themeSystem' } as const;
const ICON = { light: Sun, dark: Moon, system: Monitor };

/**
 * Light / Dark / System toggle. The root layout's inline script applies the theme before first
 * paint (explicit choice, else the OS preference), so this only reads the saved choice,
 * follows OS changes while the choice is System, and persists (or, for System, clears) it.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations();
  // Null until mounted: the server can't see the saved choice, so it renders an empty icon slot
  // and a neutral label instead of a guess that flips on hydration.
  const [choice, setChoice] = useState<ThemeChoice | null>(null);

  useEffect(() => {
    setChoice(storedChoice());
    syncThemeColor();
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => {
      if (storedChoice() === 'system') applyTheme(systemTheme());
    };
    media.addEventListener('change', onChange);
    // Next may re-render the theme-color metas on navigation: pin the new ones to the theme too.
    const head = new MutationObserver(syncThemeColor);
    head.observe(document.head, { childList: true });
    return () => {
      media.removeEventListener('change', onChange);
      head.disconnect();
    };
  }, []);

  const next = choice && NEXT[choice];
  const label = next ? t(LABEL[next]) : t('nav.theme');
  const Icon = next && ICON[next];

  return (
    <button
      type="button"
      onClick={() => {
        const to = NEXT[choice ?? storedChoice()];
        if (to === 'system') {
          remove(THEME_KEY);
          applyTheme(systemTheme());
        } else {
          setItem(THEME_KEY, to);
          applyTheme(to);
        }
        setChoice(to);
      }}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground',
        className,
      )}
    >
      <span className="inline-flex size-5 items-center justify-center" aria-hidden="true">
        {Icon && <Icon className="size-5" />}
      </span>
    </button>
  );
}
