'use client';

import { useEffect, useState } from 'react';
import { Flame } from 'lucide-react';
import { getWallet } from '@/lib/wallet';
import { completeQuest, getStreak } from '@/lib/quests';
import { getEarnedScore } from '@/lib/reputation';
import { txExplorerUrl } from '@/lib/stellar';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

/**
 * Verified quests (Earned XP — the cashable track). The wallet owner proves ownership,
 * the attester verifies proof + on-chain activity, then grants Earned XP. Earned ≠ Social.
 */
export function Quests({ address }: { address: string }) {
  const [earned, setEarned] = useState<number | null>(null);
  const [streak, setStreak] = useState<{ weeks: number; best: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [hash, setHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getEarnedScore(address, address).then(setEarned).catch(() => setEarned(0));
    getStreak(address, address)
      .then((s) => setStreak({ weeks: s.weeks, best: s.best }))
      .catch(() => setStreak({ weeks: 0, best: 0 }));
  }, [address]);

  async function onComplete() {
    setBusy(true);
    setError(null);
    setHash(null);
    try {
      const wallet = await getWallet();
      const r = await completeQuest(wallet, 2, { type: 'referral_tx', ref: wallet.address });
      if (!r.ok) throw new Error(r.error);
      setHash(r.hash ?? null);
      setEarned(await getEarnedScore(address, address));
      const s = await getStreak(address, address);
      setStreak({ weeks: s.weeks, best: s.best });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'quest failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-base font-semibold">Earn it</h2>
          <Badge variant="onchain">Earned XP: {earned ?? '…'}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Verified actions earn Earned XP — the only kind that unlocks USDC. Vouches don&apos;t.
        </p>
        {streak && (
          <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
            <Flame className="size-4 text-primary" />
            <span className="font-medium text-foreground">{streak.weeks}</span>-week streak
            {streak.best > streak.weeks && <span className="text-muted-foreground/60">· best {streak.best}</span>}
          </p>
        )}
        <Button variant="onchain" onClick={onComplete} disabled={busy} className="mt-4 w-full">
          {busy ? 'Verifying…' : 'Verify a quest'}
        </Button>

        {hash && (
          <a
            href={txExplorerUrl(hash)}
            target="_blank"
            rel="noreferrer"
            className="mt-2 block text-center text-xs text-secondary underline"
          >
            verified on-chain → +30 Earned XP
          </a>
        )}
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
