'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useWallet } from '@/components/wallet/wallet-provider';
import { IdentityBar } from '@/components/IdentityBar';
import { StatStrip } from '@/components/app/stat-strip';
import { BadgeGallery } from '@/components/BadgeGallery';
import { AppTabs } from '@/components/app/app-tabs';
import { VouchClaimedNotice } from '@/components/VouchClaimedNotice';
import { Avatar } from '@/components/Avatar';
import { cn } from '@/lib/utils';

/**
 * App shell — the persistent chrome around every signed-in /app/* route: identity, the
 * reputation stat strip, and the sticky sub-nav. It stays mounted as the content area
 * swaps between Home / Vouch / Quests / Rewards / Activity, so the dashboard feels like
 * one product, not five stacked pages.
 *
 * Phones (#474): home keeps the full identity bar and stats, with the badges folded into
 * a summary; every other tab opens on one compact identity + stats row, so its own first
 * action is on the first screen. From `sm` up every route gets the full chrome. The same
 * elements stay mounted across tabs (only their classes change), so nothing re-reads.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { profile } = useWallet();
  const pathname = usePathname();
  if (!profile) return null;
  const home = pathname === '/app';

  return (
    <div className="container max-w-4xl py-4 sm:py-6">
      <div className={cn(!home && 'hidden sm:block')}>
        <IdentityBar />
      </div>
      <div className={cn('flex items-center gap-3 sm:mt-4 sm:block', home && 'mt-4')}>
        {!home && (
          <Link
            href={`/u/${profile.handle}`}
            className="flex min-w-0 flex-1 items-center gap-2 sm:hidden"
            data-testid="shell-compact-identity"
          >
            <Avatar address={profile.address} avatar={profile.avatar} handle={profile.handle} size={32} />
            <span className="truncate font-display text-base font-semibold">@{profile.handle}</span>
          </Link>
        )}
        <div className={cn(home && 'min-w-0 flex-1')}>
          <StatStrip address={profile.address} compact={!home} />
        </div>
      </div>
      {/* Milestone badges — always visible from sm up; each session gets its next goal */}
      <div className={cn('mt-4', !home && 'hidden sm:block')}>
        <BadgeGallery address={profile.address} collapsible />
      </div>
      <div className="mt-5">
        <AppTabs />
      </div>
      {/* Loop-closing notice: toasts when a vouch you minted gets claimed (in-app only) */}
      <VouchClaimedNotice />
      <div className="pt-4 sm:pt-6">{children}</div>
    </div>
  );
}
