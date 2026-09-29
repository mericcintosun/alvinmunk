'use client';

import React, { useEffect, useState } from 'react';
import { shortAddr } from '@alvinmunk/shared';
import { fetchActivity, type FeedItem } from '@/lib/feed';
import { reverseHandles } from '@/lib/registry';
import { stroopsToUsdc } from '@/lib/rewards';
import { FOCUS_MODE } from '@/lib/focus';
import { Frame } from '@/components/fx/frame';
import { Avatar } from '@/components/Avatar';
import { StateArt } from '@/components/ui/state-art';
import { useTranslations } from '@/lib/i18n';

/**
 * Activity feed — "the sky is moving". Recent vouch claims and tips from chain, labelled
 * with @handles where claimed. Social proof of life on the dashboard.
 */
export function ActivityFeed() {
  const t = useTranslations();
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
  const visible = items ? (FOCUS_MODE ? items.filter((i) => i.kind !== 'tip') : items) : null;

  return (
    <Frame label={t('activityFeed.frame')} index={t('activityFeed.live')}>
      {visible === null ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2 rounded-xl border border-border/60 bg-background/40 px-3 py-2.5">
              <div className="size-8 animate-pulse rounded-full bg-muted/50" />
              <div className="h-2 flex-1 animate-pulse rounded bg-muted/40" />
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
          <StateArt kind="vouch-sent" size={140} />
          <div>
            <p className="font-display text-lg text-foreground">{t('activityFeed.empty.title')}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('activityFeed.empty.body')}
            </p>
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-border/50 font-mono text-xs">
          {visible.map((it, i) => (
            <li key={i} className="flex items-center gap-2 px-4 py-2.5">
              <Avatar address={it.from} size={22} ring={false} />
              <span className="truncate text-foreground">{name(it.from)}</span>
              {it.kind === 'tip' ? (
                <>
                  <span className="shrink-0 text-muted-foreground">{t('activityFeed.tipped')}</span>
                  <Avatar address={it.to} size={22} ring={false} />
                  <span className="truncate text-foreground">{name(it.to)}</span>
                  <span className="shrink-0 text-foreground">
                    {it.amount != null ? `${stroopsToUsdc(it.amount)} USDC` : ''}
                  </span>
                </>
              ) : (
                <>
                  <span className="shrink-0 text-muted-foreground">{t('activityFeed.vouched')}</span>
                  <Avatar address={it.to} size={22} ring={false} />
                  <span className="truncate text-foreground">{name(it.to)}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Frame>
  );
}
