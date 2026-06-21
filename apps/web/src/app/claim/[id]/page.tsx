'use client';

import { Suspense, use, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getWallet } from '@/lib/wallet';
import { claimVouch } from '@/lib/reputation';
import { VouchCard } from '@/components/VouchCard';

/**
 * Claim flow — the install funnel (00-strategy §3). A non-crypto friend lands here
 * from a shared link: "X vouched for you. Claim your side →". Face ID -> claim ->
 * the empty socket blooms. No wallet/seed/gas words on this page.
 */
export default function ClaimPage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={null}>
      <ClaimInner {...props} />
    </Suspense>
  );
}

function ClaimInner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const secret = useSearchParams().get('s') ?? '';
  const [claimed, setClaimed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClaim() {
    if (!secret) {
      setError('This link is missing its claim code.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const wallet = await getWallet();
      await claimVouch(wallet, Number(id), secret);
      setClaimed(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'claim failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-8 p-6">
      <h1 className="text-center text-xl font-semibold">
        Someone vouched for you.
        <br />
        <span className="text-stellar">Vouch #{id}</span>
      </h1>

      <VouchCard
        fromHandle="a friend"
        toHandle={claimed ? 'you' : null}
        note="unblocked me at 2am"
        seedAddress={`vouch-${id}`}
      />

      {!claimed ? (
        <button
          onClick={onClaim}
          disabled={busy}
          className="rounded-full bg-stellar px-6 py-3 font-semibold text-ink active:scale-95 disabled:opacity-60"
        >
          {busy ? 'Claiming…' : 'Claim with Face ID'}
        </button>
      ) : (
        <p className="text-sm text-white/70">Claimed. Your side just bloomed ✨</p>
      )}

      {error && <p className="max-w-xs text-center text-xs text-red-400">{error}</p>}
    </main>
  );
}
