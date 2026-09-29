'use client';

import { useEffect, useState } from 'react';
import { Bell, Coins, Flame, Star, Target } from 'lucide-react';
import { shortAddr } from '@alvinmunk/shared';
import { useWallet } from '@/components/wallet/wallet-provider';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocale, useTranslations, type TFn } from '@/lib/i18n';
import { loadInbox, markInboxRead, type InboxItem, type InboxKind } from '@/lib/inbox';
import { reverseHandles } from '@/lib/registry';
import { stroopsToUsdc } from '@/lib/rewards';
import { timeAgo } from '@/lib/constellation';
import { usePoll } from '@/lib/use-poll';
import { cn } from '@/lib/utils';

/** How often an open inbox picks up new items. */
const POLL_MS = 30_000;

const ICONS: Record<InboxKind, typeof Star> = { claim: Star, tip: Coins, quest: Target, streak: Flame };

function itemText(t: TFn, item: InboxItem, handles: Record<string, string | null>): string {
  const who = item.peer ? (handles[item.peer] ? `@${handles[item.peer]}` : shortAddr(item.peer)) : '';
  switch (item.kind) {
    case 'claim':
      return t('inbox.item.claim', { who });
    case 'tip':
      return t('inbox.item.tip', { who, amount: stroopsToUsdc(BigInt(item.amount ?? '0')) });
    case 'quest':
      return t('inbox.item.quest', { id: String(item.questId ?? '') });
    case 'streak':
      return t('inbox.item.streak', { weeks: String(item.weeks ?? '') });
  }
}

/**
 * The wallet's inbox (#279): claims of its half-cards, tips it received, quest awards and
 * streaks, newest first (lib/inbox). Opening it marks everything read — which clears the
 * dot on the Inbox tab — while this visit still highlights what was new.
 */
export default function InboxPage() {
  const t = useTranslations();
  const { locale } = useLocale();
  const { profile } = useWallet();
  const me = profile?.address;
  const [items, setItems] = useState<InboxItem[] | null>(null);
  // What was unread when this visit saw it: it stays highlighted after being marked read.
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [handles, setHandles] = useState<Record<string, string | null>>({});

  usePoll(
    async (signal) => {
      if (!me) return;
      const inbox = await loadInbox(me);
      if (signal.aborted) return;
      setItems(inbox.items);
      if (inbox.unread.size > 0) {
        setFresh((prev) => new Set([...prev, ...inbox.unread]));
        markInboxRead(me, [...inbox.unread]);
      }
    },
    POLL_MS,
    me,
  );

  // @handles for the people in the list, one batched read for the ones not looked up yet.
  const peers = [...new Set((items ?? []).map((i) => i.peer).filter((p): p is string => !!p))];
  const missing = peers.filter((p) => !(p in handles)).sort().join(',');
  useEffect(() => {
    if (!missing) return;
    let alive = true;
    reverseHandles(missing.split(','))
      .then((map) => alive && setHandles((h) => ({ ...h, ...map })))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [missing]);

  if (!profile) return null;

  return (
    <div className="grid gap-6">
      <header>
        <h1 className="font-display text-2xl font-semibold">{t('inbox.title')}</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground text-balance">{t('inbox.subtitle')}</p>
      </header>

      {items === null ? (
        <div className="grid gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border/60 py-16 text-center">
          <Bell className="size-10 text-muted-foreground/40" />
          <div>
            <p className="font-medium">{t('inbox.empty.title')}</p>
            <p className="mt-1 max-w-xs text-sm text-muted-foreground text-balance">{t('inbox.empty.body')}</p>
          </div>
        </div>
      ) : (
        <ul className="grid gap-2">
          {items.map((item) => {
            const Icon = ICONS[item.kind];
            const isNew = fresh.has(item.id);
            return (
              <li
                key={item.id}
                data-kind={item.kind}
                className={cn(
                  'flex items-start gap-3 rounded-xl p-4',
                  isNew ? 'bg-primary/5 ring-1 ring-inset ring-primary/15' : 'bg-muted/40',
                )}
              >
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-background ring-1 ring-border">
                  <Icon className="size-4 text-primary" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{itemText(t, item, handles)}</p>
                  {item.at ? <p className="mt-0.5 text-xs text-muted-foreground">{timeAgo(item.at, locale)}</p> : null}
                </div>
                {isNew && (
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary">
                    <span className="sr-only">{t('inbox.new')}</span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
