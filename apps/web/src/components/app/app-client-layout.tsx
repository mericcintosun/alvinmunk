'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useWallet } from '@/components/wallet/wallet-provider';
import { Onboarding } from '@/components/app/onboarding';
import { AppShell } from '@/components/app/app-shell';

/**
 * /app segment layout — the onboarding gate. No profile yet → the create-profile flow
 * (no dashboard chrome). Once a profile exists, every /app/* route renders inside the
 * shared shell (identity + stats + sub-nav).
 */
export function AppClientLayout({ children }: { children: React.ReactNode }) {
  const { profile } = useWallet();
  if (!profile) {
    // Suspense keeps /app static: the server renders the empty form, the client the prefilled one.
    return (
      <Suspense fallback={<Onboarding />}>
        <OnboardingFromUrl />
      </Suspense>
    );
  }
  return <AppShell>{children}</AppShell>;
}

/** `/app?handle=<x>` — the "Claim @x" link on an unclaimed `/u/<x>` — prefills the picker. */
function OnboardingFromUrl() {
  const initialHandle = useSearchParams().get('handle') ?? undefined;
  return <Onboarding initialHandle={initialHandle} />;
}
