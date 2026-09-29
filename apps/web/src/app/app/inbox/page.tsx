'use client';

import { useEffect, useState, useCallback } from 'react';
import { Bell, Star, Coins, Target, Loader2, RefreshCw } from 'lucide-react';
import { useWallet } from '@/components/wallet/wallet-provider';
import { useTranslations } from '@/lib/i18n';
import { getInboxItems, markInboxRead, type InboxItem, type InboxKind } from '@/lib/inbox';

// ── Icon per inbox kind ──────────────────────────────────────────────────────

function KindIcon({ kind }: { kind: InboxKind }) {
  switch (kind) {
    case 'vouch-claimed':
      return <Star className="size-4 text-accent" />;
    case 'tip-received':
      return <Coins className="size-4 text-tertiary" />;
    case 'quest-awarded':
      return <Target className="size-4 text-secondary" />;
  }
}

// ── Relative time label ──────────────────────────────────────────────────────

function relativeTime(tsMs: number): string {
  const delta = Date.now() - tsMs;
  if (delta < 60_000) return 'just now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}

// ── Single inbox row ─────────────────────────────────────────────────────────

function InboxRow({ item, isUnread }: { item: InboxItem; isUnread: boolean }) {
  const peerName = item.peerHandle ? `@${item.peerHandle}` : item.peerAddress.slice(0, 8) + '…';

  return (
    <div
      className={`flex items-start gap-3 rounded-xl p-4 transition-colors ${
        isUnread ? 'bg-primary/5 ring-1 ring-inset ring-primary/15' : 'bg-muted/40'
      }`}
    >
      {/* Kind icon */}
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-background ring-1 ring-border">
        <KindIcon kind={item.kind} />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.message}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {item.kind !== 'vouch-claimed' && item.peerAddress !== '' && (
            <span className="font-medium text-foreground/70">{peerName} · </span>
          )}
          {relativeTime(item.ts)}
        </p>
      </div>

      {/* Unread dot */}
      {isUnread && (
        <div
          aria-label="unread"
          className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
        />
      )}
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────────────────────

function EmptyInbox() {
  const t = useTranslations();
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border/60 py-16 text-center">
      <Bell className="size-10 text-muted-foreground/40" />
      <div>
        <p className="font-medium">{t('inbox.empty.title')}</p>
        <p className="mt-1 max-w-xs text-sm text-muted-foreground text-balance">
          {t('inbox.empty.body')}
        </p>
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function InboxPage() {
  const t = useTranslations();
  const { profile } = useWallet();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastReadMs, setLastReadMs] = useState(0);
  const [error, setError] = useState(false);

  const loadItems = useCallback(
    async (markRead = false) => {
      if (!profile?.address) return;
      setLoading(true);
      setError(false);
      try {
        const loaded = await getInboxItems(profile.address, 0);
        setItems(loaded);
        if (markRead) {
          const ids = loaded.map((i) => i.id);
          markInboxRead(ids);
          setLastReadMs(Date.now());
        }
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    [profile?.address],
  );

  // On mount: fetch + mark read so the unread dot clears.
  useEffect(() => {
    void loadItems(true);
  }, [loadItems]);

  if (!profile) return null;

  const isUnread = (item: InboxItem) => item.ts > lastReadMs && lastReadMs === 0;

  return (
    <div className="grid gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold">{t('inbox.page.title')}</h1>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground text-balance">
            {t('inbox.page.subtitle')}
          </p>
        </div>
        <button
          aria-label={t('inbox.refresh')}
          onClick={() => loadItems(false)}
          disabled={loading}
          className="flex size-9 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40"
        >
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      {loading && items.length === 0 ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">
          {t('inbox.error')}
        </div>
      ) : items.length === 0 ? (
        <EmptyInbox />
      ) : (
        <div className="grid gap-2">
          {items.map((item) => (
            <InboxRow key={item.id} item={item} isUnread={isUnread(item)} />
          ))}
        </div>
      )}
    </div>
  );
}
