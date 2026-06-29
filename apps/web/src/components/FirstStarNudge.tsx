'use client';

import { useEffect, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import { getMyVouches } from '@/lib/myvouches';

/**
 * First-run "vouch-first" nudge (roundtable / Kaan): at 0 users the activation moment is
 * GIVING the first vouch, not waiting to receive one. When a brand-new profile has minted
 * nothing yet, point them straight at the vouch action — the loop starts with them. Shown
 * once, dismisses itself the moment they mint their first vouch (or tap dismiss).
 */
const DISMISS_KEY = 'alvinmunk.firstStar.dismissed';

export function FirstStarNudge() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const dismissed = typeof localStorage !== 'undefined' && localStorage.getItem(DISMISS_KEY) === '1';
    setShow(!dismissed && getMyVouches().length === 0);
  }, []);

  if (!show) return null;

  return (
    <div className="rounded-2xl border border-secondary/40 bg-secondary/10 p-5 text-center">
      <p className="text-base font-semibold">Your sky starts with one star ✦</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground text-balance">
        alvinmunk begins by backing someone. Vouch for one person you trust below — they don&apos;t
        even need an account yet. Their star ignites when they claim it.
      </p>
      <div className="mt-3 flex items-center justify-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-secondary">
        <ArrowDown className="size-3.5 motion-safe:animate-bounce" />
        light your first star
        <button
          onClick={() => {
            if (typeof localStorage !== 'undefined') localStorage.setItem(DISMISS_KEY, '1');
            setShow(false);
          }}
          className="ml-3 text-muted-foreground/60 underline hover:text-foreground"
        >
          dismiss
        </button>
      </div>
    </div>
  );
}
