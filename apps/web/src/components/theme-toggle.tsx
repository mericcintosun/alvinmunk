'use client';

import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslations } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { getItem, removeItem, setItem } from '@/lib/storage';

/** localStorage key for an explicit theme choice. Read by the pre-paint script in the root layout. */
export const THEME_KEY = 'alvinmunk.theme';

export type Theme = 'light' | 'dark' | 'system';

const LIGHT_COLOR = '#ede7ff';
const DARK_COLOR = '#0b0512';

function systemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme(theme: 'light' | 'dark') {
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(theme);
  root.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? LIGHT_COLOR : DARK_COLOR);
}

/**
 * Light / Dark / System toggle. The root layout's inline script applies the theme before first paint
 * (explicit choice, else the OS preference), so this only reads the current class, follows
 * OS changes while System is active, and persists an explicit choice.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations();
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    const stored = getItem(THEME_KEY);
    setTheme(stored === 'light' || stored === 'dark' ? stored : 'system');
    setMounted(true);
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => {
      if (getItem(THEME_KEY)) return; // an explicit choice wins
      applyTheme(systemTheme());
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const next: Theme = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
  const label =
    next === 'light' ? t('nav.themeLight') : next === 'dark' ? t('nav.themeDark') : t('nav.themeSystem');

  return (
    <button
      type="button"
      onClick={() => {
        if (next === 'system') {
          removeItem(THEME_KEY);
          applyTheme(systemTheme());
        } else {
          applyTheme(next);
          setItem(THIE_KEY, next);
        }
        setTheme(next);
      }}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground',
        className,
      )}
    >
      <span className="inline-flex size-5 items-center justify-center">
        {mounted &&
          (theme === 'light' ? (
            <Moon className="size-5" />
          ) : theme === 'dark' ? (
            <Sun className="size-5" />
          ) : (
            <Monitor className="size-5" />
          ))}
      </span>
    </button>
  );
}
