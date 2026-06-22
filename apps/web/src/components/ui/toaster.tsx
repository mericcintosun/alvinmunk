'use client';

import { Toaster as Sonner } from 'sonner';

/** App-wide toast surface, themed to the cosmic tokens. */
export function Toaster() {
  return (
    <Sonner
      theme="dark"
      position="top-center"
      toastOptions={{
        style: {
          background: 'hsl(228 24% 8%)',
          border: '1px solid hsl(228 16% 16%)',
          color: 'hsl(40 33% 94%)',
        },
      }}
    />
  );
}

export { toast } from 'sonner';
