'use client';

import { useCallback, useEffect, useState } from 'react';
import { getWallet } from '@/lib/wallet';
import { txExplorerUrl } from '@/lib/stellar';
import { getEarnedScore } from '@/lib/reputation';
import { claimReward, getRewards, isClaimed, stroopsToUsdc, type RewardEntry } from '@/lib/rewards';

/**
 * Rank -> reward unlock table (Green belt). Each reward is registered on-chain by the
 * admin (Earned-XP threshold -> USDC payout); the contract pays the STORED amount so
 * rank BUYS something real and the treasury can't be drained. Earned-gated (keystone):
 * only attester-verified quest XP unlocks the treasury — vouches never do.
 */
type Row = RewardEntry & { claimed: boolean };

export function Rewards({ address }: { address: string }) {
  const [earned, setEarned] = useState<number | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [e, table] = await Promise.all([
      getEarnedScore(address, address).catch(() => 0),
      getRewards(address).catch(() => [] as RewardEntry[]),
    ]);
    setEarned(e);
    const withClaimed = await Promise.all(
      table.map(async (r) => ({ ...r, claimed: await isClaimed(r.id, address, address).catch(() => false) })),
    );
    setRows(withClaimed);
  }, [address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onClaim(id: number) {
    setBusy(id);
    setError(null);
    setHash(null);
    try {
      const wallet = await getWallet();
      await claimReward(wallet, id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'claim failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="w-full rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white/80">Rank rewards</h2>
        <span className="text-xs text-white/50">
          Earned XP: <span className="font-semibold text-stellar">{earned ?? '…'}</span>
        </span>
      </div>
      <p className="mb-3 text-[11px] text-white/40">
        Earned XP unlocks real USDC — rank buys something. Vouches (Social XP) never do.
      </p>

      {rows === null ? (
        <p className="text-xs text-white/40">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-white/40">No rewards registered yet.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const unlocked = (earned ?? 0) >= Number(r.threshold);
            return (
              <li
                key={r.id}
                className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2"
              >
                <span className="text-xs text-white/70">
                  {Number(r.threshold)} XP →{' '}
                  <span className="font-semibold text-stellar">{stroopsToUsdc(r.amount)} USDC</span>
                </span>
                <button
                  onClick={() => onClaim(r.id)}
                  disabled={busy !== null || r.claimed || !unlocked}
                  className="rounded-full bg-stellar/90 px-3 py-1.5 text-xs font-semibold text-black active:scale-95 disabled:bg-white/10 disabled:text-white/40"
                >
                  {r.claimed ? 'Claimed' : busy === r.id ? 'Claiming…' : unlocked ? 'Claim' : 'Locked'}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {hash && (
        <a
          href={txExplorerUrl(hash)}
          target="_blank"
          rel="noreferrer"
          className="mt-2 block text-center text-xs text-sigil underline"
        >
          claimed on-chain →
        </a>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </section>
  );
}
