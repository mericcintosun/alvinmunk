'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Lock, Check } from 'lucide-react';
import { getWallet } from '@/lib/wallet';
import { getGateStatus, unlockGate, TRACK, type GateStatus } from '@/lib/gate';
import { getScores } from '@/lib/reputation';
import { Frame } from '@/components/fx/frame';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useTranslations } from '@/lib/i18n';

/**
 * Unlockables — reputation as a CAPABILITY. Each gate is a perk that your Social/Earned
 * XP opens (read on-chain). Shows locked / unlockable / unlocked; the gate is composable
 * (any app can `check` it). Hides itself when no gates are configured.
 *
 * Pass / unlock state comes from ONE `get_status` read, so it matches what `unlock` will
 * enforce (composite rules and redefined gates included); the scores only fill in the
 * "you have" figure.
 */
export function Unlockables({ address }: { address: string }) {
  const t = useTranslations();
  const [scores, setScores] = useState<{ social: number; earned: number } | null>(null);
  const [rows, setRows] = useState<GateStatus[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [s, status] = await Promise.all([
      getScores(address).catch(() => ({ social: 0, earned: 0 })),
      getGateStatus(address),
    ]);
    setScores(s);
    setRows(status.filter((r) => r.gate.active));
  }, [address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onUnlock(id: number) {
    setBusy(id);
    setError(null);
    try {
      const w = await getWallet();
      await unlockGate(w, id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('unlockables.error'));
    } finally {
      setBusy(null);
    }
  }

  if (rows !== null && rows.length === 0) return null;

  const have = (track: number) => (track === TRACK.EARNED ? scores?.earned ?? 0 : scores?.social ?? 0);
  const trackLabel = (track: number) =>
    track === TRACK.EARNED ? t('unlockables.earnedXp') : t('unlockables.socialXp');

  return (
    <Frame label={t('unlockables.frame')} index="ACCESS" accent="tertiary">
      <div className="border-b border-border/60 px-4 py-2.5">
        <p className="text-xs text-muted-foreground">{t('unlockables.intro')}</p>
      </div>
      <ul className="divide-y divide-border/50">
        {(rows ?? []).map(({ gate: g, passes, unlocked }) => {
          const cur = have(g.track);
          return (
            <li key={g.id} className="flex items-center gap-3 p-4">
              <div
                className={cn(
                  'grid size-9 shrink-0 place-items-center border',
                  unlocked
                    ? 'border-secondary text-secondary'
                    : passes
                      ? 'border-tertiary text-tertiary'
                      : 'border-border text-muted-foreground',
                )}
              >
                {unlocked ? <Check className="size-4" /> : <Lock className="size-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{g.label}</p>
                <p className="font-mono text-2xs uppercase tracking-wider text-muted-foreground">
                  {t('unlockables.needs', { min: String(g.min), track: trackLabel(g.track), cur: String(cur) })}
                </p>
              </div>
              {unlocked ? (
                <span className="eyebrow-mono text-secondary">
                  {t('unlockables.unlocked')}
                </span>
              ) : (
                <Button
                  size="sm"
                  variant={passes ? 'flow' : 'secondary'}
                  disabled={!passes || busy !== null}
                  onClick={() => onUnlock(g.id)}
                >
                  {busy === g.id ? t('unlockables.unlocking') : passes ? t('unlockables.unlock') : t('unlockables.locked')}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="px-4 py-2 text-sm text-destructive">{error}</p>}
    </Frame>
  );
}
