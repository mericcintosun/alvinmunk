'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@/components/wallet/wallet-provider';
import { FOCUS_MODE } from '@/lib/focus';
import { Tip } from '@/components/Tip';
import { Rewards } from '@/components/Rewards';
import { Unlockables } from '@/components/Unlockables';

/**
 * Rewards — the spend + capability surface. Send USDC tips, claim rank rewards (gated by
 * Earned XP), and unlock reputation-gated perks. This is where reputation becomes spendable.
 * Hidden under FOCUS_MODE (belts/08) — direct hits bounce back to Home.
 */
export default function RewardsPage() {
  const router = useRouter();
  const { profile } = useWallet();
  useEffect(() => {
    if (FOCUS_MODE) router.replace('/app');
  }, [router]);
  if (FOCUS_MODE || !profile) return null;

  return (
    <div className="grid gap-8">
      <header>
        <h1 className="font-display text-2xl font-semibold">Spend your reputation</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground text-balance">
          Tip anyone in USDC, claim rank rewards once your Earned XP clears the bar, and unlock
          perks gated by your standing.
        </p>
      </header>

      <section className="grid gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Send</h2>
        <Tip address={profile.address} />
      </section>

      <section className="grid gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Claim</h2>
        <Rewards address={profile.address} />
      </section>

      <section className="grid gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Unlock</h2>
        <Unlockables address={profile.address} />
      </section>
    </div>
  );
}
