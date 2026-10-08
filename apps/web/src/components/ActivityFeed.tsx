import React, { useEffect, useRef, useState } from 'react';
import { shortAddr } from '@alvinmunk/shared';
import { fetchActivity, type FeedItem } from '@/lib/feed';
import { reverseHandles, useAvatars } from '@/lib/registry';
import type { AvatarConfig } from '@/lib/avatar';
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
  const [avatars, setAvatars] = useState<Record<string, AvatarConfig | undefined>>({});
  const pendingHandles = useRef<Set<string>>(new Set());
  const pendingAvatars = useRef<Set<string>>(new Set());
  const itemKey = items ? items.map((i) => `${i.from}:${i.to}`).join(',') : '';

  useEffect(() => {
    fetchActivity(10)
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  useEffect(() => {
    if (!items) return;
    const missing = [...new Set(items.flatMap((i) => [i.from, i.to]))].filter(
      (a) => !(a in handles) && !pendingHandles.current.has(a),
    );
    if (missing.length === 0) return;
    for (const a of missing) pendingHandles.current.add(a);
    let alive = true;
    reverseHandles(missing).then((map) => alive && setHandles((h) => ({ ...h, ...map })));
    return () => {
      alive = false;
    };
  }, [itemKey]);

  useEffect(() => {
    if (!items) return;
    const missing = [...new Set(items.flatMap((i) => [i.from, i.to]))].filter(
      (a) => !(a in avatars) && !pendingAvatars.current.has(a),
    );
    if (missing.length === 0) return;
    for (const a of missing) pendingAvatars.current.add(a);
    let alive = true;
    (useAvatars ? useAvatars(missing) : Promise.resolve({})).then((map) => alive && setAvatars((a) => ({ ...a, ...map })));
    return () => {
      alive = false;
    };
  }, [itemKey]);

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
              <Avatar address={it.from} avatar={avatars[it.from]} size={22} ring={false} />
              <span className="truncate text-foreground">{name(it.from)}</span>
              {it.kind === 'tip' ? (
                <>
                  <span className="shrink-0 text-muted-foreground">{t('activityFeed.tipped')}</span>
                  <Avatar address={it.to} avatar={avatars[it.to]} size={22} ring={false} />
                  <span className="truncate text-foreground">{name(it.to)}</span>
                  <span className="shrink-0 text-foreground">
                    {it.amount != null ? `${stroopsToUsdc(it.amount)} USDC` : ''}
                  </span>
                </>
              ) : (
                <>
                  <span className="shrink-0 text-muted-foreground">{t('activityFeed.vouched')}</span>
                  <Avatar address={it.to} avatar={avatars[it.to]} size={22} ring={false} />
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
