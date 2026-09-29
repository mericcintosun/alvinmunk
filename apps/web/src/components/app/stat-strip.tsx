'use client';

import React, { useEffect, useState } from 'react';
import { Sparkles, Users, ShieldCheck } from 'lucide-react';
import { getScores, type PeopleCounts } from '@/lib/reputation';
import { getPeopleCounts } from '@/lib/constellation';
import { StateArt } from '@/components/ui/state-art';
import { cn } from '@/lib/utils';
import { useLocale, useTranslations } from '@/lib/i18n';

/**
 * Dashboard stat strip — the at-a-glance reputation summary that anchors the app shell.
 * Reads both XP tracks for the signed-in address plus how many people vouched for it —
 * the durable on-chain count (see getPeopleCounts), not a Social XP roll-up and not just
 * the recent event window. Refreshes on mount and on a slow interval so the numbers
 * catch up after a vouch / claim / quest without a full reload.
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

export function StatStrip({ address }: { address: string }) {
  const t = useTranslations();
  const { locale } = useLocale();
  const numberFormat = new Intl.NumberFormat(locale === 'tr' ? 'tr-TR' : 'en-US');
  const [scores, setScores] = useState<{ social: number; earned: number } | null>(null);
  const [people, setPeople] = useState<PeopleCounts | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = () => {
      setLoading(true);
      getScores(address)
        .then((s) => {
          if (alive) {
            setScores(s);
            setLoading(false);
          }
        })
        .catch(() => {
          if (alive) {
            setScores({ social: 0, earned: 0 });
            setLoading(false);
          }
        });
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
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
    load();
    const t = setInterval(load, PEOPLE_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [address]);

  const busy = loading || people === null;
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
    <div className="space-y-3">
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
                    {numberFormat.format(value(tile.key))}
                  </div>
                  <p className="mt-1 hidden text-[11px] text-muted-foreground/70 sm:block">{t(`statStrip.${tile.key}.hint`)}</p>
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
  );
}
