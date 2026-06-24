'use client';

import { useEffect, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { getPendingVouches, type PendingVouch } from '@/lib/myvouches';
import { Frame } from '@/components/fx/frame';
import { Sticker } from '@/components/ui/sticker';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Pending half-cards — vouches you minted that NOBODY claimed yet. The re-engagement
 * hook (your staked Social XP gets slashed if the window closes): re-share the link.
 * Hides itself when there's nothing pending.
 */
export function PendingHalfCards() {
  const [items, setItems] = useState<PendingVouch[] | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  useEffect(() => {
    getPendingVouches(window.location.origin)
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  if (items === null || items.length === 0) return null;

  async function copy(v: PendingVouch) {
    try {
      await navigator.clipboard.writeText(v.claimUrl);
      setCopied(v.id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <Frame label="pending // awaiting_claim" index={String(items.length).padStart(2, '0')} accent="tertiary" tape="tr">
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
              <span className="font-mono text-[10px]">{v.daysLeft <= 0 ? 'now' : `${v.daysLeft}d`}</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm italic text-foreground/85">&ldquo;{v.note}&rdquo;</p>
              <p
                className={cn(
                  'font-mono text-[10px] uppercase tracking-wider',
                  v.daysLeft <= 1 ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                {v.daysLeft <= 1 ? 'slashes today · re-share now' : "stake at risk · re-share before it's slashed"}
              </p>
            </div>
            <button
              onClick={() => copy(v)}
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'glass shrink-0 font-mono')}
            >
              {copied === v.id ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied === v.id ? 'copied' : 'copy_link'}
            </button>
          </li>
        ))}
      </ul>
    </Frame>
  );
}
