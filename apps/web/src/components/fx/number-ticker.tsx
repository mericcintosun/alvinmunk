'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useInView } from 'motion/react';
import { cn } from '@/lib/utils';
import { useLocale, type Locale } from '@/lib/i18n';

/** Locale → BCP-47 tag so figures use the active locale's separators (1.234,50 in TR). */
const NUMBER_LOCALE: Record<Locale, string> = { en: 'en-US', tr: 'tr-TR' };

/** Format a figure with the active locale's separators. Exported for tests. */
export function formatNumber(value: number, decimals: number, locale: Locale): string {
  return value.toLocaleString(NUMBER_LOCALE[locale] ?? 'en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Count-up number that animates once it scrolls into view (eased). Used for XP / USDC /
 * stats so figures feel earned, not static. Respects reduced-motion (snaps to value).
 */
export function NumberTicker({
  value,
  decimals = 0,
  durationMs = 1200,
  prefix = '',
  suffix = '',
  className,
}: {
  value: number;
  decimals?: number;
  durationMs?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  // The last value actually painted, kept in sync every tick — so a rapid update that
  // interrupts an in-flight animation resumes from wherever it visually was, instead of
  // snapping back to the last *completed* value (from.current, only updated on finish).
  const from = useRef(0);
  const displayed = useRef(0);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  const { locale } = useLocale();
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const reduce =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setDisplay(value);
      displayed.current = value;
      from.current = value;
      return;
    }
    let raf = 0;
    let startTs: number | null = null;
    const tick = (ts: number) => {
      if (startTs === null) startTs = ts;
      const p = Math.min(1, (ts - startTs) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
      const next = from.current + (value - from.current) * eased;
      displayed.current = next;
      setDisplay(next);
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        from.current = value;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      // A rapid update cancels this effect mid-flight (before `p` reaches 1, so
      // from.current above never ran) — capture exactly where the animation was so the
      // next one continues from there rather than jumping back to the old target.
      from.current = displayed.current;
    };
  }, [inView, value, durationMs]);

  return (
    <span ref={ref} className={cn('tabular-nums', className)}>
      {prefix}
      {formatNumber(display, decimals, locale)}
      {suffix}
    </span>
  );
}
