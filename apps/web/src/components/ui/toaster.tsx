'use client';

import { Toaster as Sonner } from 'sonner';

/** App-wide toast surface, themed to the design tokens so it follows light/dark. */
export function Toaster() {
  return (
    <Sonner
      theme="system"
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
