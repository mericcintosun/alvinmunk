'use client';

import { useCallback, useEffect, useState } from 'react';
import { Lock, Check } from 'lucide-react';
import { getWallet } from '@/lib/wallet';
import { getGates, isUnlocked, unlockGate, TRACK, type Gate } from '@/lib/gate';
import { getScores } from '@/lib/reputation';
import { Frame } from '@/components/fx/frame';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Row = Gate & { unlocked: boolean };

/**
 * Unlockables — reputation as a CAPABILITY. Each gate is a perk that your Social/Earned
 * XP opens (read on-chain). Shows locked / unlockable / unlocked; the gate is composable
 * (any app can `check` it). Hides itself when no gates are configured.
 */
export function Unlockables({ address }: { address: string }) {
  const [scores, setScores] = useState<{ social: number; earned: number } | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [s, gates] = await Promise.all([
      getScores(address).catch(() => ({ social: 0, earned: 0 })),
      getGates().catch(() => [] as Gate[]),
    ]);
    setScores(s);
    const withU = await Promise.all(
      gates
        .filter((g) => g.active)
        .map(async (g) => ({ ...g, unlocked: await isUnlocked(address, g.id).catch(() => false) })),
    );
    setRows(withU);
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
      setError(e instanceof Error ? e.message : 'unlock failed');
    } finally {
      setBusy(null);
    }
  }

  if (rows !== null && rows.length === 0) return null;

  const have = (track: number) => (track === TRACK.EARNED ? scores?.earned ?? 0 : scores?.social ?? 0);
  const trackLabel = (t: number) => (t === TRACK.EARNED ? 'Earned XP' : 'Social XP');

  return (
    <Frame label="perks // reputation_gated" index="ACCESS" accent="tertiary">
      <div className="border-b border-border/60 px-4 py-2.5">
        <p className="text-xs text-muted-foreground">
          Reputation unlocks access — every gate is readable on-chain by any app.
        </p>
      </div>
      <ul className="divide-y divide-border/50">
        {(rows ?? []).map((g) => {
          const cur = have(g.track);
          const pass = cur >= g.min;
          return (
            <li key={g.id} className="flex items-center gap-3 p-4">
              <div
                className={cn(
                  'grid size-9 shrink-0 place-items-center border',
                  g.unlocked
                    ? 'border-secondary text-secondary'
                    : pass
                      ? 'border-tertiary text-tertiary'
                      : 'border-border text-muted-foreground',
                )}
              >
                {g.unlocked ? <Check className="size-4" /> : <Lock className="size-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{g.label}</p>
                <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  needs {g.min} {trackLabel(g.track)} · you {cur}
                </p>
              </div>
              {g.unlocked ? (
                <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-secondary">
                  ✦ unlocked
                </span>
              ) : (
                <Button
                  size="sm"
                  variant={pass ? 'flow' : 'secondary'}
                  disabled={!pass || busy !== null}
                  onClick={() => onUnlock(g.id)}
                >
                  {busy === g.id ? 'unlocking…' : pass ? 'unlock' : 'locked'}
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
