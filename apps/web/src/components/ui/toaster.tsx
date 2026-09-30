'use client';

import { useEffect, useState } from 'react';
import { Toaster as Sonner } from 'sonner';

/** App-wide toast surface, themed to the design tokens so it follows light/dark. */
export function Toaster() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setTheme(root.classList.contains('light') ? 'light' : 'dark');
    sync();
    const observer = new MutationObserver(sync, { attributes: true, attributeFilter: ['class'] });
    observer.observe(root);
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
