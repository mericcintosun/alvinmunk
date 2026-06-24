'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Meteors (Magic-UI style) — faint diagonal streaks drifting across a section, for the
 * "living cosmos" feel. Decorative + reduced-motion safe. Generated after mount to avoid
 * SSR hydration mismatch (random positions).
 */
export function Meteors({ number = 16, className }: { number?: number; className?: string }) {
  const [items, setItems] = useState<{ left: string; delay: string; duration: string }[]>([]);

  useEffect(() => {
    setItems(
      Array.from({ length: number }, () => ({
        left: `${Math.floor(Math.random() * 100)}%`,
        delay: `${(Math.random() * 5).toFixed(2)}s`,
        duration: `${(4 + Math.random() * 5).toFixed(2)}s`,
      })),
    );
  }, [number]);

  return (
    <div className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)} aria-hidden>
      {items.map((m, i) => (
        <span
          key={i}
          className="absolute top-0 size-0.5 rotate-[215deg] rounded-full bg-starlight/80 shadow-[0_0_0_1px_hsl(var(--starlight)/0.08)] motion-safe:animate-meteor before:absolute before:top-1/2 before:h-px before:w-[60px] before:-translate-y-1/2 before:bg-gradient-to-r before:from-starlight/70 before:to-transparent before:content-['']"
          style={{ left: m.left, animationDelay: m.delay, animationDuration: m.duration }}
        />
      ))}
    </div>
  );
}
