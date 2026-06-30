'use client';

import { useWallet } from '@/components/wallet/wallet-provider';
import { IdentityBar } from '@/components/IdentityBar';
import { StatStrip } from '@/components/app/stat-strip';
import { AppTabs } from '@/components/app/app-tabs';
import { VouchClaimedNotice } from '@/components/VouchClaimedNotice';

/**
 * App shell — the persistent chrome around every signed-in /app/* route: identity, the
 * reputation stat strip, and the sticky sub-nav. It stays mounted as the content area
 * swaps between Home / Vouch / Quests / Rewards / Activity, so the dashboard feels like
 * one product, not five stacked pages.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { profile } = useWallet();
  if (!profile) return null;

  return (
    <div className="container max-w-4xl py-6">
      <IdentityBar />
      <div className="mt-4">
        <StatStrip address={profile.address} />
      </div>
      <div className="mt-5">
        <AppTabs />
      </div>
      {/* Loop-closing notice: toasts when a vouch you minted gets claimed (in-app only) */}
      <VouchClaimedNotice />
      <div className="pt-6">{children}</div>
    </div>
  );
}
