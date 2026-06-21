'use client';

import { useEffect, useState } from 'react';
import { getWallet } from '@/lib/wallet';
import { completeQuest } from '@/lib/quests';
import { getEarnedScore } from '@/lib/reputation';
import { txExplorerUrl } from '@/lib/stellar';

/**
 * Starter quest (Orange belt). Demonstrates the secured attester flow: the wallet
 * owner proves ownership (signs a message), the server verifies proof + on-chain
 * activity, then grants Earned XP (the cashable track). Earned ≠ Social (vouches).
 */
export function Quests({ address }: { address: string }) {
  const [earned, setEarned] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [hash, setHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getEarnedScore(address, address)
      .then(setEarned)
      .catch(() => setEarned(0));
  }, [address]);

  async function onComplete() {
    setBusy(true);
    setError(null);
    setHash(null);
    try {
      const wallet = await getWallet();
      // Starter quest #2: prove you're active on-chain (your Genesis tx counts).
      const r = await completeQuest(wallet, 2, { type: 'referral_tx', ref: wallet.address });
      if (!r.ok) throw new Error(r.error);
      setHash(r.hash ?? null);
      setEarned(await getEarnedScore(address, address));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'quest failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="w-full rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white/80">Verified quest</h2>
        <span className="text-xs text-white/50">
          Earned XP: <span className="font-semibold text-stellar">{earned ?? '…'}</span>
        </span>
      </div>
      <p className="mb-3 text-[11px] text-white/40">
        Cashable track — only attester-verified actions grant it (vouches don’t).
      </p>
      <button
        onClick={onComplete}
        disabled={busy}
        className="w-full rounded-full bg-sigil/80 py-2.5 text-sm font-semibold text-white active:scale-95 disabled:opacity-50"
      >
        {busy ? 'Verifying…' : 'Complete starter quest'}
      </button>

      {hash && (
        <a
          href={txExplorerUrl(hash)}
          target="_blank"
          rel="noreferrer"
          className="mt-2 block text-center text-xs text-sigil underline"
        >
          verified on-chain → +30 Earned XP
        </a>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </section>
  );
}
