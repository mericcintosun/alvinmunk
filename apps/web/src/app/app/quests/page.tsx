'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@/components/wallet/wallet-provider';
import { FOCUS_MODE } from '@/lib/focus';
import { Quests } from '@/components/Quests';

/**
 * Quests — verified, attester-checked actions that grant Earned XP. Earned XP is the only
 * track the Rewards contract reads, so this is the path to anything cashable. Hidden under
 * FOCUS_MODE (belts/08) — direct hits bounce back to Home.
 */
export default function QuestsPage() {
  const router = useRouter();
  const { profile } = useWallet();
  useEffect(() => {
    if (FOCUS_MODE) router.replace('/app');
  }, [router]);
  if (FOCUS_MODE || !profile) return null;

  return (
    <div className="grid gap-6">
      <header>
        <h1 className="font-display text-2xl font-semibold">Verified quests</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground text-balance">
          These are checked by the attester, not self-reported. Each completion mints{' '}
          <span className="text-secondary">Earned XP</span> — the only kind that can ever unlock
          USDC. Keep a weekly streak going to climb faster.
        </p>
      </header>

      <Quests address={profile.address} />
    </div>
  );
}
