'use client';

import React, { useEffect, useState } from 'react';
import { Copy, Check, Sparkles } from 'lucide-react';
import { getPendingVouches, type PendingVouch } from '@/lib/myvouches';
import { Frame } from '@/components/fx/frame';
import { Sticker } from '@/components/ui/sticker';
import { StateArt } from '@/components/ui/state-art';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useLocale, useTranslations } from '@/lib/i18n';

/**
 * Pending half-cards — vouches you minted that NOBODY claimed yet. The re-engagement
 * hook (your staked Social XP gets slashed if the window closes): re-share the link.
 * Shows a friendly empty state when there's nothing pending; with `hideWhenEmpty` (the /app
 * home) it renders nothing while loading or when nothing is pending instead.
 */
export function PendingHalfCards({ hideWhenEmpty = false }: { hideWhenEmpty?: boolean }) {
  const t = useTranslations();
  const { locale } = useLocale();
  const numberFormat = new Intl.NumberFormat(locale === 'tr' ? 'tr-TR' : 'en-US');
  const [items, setItems] = useState<PendingVouch[] | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  useEffect(() => {
    getPendingVouches(window.location.origin)
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  async function copy(v: PendingVouch) {
    try {
      await navigator.clipboard.writeText(v.claimUrl);
      setCopied(v.id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  if (items === null) {
    if (hideWhenEmpty) return null;
    return (
      <Frame label={t('pendingHalfCards.frame')} index="00" accent="tertiary" tape="tr">
        <div className="space-y-2 p-4">
          <div className="h-3 w-24 animate-pulse rounded bg-muted/40" />
          <div className="h-10 animate-pulse rounded-xl bg-muted/30" />
        </div>
      </Frame>
    );
  }

  if (items.length === 0) {
    if (hideWhenEmpty) return null;
    return (
      <Frame label={t('pendingHalfCards.frame')} index="00" accent="tertiary" tape="tr">
        <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
          <StateArt kind="vouch-sent" size={140} />
          <div>
            <p className="font-display text-lg text-foreground">{t('pendingHalfCards.empty.title')}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('pendingHalfCards.empty.body')}
            </p>
          </div>
        </div>
      </Frame>
    );
  }

  return (
    <Frame label={t('pendingHalfCards.frame')} index={String(items.length).padStart(2, '0')} accent="tertiary" tape="tr">
      <Sticker name="stamp-ticket" size={60} rotate={-6} className="absolute -bottom-2 right-3 z-10 opacity-90" />
      <ul className="divide-y divide-border/50">
        {items.map((v) => (
          <li key={v.id} className="flex items-center gap-3 p-4">
            {/* Last-day urgency is signaled by color AND the "today" label — never color alone. */}
            <div
              className={cn(
                'grid size-10 shrink-0 place-items-center border border-dashed',
                v.daysLeft <= 1
                  ? 'border-destructive/60 text-destructive'
                  : 'border-tertiary/50 text-tertiary',
              )}
            >
              <span className="font-mono text-2xs">
                {v.daysLeft <= 0 ? t('pendingHalfCards.now') : t('pendingHalfCards.days', { count: numberFormat.format(v.daysLeft) })}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm italic text-foreground/85">&ldquo;{v.note}&rdquo;</p>
              <p
                className={cn(
                  'font-mono text-2xs uppercase tracking-wider',
                  v.daysLeft <= 1 ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                {v.daysLeft <= 1 ? t('pendingHalfCards.urgent') : t('pendingHalfCards.atRisk')}
              </p>
            </div>
            <button
              onClick={() => copy(v)}
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'glass shrink-0 font-mono')}
            >
              {copied === v.id ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied === v.id ? t('pendingHalfCards.copied') : t('pendingHalfCards.copyLink')}
            </button>
          </li>
        ))}
      </ul>
    </Frame>
  );
}
