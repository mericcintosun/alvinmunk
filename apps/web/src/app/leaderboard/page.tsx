'use client';

import { useEffect, useState } from 'react';
import { fetchLeaderboard } from '@/lib/leaderboard';
import { type LeaderboardEntry } from '@passport/shared';
import { loadProfile } from '@/lib/profile';
import { Crest } from '@/components/brand/crest';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, shortAddress } from '@/lib/utils';

/**
 * Leaderboard — the night sky of the most-connected (Kaan: faces over numbers). Folded
 * from on-chain `social` events via RPC, polled every 5s.
 */
export default function LeaderboardPage() {
  const [rows, setRows] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const me = loadProfile()?.address;

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetchLeaderboard();
        if (alive) setRows(r);
      } finally {
        if (alive) setLoading(false);
      }
    };
    void tick();
    const iv = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  return (
    <div className="container max-w-xl py-12">
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-3xl font-semibold">The most-connected</h1>
        <Badge variant="onchain">live</Badge>
      </div>
      <p className="mb-8 text-sm text-muted-foreground">Social score · clout, not cash · updates live.</p>

      {loading && (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-2xl" />
          ))}
        </div>
      )}

      {!loading && rows.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          No constellations yet. Be the first to vouch for ten people.
        </Card>
      )}

      <ol className="flex flex-col gap-2">
        {rows.map((e) => {
          const isMe = e.address === me;
          return (
            <li key={e.address}>
              <div
                className={cn(
                  'flex items-center gap-4 rounded-2xl border p-3 transition-colors',
                  isMe ? 'border-primary/40 bg-primary/5' : 'border-border bg-card',
                )}
              >
                <span className="w-6 text-center font-mono text-sm text-muted-foreground">{e.rank}</span>
                <Crest address={e.address} size={44} points={Math.min(9, 4 + (e.rank % 5))} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-sm">{shortAddress(e.address)}</p>
                  <div className="mt-0.5 flex items-center gap-2">
                    {isMe && <span className="text-[10px] font-medium text-primary">you</span>}
                    {e.flagged && (
                      <span
                        title="reciprocal vouch pair — possible ring"
                        className="text-[10px] text-warning"
                      >
                        ⚠ flagged
                      </span>
                    )}
                  </div>
                </div>
                <span className="font-display text-lg font-semibold text-primary">★ {e.score}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
