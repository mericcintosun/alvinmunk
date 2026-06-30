'use client';

import { VouchCompose } from '@/components/VouchCompose';
import { PendingHalfCards } from '@/components/PendingHalfCards';

/**
 * Vouch — the giving flow. Mint a half-card for someone (the viral install loop) and keep
 * an eye on the cards you've sent that are still waiting to be claimed.
 */
export default function VouchPage() {
  return (
    <div className="grid gap-6">
      <header>
        <h1 className="font-display text-2xl font-semibold">Light someone&apos;s star</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground text-balance">
          Vouch for a person — they don&apos;t need an account yet. Your card becomes a shareable
          invite; when they claim it, you both earn Social XP.
        </p>
      </header>

      <VouchCompose />
      <PendingHalfCards />
    </div>
  );
}
