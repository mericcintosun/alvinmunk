'use client';

import { useEffect, useState } from 'react';
import { fetchLeaderboard } from '@/lib/leaderboard';
import { type LeaderboardEntry } from '@alvinmunk/shared';
import { loadProfile } from '@/lib/profile';
import { reverseHandle } from '@/lib/registry';
import { Crest } from '@/components/brand/crest';
import { Frame } from '@/components/fx/frame';
import { ShareRow } from '@/components/fx/share-row';
import { Skeleton } from '@/components/ui/skeleton';
import { StateArt } from '@/components/ui/state-art';
import { Sticker } from '@/components/ui/sticker';
import { cn, shortAddress } from '@/lib/utils';

/**
 * Leaderboard — the night sky of the most-connected (faces over numbers), folded from
 * on-chain `social` events via RPC, polled every 5s. Technical-profile skin.
 */
export default function LeaderboardPage() {
  const [rows, setRows] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [handles, setHandles] = useState<Record<string, string | null>>({});
  // The leaderboard is the only piece that depends on the off-chain event read — the core
  // loop (vouch/claim/ignite) is tx-driven and never touches it. Surface read freshness so a
  // silent RPC/indexer failure is VISIBLE here instead of quietly showing stale scores.
  const [stale, setStale] = useState(false);
  const me = loadProfile()?.address;

  // Reverse-lookup @handles for any new addresses (incremental — never re-fetch known).
  useEffect(() => {
    const missing = rows.map((r) => r.address).filter((a) => !(a in handles));
    if (missing.length === 0) return;
    let alive = true;
    Promise.all(missing.map(async (a) => [a, await reverseHandle(a).catch(() => null)] as const)).then(
      (pairs) => alive && setHandles((h) => ({ ...h, ...Object.fromEntries(pairs) })),
    );
    return () => {
      alive = false;
    };
  }, [rows, handles]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetchLeaderboard();
        if (alive) {
          setRows(r);
          setStale(false);
        }
      } catch {
        if (alive) setStale(true); // read failed — mark stale so it's not silently wrong
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
    <div className="container max-w-2xl py-14">
      <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-primary/80">{'// the_night_sky'}</p>
      <div className="mt-4 flex items-end justify-between border-b border-border/60 pb-3">
        <h1 className="font-display text-4xl font-semibold tracking-tight">The most-connected</h1>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.15em]',
            stale ? 'text-amber-400/90' : 'text-secondary/80',
          )}
          title={stale ? 'Couldn’t refresh from the chain — scores may be behind.' : 'Live from the chain.'}
        >
          <span
            className={cn(
              'size-1.5 rounded-full',
              stale ? 'bg-amber-400' : 'bg-secondary motion-safe:animate-glow-pulse',
            )}
          />
          {stale ? 'sync delayed' : 'live'}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-xs text-muted-foreground">
          social_score · clout_not_cash · poll=5s
        </p>
        <ShareRow path="/leaderboard" text="The most-connected on alvinmunk 🌌 — collect people, not points." />
      </div>

      <Frame label="ranking // social_xp" index={`${rows.length || '—'} entries`} className="mt-6">
        {loading ? (
          <div className="flex flex-col gap-px">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-[60px] w-full rounded-none" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-4 p-10 text-center">
            <StateArt kind="empty-leaderboard" size={300} className="motion-safe:animate-float" />
            <p className="font-mono text-sm text-muted-foreground">
              no constellations yet — be the first to vouch ten people.
            </p>
          </div>
        ) : (
          <ol className="divide-y divide-border/50">
            {rows.map((e) => {
              const isMe = e.address === me;
              return (
                <li
                  key={e.address}
                  className={cn(
                    'flex items-center gap-4 px-4 py-3 transition-colors hover:bg-surface/40',
                    isMe && 'bg-primary/5',
                  )}
                >
                  <span className="relative w-8 shrink-0 font-mono text-sm text-muted-foreground">
                    #{String(e.rank).padStart(2, '0')}
                    {e.rank === 1 && (
                      <Sticker name="burst-hot" size={34} rotate={-12} className="absolute -left-1 -top-5 h-7 w-auto" />
                    )}
                  </span>
                  <Crest address={e.address} size={42} points={Math.min(9, 4 + (e.rank % 5))} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-sm">
                      {handles[e.address] ? (
                        <span className="text-foreground">@{handles[e.address]}</span>
                      ) : (
                        shortAddress(e.address)
                      )}
                    </p>
                    <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider">
                      {isMe && <span className="text-primary">you</span>}
                      {e.flagged && (
                        <span title="reciprocal vouch pair — possible ring" className="text-warning">
                          ⚠ flagged
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="font-display text-lg font-semibold text-primary">★ {e.score}</span>
                </li>
              );
            })}
          </ol>
        )}
      </Frame>
    </div>
  );
}
