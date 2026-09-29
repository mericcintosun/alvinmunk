'use client';

import React, { useEffect, useState } from 'react';
import { shortAddr } from '@alvinmunk/shared';
import { Sparkles } from 'lucide-react';
import { fetchActivity, type FeedItem } from '@/lib/feed';
import { reverseHandles } from '@/lib/registry';
import { Frame } from '@/components/fx/frame';
import { Avatar } from '@/components/Avatar';
import { StateArt } from '@/components/ui/state-art';

/**
 * Activity feed — "the sky is moving". Recent vouch claims from chain, labelled with
 * @handles where claimed. Social proof of life on the dashboard.
 */
export function ActivityFeed() {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [handles, setHandles] = useState<Record<string, string | null>>({});

  useEffect(() => {
    fetchActivity(10)
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  useEffect(() => {
    if (!items) return;
    const addrs = [...new Set(items.flatMap((i) => [i.from, i.to]))].filter((a) => !(a in handles));
    if (addrs.length === 0) return;
    let alive = true;
    reverseHandles(addrs).then((map) => alive && setHandles((h) => ({ ...h, ...map })));
    return () => {
      alive = false;
    };
  }, [items, handles]);

  const name = (a: string) => (handles[a] ? `@${handles[a]}` : shortAddr(a));

  return (
    <Frame label="log // recent_activity" index="LIVE">
      {items === null ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2 rounded-xl border border-border/60 bg-background/40 px-3 py-2.5">
              <div className="size-8 animate-pulse rounded-full bg-muted/50" />
              <div className="h-2 flex-1 animate-pulse rounded bg-muted/40" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
          <StateArt kind="vouch-sent" size={140} />
          <div>
            <p className="font-display text-lg text-foreground">No activity yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              The first vouch turns this feed into a living trail of human proof.
            </p>
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-border/50 font-mono text-xs">
          {items.map((it, i) => (
            <li key={i} className="flex items-center gap-2 px-4 py-2.5">
              <Avatar address={it.from} size={22} ring={false} />
              <span className="truncate text-foreground">{name(it.from)}</span>
              <span className="shrink-0 text-muted-foreground">→ vouched →</span>
              <Avatar address={it.to} size={22} ring={false} />
              <span className="truncate text-foreground">{name(it.to)}</span>
            </li>
          ))}
        </ul>
      )}
    </Frame>
  );
}
