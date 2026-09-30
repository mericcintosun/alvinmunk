'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { fetchLeaderboard } from '@/lib/leaderboard';
import { usePoll } from '@/lib/use-poll';
import { type LeaderboardEntry } from '@alvinmunk/shared';
import { loadProfile } from '@/lib/profile';
import { reverseHandles } from '@/lib/registry';
import { Crest } from '@/components/brand/crest';
import { Avatar } from '@/components/Avatar';
import { Frame } from '@/components/fx/frame';
import { ShareRow } from '@/components/fx/share-row';
import { Skeleton } from '@/components/ui/skeleton';
import { StateArt } from '@/components/ui/state-art';
import { Sticker } from '@/components/ui/sticker';
import { useTranslations } from '@/lib/i18n';
import { shortAddr } from '@alvinmunk/shared';
import { cn } from '@/lib/utils';
import { readNetworkFor, withReadNetwork, type ReadNetwork } from '@/lib/read-network';
import { ReadOnlyBanner } from '@/components/read-only-banner';

export default function LeaderboardPage({
  searchParams,
}: {
  searchParams?: { network?: string | string[] };
}) {
  // `?network=testnet` ranks the testnet deployment, read-only (lib/read-network). Keyed so
  // switching networks starts over instead of mixing the two networks' rows and handles.
  const net = readNetworkFor(searchParams?.network);
  return <Leaderboard key={net?.network ?? 'deployment'} net={net} />;
}

function Leaderboard({ net }: { net: ReadNetwork | null }) {
  const t = useTranslations();
  const [rows, setRows] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [handles, setHandles] = useState<Record<string, string | null>>({});
  const [stale, setStale] = useState(false);
  // The signed-in profile lives on the deployment's network, never the override's.
  const me = net ? undefined : loadProfile()?.address;

  /**
   * Track addresses whose lookup is already in-flight (or done) so we never
   * start the same lookup twice, even if the poll fires a new `rows` array
   * while a batch is still running.
   */
  const pendingHandles = useRef<Set<string>>(new Set());

  // Depend on a stable string key (sorted addresses) rather than the array
  // reference so a poll that returns identical data doesn't restart lookups.
  const addressKey = rows.map((r) => r.address).sort().join('\n');

  useEffect(() => {
    // Only enqueue addresses we haven't started looking up yet.
    const missing = rows
      .map((r) => r.address)
      .filter((a) => !(a in handles) && !pendingHandles.current.has(a));

    if (missing.length === 0) return;

    // Mark them all as in-flight immediately so a re-run of this effect (or the next
    // poll tick, once addressKey settles) never starts the same lookup twice.
    for (const a of missing) pendingHandles.current.add(a);

    let alive = true;
    // One batched reverse_many read (lib/registry.ts) instead of N single-address
    // calls — this is what #319 already gives us for free.
    reverseHandles(missing, net).then((map) => alive && setHandles((h) => ({ ...h, ...map })));

    // We do NOT remove addresses from pendingHandles on cleanup — if the component
    // unmounts the lookup is abandoned, but a fresh mount gets a fresh ref and starts
    // over, which is correct. What must never happen is a batch still in flight being
    // silently discarded by the *next poll tick* re-running this effect — that's the
    // #208 bug, and addressKey (below) is what stops that.
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressKey]); // stable key: only re-runs when the actual set of addresses changes

  // Every 5s while the tab is visible, never overlapping, backing off on failures (lib/use-poll.ts).
  // `net` is fixed for this instance: the page remounts it (keyed) when the network changes.
  usePoll(async (signal) => {
    try {
      // A new `rows` array reference on every tick is fine now — the handle-lookup
      // effect above depends on `addressKey` (the stable, sorted set of addresses),
      // not on `rows` itself, so a quiet poll no longer re-triggers or cancels it.
      const r = await fetchLeaderboard({ throwOnError: true, net });
      if (signal.aborted) return;
      setRows(r);
      setStale(false);
    } catch (err) {
      if (signal.aborted) return;
      setStale(true);
      throw err; // so the poll backs off
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, 5000);

  return (
    <div className="container max-w-2xl py-14">
      {net && <ReadOnlyBanner network={net.network} />}
      <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-primary/80">{t('leaderboard.eyebrow')}</p>
      <div className="mt-4 flex items-end justify-between border-b border-border/60 pb-3">
        <h1 className="font-display text-4xl font-semibold tracking-tight">{t('leaderboard.title')}</h1>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.15em]',
            stale && rows.length > 0 ? 'text-warning' : stale ? 'text-destructive' : 'text-secondary',
          )}
          title={stale ? t('leaderboard.syncTitle.stale') : t('leaderboard.syncTitle.live')}
        >
          {stale && rows.length === 0 ? null : (
            <span
              className={cn(
                'size-1.5 rounded-full',
                stale ? 'bg-warning' : 'bg-secondary motion-safe:animate-glow-pulse',
              )}
            />
          )}
          {stale && rows.length === 0 ? t('leaderboard.syncFailed') : (stale ? t('leaderboard.syncDelayed') : t('leaderboard.live'))}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-xs text-muted-foreground">
          {t('leaderboard.meta')}
        </p>
        <ShareRow path={withReadNetwork('/leaderboard', net)} text={t('leaderboard.share')} />
      </div>

      <Frame label={t('leaderboard.frame')} index={`${rows.length || '—'} entries`} className="mt-6">
        {loading ? (
          <div className="flex flex-col gap-px">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-[60px] w-full rounded-none" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          stale ? (
            <div className="flex flex-col items-center gap-4 p-10 text-center">
              <div className="space-y-1">
                <p className="font-mono text-sm text-foreground">{t('leaderboard.syncFailed')}</p>
                <p className="font-mono text-xs text-muted-foreground">{t('leaderboard.syncFailedBody')}</p>
              </div>
              <button
                onClick={() => {
                  setLoading(true);
                  setStale(false);
                  fetchLeaderboard({ throwOnError: true, net })
                    .then(r => { setRows(r); setStale(false); })
                    .catch(() => setStale(true))
                    .finally(() => setLoading(false));
                }}
                className="mt-2 rounded bg-primary/10 px-4 py-2 font-mono text-xs text-primary hover:bg-primary/20"
              >
                {t('leaderboard.retry')}
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 p-10 text-center">
              <StateArt kind="empty-leaderboard" size={300} className="motion-safe:animate-float" />
              <p className="font-mono text-sm text-muted-foreground">
                {t('leaderboard.empty')}
              </p>
            </div>
          )
        ) : (
          <ol className="divide-y divide-border/50">
            {rows.map((e) => {
              const isMe = e.address === me;
              const handle = handles[e.address];
              // Every row opens someone: their profile once a handle resolves, else their score.
              // A row on the override opens that network's profile too.
              const href = withReadNetwork(handle ? `/u/${handle}` : `/score/${e.address}`, net);
              // The link's accessible name, e.g. "@alice, rank 3, 42 Social XP" — it replaces
              // the row's text for a screen reader, so it carries the "you" / flagged marks too.
              const label = [
                t('leaderboard.rowLabel', {
                  name: handle ? `@${handle}` : shortAddr(e.address),
                  rank: String(e.rank),
                  score: String(e.score),
                }),
                isMe && t('leaderboard.you'),
                e.flagged && t('leaderboard.flaggedTitle'),
              ]
                .filter(Boolean)
                .join(', ');
              return (
                <li key={e.address}>
                  <Link
                    href={href}
                    aria-label={label}
                    className={cn(
                      'flex items-center gap-4 px-4 py-3 transition-colors hover:bg-surface/40',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset',
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
                    <Avatar address={e.address} size={32} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-sm">
                        {handle ? (
                          <span className="text-foreground">@{handle}</span>
                        ) : (
                          shortAddr(e.address)
                        )}
                      </p>
                      <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider">
                        {isMe && <span className="text-primary">{t('leaderboard.you')}</span>}
                        {e.flagged && (
                          <span title={t('leaderboard.flaggedTitle')} className="text-warning">
                            {t('leaderboard.flagged')}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="font-display text-lg font-semibold text-primary">★ {e.score}</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </Frame>
    </div>
  );
}
