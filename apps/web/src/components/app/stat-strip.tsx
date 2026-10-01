'use client';

import React, { useEffect, useState } from 'react';
import { Sparkles, Users, ShieldCheck } from 'lucide-react';
import { getScores, type PeopleCounts } from '@/lib/reputation';
import { getPeopleCounts } from '@/lib/constellation';
import { StateArt } from '@/components/ui/state-art';
import { cn } from '@/lib/utils';
import { useFormat, useTranslations } from '@/lib/i18n';

/**
 * Dashboard stat strip — the at-a-glance reputation summary that anchors the app shell.
 * Reads both XP tracks for the signed-in address plus how many people vouched for it —
 * the durable on-chain count (see getPeopleCounts), not a Social XP roll-up and not just
 * the recent event window. Refreshes on mount and on a slow interval (paused while the tab
 * is hidden) so the numbers catch up after a vouch / claim / quest without a full reload.
 * Skeletons show only until the first read lands; a refresh keeps the last numbers up.
 */
const REFRESH_MS = 15_000;
/** People counts also scan the RPC event window (see getPeopleCounts), so they poll slower. */
const PEOPLE_REFRESH_MS = 60_000;

type Tile = {
  key: 'vouchedBy' | 'social' | 'earned';
  icon: typeof Sparkles;
  tint: string;
};

const TILES: Tile[] = [
  { key: 'vouchedBy', icon: Sparkles, tint: 'text-accent' },
  { key: 'social', icon: Users, tint: 'text-tertiary' },
  { key: 'earned', icon: ShieldCheck, tint: 'text-secondary' },
];

/**
 * Runs `load` now and every `ms` while the tab is visible. A hidden tab stops the interval;
 * coming back refreshes once and restarts it. Returns the cleanup.
 */
function pollWhileVisible(load: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  const stop = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  const onVisibility = () => {
    stop();
    if (document.hidden) return;
    load();
    timer = setInterval(load, ms);
  };
  load();
  if (!document.hidden) timer = setInterval(load, ms);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    stop();
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

/**
 * `compact` (the app shell off its home route, #474): below `sm` the tiles and the
 * zero-state card give way to one inline row of the three numbers, so the stats fit beside
 * the handle. From `sm` up nothing changes. One component either way, so one set of polls.
 */
export function StatStrip({ address, compact = false }: { address: string; compact?: boolean }) {
  const t = useTranslations();
  const format = useFormat();
  const [scores, setScores] = useState<{ social: number; earned: number } | null>(null);
  const [people, setPeople] = useState<PeopleCounts | null>(null);

  useEffect(() => {
    let alive = true;
    setScores(null);
    const load = () => {
      getScores(address)
        .then((s) => {
          if (alive) setScores(s);
        })
        .catch(() => {
          if (alive) setScores({ social: 0, earned: 0 });
        });
    };
    const stopPolling = pollWhileVisible(load, REFRESH_MS);
    return () => {
      alive = false;
      stopPolling();
    };
  }, [address]);

  useEffect(() => {
    let alive = true;
    setPeople(null);
    const load = () => {
      getPeopleCounts(address)
        .then((p) => {
          if (alive) setPeople(p);
        })
        .catch(() => {
          if (alive) setPeople({ vouchedBy: 0, backed: 0 });
        });
    };
    const stopPolling = pollWhileVisible(load, PEOPLE_REFRESH_MS);
    return () => {
      alive = false;
      stopPolling();
    };
  }, [address]);

  const busy = scores === null || people === null;
  const value = (k: Tile['key']) =>
    k === 'vouchedBy'
      ? (people?.vouchedBy ?? 0)
      : k === 'social'
        ? (scores?.social ?? 0)
        : (scores?.earned ?? 0);
  const hasAnySignal =
    (people?.vouchedBy ?? 0) > 0 ||
    (people?.backed ?? 0) > 0 ||
    (scores?.social ?? 0) > 0 ||
    (scores?.earned ?? 0) > 0;

  return (
    <>
      {compact && (
        <dl className="flex items-center gap-3 sm:hidden" data-testid="stat-strip-compact">
          {TILES.map((tile) => {
            const Icon = tile.icon;
            return (
              <div key={tile.key}>
                <dt className="sr-only">{t(`statStrip.${tile.key}.label`)}</dt>
                <dd className="flex items-center gap-1 font-display text-sm font-semibold tabular-nums">
                  <Icon className={cn('size-3.5', tile.tint)} aria-hidden />
                  {busy ? (
                    <span className="inline-block h-4 w-5 animate-pulse rounded bg-muted/40" />
                  ) : (
                    format.number(value(tile.key))
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
      <div className={cn('space-y-3', compact && 'hidden sm:block')}>
        <div className="grid grid-cols-3 gap-3">
          {busy
            ? TILES.map((tile) => {
                const Icon = tile.icon;
                return (
                  <div key={tile.key} className="glass rounded-2xl p-4">
                    <div className="mb-2 flex items-center gap-2">
                      <Icon className={cn('size-4', tile.tint)} />
                      <span className="text-xs font-medium text-muted-foreground">{t(`statStrip.${tile.key}.label`)}</span>
                    </div>
                    <div className="h-9 w-16 animate-pulse rounded bg-muted/40" />
                    <div className="mt-2 h-2 w-20 animate-pulse rounded bg-muted/30" />
                  </div>
                );
              })
            : TILES.map((tile) => {
                const Icon = tile.icon;
                return (
                  <div key={tile.key} className="glass rounded-2xl p-4">
                    <div className="mb-2 flex items-center gap-2">
                      <Icon className={cn('size-4', tile.tint)} />
                      <span className="text-xs font-medium text-muted-foreground">{t(`statStrip.${tile.key}.label`)}</span>
                    </div>
                    <div className="font-display text-3xl font-semibold tabular-nums">
                      {format.number(value(tile.key))}
                    </div>
                    <p className="mt-1 hidden text-2xs text-muted-foreground sm:block">{t(`statStrip.${tile.key}.hint`)}</p>
                  </div>
                );
              })}
        </div>

        {!busy && !hasAnySignal && (
          <div className="glass rounded-2xl border border-dashed border-primary/30 p-4">
            <div className="flex items-start gap-3">
              <StateArt kind="empty-leaderboard" size={96} className="shrink-0" />
              <div>
                <p className="font-display text-lg text-foreground">{t('statStrip.empty.title')}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t('statStrip.empty.body')}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
