'use client';

import { useEffect, useState } from 'react';
import { Sparkles, Users, ShieldCheck } from 'lucide-react';
import { getScores } from '@/lib/reputation';
import { cn } from '@/lib/utils';

/**
 * Dashboard stat strip — the at-a-glance reputation summary that anchors the app shell.
 * Reads both XP tracks for the signed-in address; Stars is the human-facing roll-up of
 * Social XP (one star per ~10). Refreshes on mount and on a slow interval so the numbers
 * catch up after a vouch / claim / quest without a full reload.
 */
const REFRESH_MS = 15_000;

type Tile = {
  key: 'stars' | 'social' | 'earned';
  label: string;
  hint: string;
  icon: typeof Sparkles;
  tint: string;
};

const TILES: Tile[] = [
  { key: 'stars', label: 'Stars', hint: 'People in your sky', icon: Sparkles, tint: 'text-accent' },
  { key: 'social', label: 'Social XP', hint: 'Clout · not cashable', icon: Users, tint: 'text-tertiary' },
  { key: 'earned', label: 'Earned XP', hint: 'Verified · unlocks USDC', icon: ShieldCheck, tint: 'text-secondary' },
];

export function StatStrip({ address }: { address: string }) {
  const [scores, setScores] = useState<{ social: number; earned: number } | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      getScores(address)
        .then((s) => alive && setScores(s))
        .catch(() => {});
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [address]);

  const stars = scores ? Math.max(0, Math.round(scores.social / 10)) : 0;
  const value = (k: Tile['key']) =>
    k === 'stars' ? stars : k === 'social' ? scores?.social ?? 0 : scores?.earned ?? 0;

  return (
    <div className="grid grid-cols-3 gap-3">
      {TILES.map((t) => {
        const Icon = t.icon;
        return (
          <div key={t.key} className="glass rounded-2xl p-4">
            <div className="mb-2 flex items-center gap-2">
              <Icon className={cn('size-4', t.tint)} />
              <span className="text-xs font-medium text-muted-foreground">{t.label}</span>
            </div>
            <div className="font-display text-3xl font-semibold tabular-nums">
              {scores ? value(t.key).toLocaleString('en-US') : <span className="text-muted-foreground/40">—</span>}
            </div>
            <p className="mt-1 hidden text-[11px] text-muted-foreground/70 sm:block">{t.hint}</p>
          </div>
        );
      })}
    </div>
  );
}
