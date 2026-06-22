'use client';

import Link from 'next/link';
import { useWallet } from './wallet-provider';
import { Crest } from '@/components/brand/crest';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Identity affordance in the navbar. No profile → a primary "Open app" CTA (onboarding
 * lives in /app). Connected → a chip with the crest + handle + balance, linking to the
 * public profile.
 */
export function ConnectButton() {
  const { profile, balance } = useWallet();

  if (!profile) {
    return (
      <Link href="/app" className={cn(buttonVariants({ size: 'sm' }))}>
        Open app
      </Link>
    );
  }

  return (
    <Link
      href={`/u/${profile.handle}`}
      className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 py-1 pl-1 pr-3 transition-colors hover:bg-muted"
    >
      <Crest address={profile.address} handle={profile.handle} size={28} points={5} />
      <span className="text-sm font-medium">@{profile.handle}</span>
      {balance != null && (
        <span className="hidden text-xs text-muted-foreground sm:inline">
          {Number(balance).toFixed(1)} XLM
        </span>
      )}
    </Link>
  );
}
