'use client';

import { useEffect, useState } from 'react';
import { shortAddr } from '@passport/shared';
import { fetchActivity, type FeedItem } from '@/lib/feed';
import { reverseHandle } from '@/lib/registry';
import { Frame } from '@/components/fx/frame';
import { Avatar } from '@/components/Avatar';

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
    Promise.all(addrs.map(async (a) => [a, await reverseHandle(a).catch(() => null)] as const)).then(
      (pairs) => alive && setHandles((h) => ({ ...h, ...Object.fromEntries(pairs) })),
    );
    return () => {
      alive = false;
    };
  }, [items, handles]);

  const name = (a: string) => (handles[a] ? `@${handles[a]}` : shortAddr(a));

  return (
    <Frame label="log // recent_activity" index="LIVE">
      {items === null ? (
        <p className="p-4 font-mono text-xs text-muted-foreground">reading the sky…</p>
      ) : items.length === 0 ? (
        <p className="p-4 font-mono text-xs text-muted-foreground">
          no recent activity — be the first to light a star.
        </p>
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
