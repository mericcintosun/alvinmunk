'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTranslations } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/** localStorage key for an explicit theme choice. Read by the pre-paint script in the root layout. */
export const THEME_KEY = 'alvinmunk.theme';

type Theme = 'light' | 'dark';

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(theme);
  root.style.colorScheme = theme;
}

/**
 * Light/dark toggle. The root layout's inline script applies the theme before first paint
 * (explicit choice, else the OS preference), so this only reads the current class, follows
 * OS changes until the user picks one, and persists an explicit choice.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations();
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    setTheme(document.documentElement.classList.contains('light') ? 'light' : 'dark');
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = (e: MediaQueryListEvent) => {
      try {
        if (localStorage.getItem(THEME_KEY)) return; // an explicit choice wins
      } catch {
        // storage blocked: keep following the OS
      }
      const next: Theme = e.matches ? 'light' : 'dark';
      applyTheme(next);
      setTheme(next);
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const next: Theme = theme === 'light' ? 'dark' : 'light';
  const label = next === 'light' ? t('nav.themeLight') : t('nav.themeDark');

  return (
    <button
      type="button"
      onClick={() => {
        applyTheme(next);
        setTheme(next);
        try {
          localStorage.setItem(THEME_KEY, next);
        } catch {
          // storage blocked: the choice lasts for this page view only
        }
      }}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground',
        className,
      )}
    >
      {theme === 'light' ? <Moon className="size-5" /> : <Sun className="size-5" />}
    </button>
  );
}
