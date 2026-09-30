'use client';

import React, { useEffect, useRef, useState } from 'react';
import { getWeekBounds, timeUntilReset, type TimeLeft, type WeekBounds } from '@/lib/quests';
import { useLocale, useTranslations, type TFn } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const TICK_MS = 30_000;

/** Countdown copy: days + hours, then hours + minutes, then minutes. */
function resetCopy(t: TFn, left: TimeLeft | null): string {
  if (!left) return t('quests.week.resetting');
  const { days, hours, minutes } = left;
  if (days > 0) return t('quests.week.resetsInDays', { days: String(days), hours: String(hours) });
  if (hours > 0) {
    return t('quests.week.resetsInHours', { hours: String(hours), minutes: String(minutes) });
  }
  return t('quests.week.resetsInMinutes', { minutes: String(minutes) });
}

/**
 * Time left in the current streak week, from the QuestRegistry's `get_week_bounds` — the
 * client never re-derives the week formula (weeks start Thursday 00:00 UTC, not Monday).
 * The hover title gives the reset moment in local time. Once the week is over it re-reads
 * the bounds and calls `onRollover`, at most once per tick: the ledger can trail the wall
 * clock by a few seconds and still report the old week. Renders nothing while loading or
 * when the deployed contract predates the view.
 */
export function WeekReset({
  address,
  onRollover,
  className,
}: {
  address: string;
  onRollover?: () => void;
  className?: string;
}) {
  const t = useTranslations();
  const { locale } = useLocale();
  const [bounds, setBounds] = useState<WeekBounds | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [reads, setReads] = useState(0);
  // The latest callback, so a parent re-render doesn't restart the tick interval.
  const onRolloverRef = useRef(onRollover);
  useEffect(() => {
    onRolloverRef.current = onRollover;
  });

  useEffect(() => {
    let alive = true;
    getWeekBounds(address).then((b) => {
      if (alive) setBounds(b);
    });
    return () => {
      alive = false;
    };
  }, [address, reads]);

  useEffect(() => {
    if (!bounds) return;
    const tick = () => {
      const secs = Math.floor(Date.now() / 1000);
      setNow(secs);
      return secs;
    };
    tick();
    const id = setInterval(() => {
      if (tick() > bounds.end) {
        setReads((n) => n + 1);
        onRolloverRef.current?.();
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [bounds]);

  if (!bounds) return null;

  const resetAt = new Date((bounds.end + 1) * 1000).toLocaleString(locale, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  return (
    <span
      className={cn('font-mono text-2xs text-muted-foreground', className)}
      title={t('quests.week.resetsAt', { when: resetAt })}
    >
      {resetCopy(t, timeUntilReset(bounds, now))}
    </span>
  );
}
