'use client';

import { useEffect, useState } from 'react';
import { Toaster as Sonner } from 'sonner';
import { currentTheme, type ResolvedTheme } from '@/lib/theme';

/**
 * App-wide toast surface, themed to the design tokens. Sonner gets the app's theme (the
 * `html.light` / `.dark` class the toggle sets), not "system", so a toast never follows the
 * OS against the chosen theme.
 */
export function Toaster() {
  const [theme, setTheme] = useState<ResolvedTheme>('dark');

  useEffect(() => {
    const sync = () => setTheme(currentTheme());
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return (
    <Sonner
      theme={theme}
      position="top-center"
      toastOptions={{
        style: {
          background: 'hsl(var(--popover))',
          border: '1px solid hsl(var(--border))',
          color: 'hsl(var(--popover-foreground))',
        },
      }}
    />
  );
}

export { toast } from 'sonner';
