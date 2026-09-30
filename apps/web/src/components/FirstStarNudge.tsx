'use client';

import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { getMyVouches } from '@/lib/myvouches';
import { useTranslations } from '@/lib/i18n';
import { getItem, setItem } from '@/lib/storage';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * First-run "vouch-first" nudge (roundtable / Kaan): at 0 users the activation moment is
 * GIVING the first vouch, not waiting to receive one. When a brand-new profile has minted
 * nothing yet, point them straight at the vouch action — the loop starts with them. Shown
 * once, dismisses itself the moment they mint their first vouch (or tap dismiss).
 */
const DISMISS_KEY = 'alvinmunk.firstStar.dismissed';

export function FirstStarNudge() {
  const t = useTranslations();
  const [show, setShow] = useState(false);

  useEffect(() => {
    const dismissed = getItem(DISMISS_KEY) === '1';
    setShow(!dismissed && getMyVouches().length === 0);
  }, []);

  if (!show) return null;

  return (
    <div className="rounded-2xl border border-secondary/40 bg-secondary/10 p-5 text-center">
      <p className="text-base font-semibold">{t('firstStarNudge.title')}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground text-balance">
        {t('firstStarNudge.body')}
      </p>
      <div className="mt-3 flex items-center justify-center gap-2 eyebrow-mono text-secondary">
        {/* The vouch form lives on /app/vouch, not below this card (#475). */}
        <Link href="/app/vouch" className={cn(buttonVariants({ variant: 'flow', size: 'sm' }), 'font-mono')}>
          {t('firstStarNudge.action')}
          <ArrowRight aria-hidden />
        </Link>
        <button
          onClick={() => {
            setItem(DISMISS_KEY, '1');
            setShow(false);
          }}
          className="ml-3 text-muted-foreground underline hover:text-foreground"
        >
          {t('firstStarNudge.dismiss')}
        </button>
      </div>
    </div>
  );
}
