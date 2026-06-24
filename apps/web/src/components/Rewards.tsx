'use client';

import { useCallback, useEffect, useState } from 'react';
import { getWallet } from '@/lib/wallet';
import { txExplorerUrl } from '@/lib/stellar';
import { getEarnedScore } from '@/lib/reputation';
import { claimReward, getRewards, isClaimed, stroopsToUsdc, type RewardEntry } from '@/lib/rewards';
import { getAnchorConfig, anchorEntryUrl } from '@/lib/anchor';
import { Frame } from '@/components/fx/frame';
import { NumberTicker } from '@/components/fx/number-ticker';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Rank -> reward unlock table (Green belt). Each reward is admin-registered on-chain
 * (Earned-XP threshold -> USDC); the contract pays the STORED amount, so rank buys
 * something real and the treasury can't be drained. Earned-gated (vouches never unlock it).
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
    <Frame label="spend // rank" index="04" accent="secondary">
      <div className="p-5">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-base font-semibold">Rank rewards</h2>
          <Badge variant="onchain">
            Earned XP: {earned === null ? '…' : <NumberTicker value={earned} className="ml-0.5" />}
          </Badge>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          Earned XP unlocks real USDC — rank buys something. Vouches (Social XP) never do.
        </p>

        {rows === null ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No rewards registered yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((r) => {
              const unlocked = (earned ?? 0) >= Number(r.threshold);
              return (
                <li
                  key={r.id}
                  className="flex items-center justify-between rounded-xl border border-border bg-card/40 px-4 py-3"
                >
                  <span className="text-sm text-muted-foreground">
                    {Number(r.threshold)} XP →{' '}
                    <span className="font-semibold text-primary">{stroopsToUsdc(r.amount)} USDC</span>
                  </span>
                  <Button
                    size="sm"
                    variant={r.claimed || !unlocked ? 'secondary' : 'primary'}
                    onClick={() => onClaim(r.id)}
                    disabled={busy !== null || r.claimed || !unlocked}
                  >
                    {r.claimed ? 'Claimed' : busy === r.id ? 'Claiming…' : unlocked ? 'Claim' : 'Locked'}
                  </Button>
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
            className="mt-2 block text-center text-xs text-secondary underline"
          >
            claimed on-chain →
          </a>
        )}
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

        <AnchorCashout />
      </div>
    </Frame>
  );
}

/**
 * Anchor off-ramp affordance (IDEA_SUBMISSION anchor angle). Reserved at Orange: when
 * an anchor is configured it links out to start the cash-out; otherwise it states the
 * path honestly. The full SEP-24 interactive withdraw lands at Black belt.
 */
function AnchorCashout() {
  const anchor = getAnchorConfig();
  const url = anchorEntryUrl();
  return (
    <div className="mt-4 border-t border-border pt-3">
      {anchor && url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-secondary underline"
        >
          Cash out to local currency via {anchor.homeDomain} →
        </a>
      ) : (
        <p className="text-xs text-muted-foreground">
          Cash out to local cash via a Stellar anchor (SEP-24 off-ramp) — coming at mainnet.
        </p>
      )}
    </div>
  );
}
