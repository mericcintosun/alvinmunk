'use client';

import React, { useEffect, useState } from 'react';
import { Copy, Check, Sparkles } from 'lucide-react';
import { getOwedBonuses, type OwedBonus } from '@/lib/myvouches';
import { useWallet } from '@/components/wallet/wallet-provider';
import { Frame } from '@/components/fx/frame';
import { Sticker } from '@/components/ui/sticker';
import { buttonVariants } from '@/components/ui/button';
import { useTranslations } from '@/lib/i18n';
import { FOCUS_MODE } from '@/lib/focus';
import { cn } from '@/lib/utils';
import { shortAddr } from '@alvinmunk/shared';

const QUESTS_PATH = '/app/quests';

/**
 * Owed bonuses — the voucher bonus you get once each person you vouched completes their
 * first verified quest (the asymmetric 2nd-order gate, belts/08 §1). Turns that hidden rule
 * into a cooperative nudge: the total on top, one row per person, and a one-tap share of
 * the quests link with them — they're the one who has to act. Under FOCUS_MODE (quests
 * hidden) the copy stays and the link goes. Renders nothing while loading or when nothing
 * is owed, and re-reads when the tab comes back into view (e.g. after nudging someone).
 */
export function OwedBonuses() {
  const { profile } = useWallet();
  const t = useTranslations();
  const address = profile?.address;
  const [items, setItems] = useState<OwedBonus[]>([]);
  const [copied, setCopied] = useState<string | null>(null); // claimer address

  useEffect(() => {
    if (!address) return;
    let alive = true;
    const load = () => {
      getOwedBonuses(address)
        .then((rows) => {
          if (alive) setItems(rows);
        })
        .catch(() => {
          /* keep the last list */
        });
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    setItems([]);
    load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [address]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  if (items.length === 0) return null;

  const total = items.reduce((sum, r) => sum + r.amount, 0);
  const nameOf = (row: OwedBonus) => (row.handle ? `@${row.handle}` : shortAddr(row.claimer));

  async function nudge(row: OwedBonus) {
    const url = `${window.location.origin}${QUESTS_PATH}`;
    const text = t('owedBonuses.shareText');
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ text, url });
      } else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        setCopied(row.claimer);
      }
    } catch {
      /* share dismissed / clipboard unavailable */
    }
  }

  return (
    <Frame
      label={t('owedBonuses.frameLabel')}
      index={String(items.length).padStart(2, '0')}
      accent="secondary"
      tape="tr"
    >
      <Sticker
        name="stamp-verified"
        size={56}
        rotate={6}
        className="absolute -bottom-2 right-3 z-10 opacity-80"
      />

      <div className="flex items-start gap-3 p-4 pb-2">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-secondary" />
        <div>
          <p className="font-display text-lg text-foreground">
            {t('owedBonuses.title', { total: String(total) })}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('owedBonuses.subtitle')}</p>
        </div>
      </div>

      <ul className="divide-y divide-border/50">
        {items.map((row) => {
          const name = nameOf(row);
          return (
            <li key={row.claimer} className="flex items-center gap-3 p-4">
              <div className="grid size-10 shrink-0 place-items-center border border-dashed border-secondary/50 text-secondary">
                <span className="font-mono text-2xs">+{row.amount}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground/90">{t('owedBonuses.row', { name })}</p>
                {row.note && (
                  <p className="truncate text-xs italic text-muted-foreground">
                    &ldquo;{row.note}&rdquo;
                  </p>
                )}
              </div>
              {!FOCUS_MODE && (
                <button
                  onClick={() => nudge(row)}
                  className={cn(
                    buttonVariants({ variant: 'outline', size: 'sm' }),
                    'glass shrink-0 font-mono',
                  )}
                  aria-label={t('owedBonuses.nudgeLabel', { name })}
                >
                  {copied === row.claimer ? (
                    <Check className="size-4" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                  {copied === row.claimer ? t('owedBonuses.copied') : t('owedBonuses.nudge')}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </Frame>
  );
}
