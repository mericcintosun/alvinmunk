'use client';

import { useCallback, useEffect, useState } from 'react';
import { getWallet } from '@/lib/wallet';
import { txExplorerUrl } from '@/lib/stellar';
import { getEarnedScore } from '@/lib/reputation';
import { claimReward, getRewards, getUsdcBalance, isClaimed, stroopsToUsdc, usdcToStroops, type RewardEntry } from '@/lib/rewards';
import {
  getAnchorConfig,
  getWithdrawalStatus,
  isTerminalStatus,
  sendWithdrawalPayment,
  startWithdrawal,
  type WithdrawalSession,
} from '@/lib/anchor';
import { Frame } from '@/components/fx/frame';
import { NumberTicker } from '@/components/fx/number-ticker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { withTimeout, humanizeError } from '@/lib/utils';
import { toast } from '@/components/ui/toaster';

// Rewards contract error codes → friendly copy (mirrors contracts/rewards Error enum).
const REWARD_ERRORS: Record<number, string> = {
  3: 'You need more Earned XP to unlock this reward.',
  4: 'You’ve already claimed this reward.',
  5: 'Rewards are paused right now — try again later.',
  7: 'This reward isn’t active.',
  9: 'The daily reward limit was reached — try again tomorrow.',
  10: 'This account is under review and can’t claim right now.',
  12: 'You need to receive funds first before claiming (mainnet rule).',
  13: 'This reward’s pool is used up.',
};

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
    // Timeout the gating reads so a slow RPC degrades to "no rewards" instead of an
    // endless skeleton in front of a tester/judge.
    const [e, table] = await Promise.all([
      withTimeout(getEarnedScore(address, address), 12_000, 'score').catch(() => 0),
      withTimeout(getRewards(address), 12_000, 'rewards').catch(() => [] as RewardEntry[]),
    ]);
    setEarned(e);
    const withClaimed = await Promise.all(
      table.map(async (r) => ({
        ...r,
        claimed: await withTimeout(isClaimed(r.id, address, address), 12_000, 'claim status').catch(
          () => false,
        ),
      })),
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
      toast.success('Reward claimed — USDC is in your wallet 🎉');
    } catch (e) {
      const msg = humanizeError(e, REWARD_ERRORS);
      setError(msg);
      toast.error(msg);
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
              const cap = r.max_claims ?? 0;
              const left = cap > 0 ? Math.max(0, cap - (r.claims ?? 0)) : null;
              const soldOut = left === 0;
              return (
                <li
                  key={r.id}
                  className="flex items-center justify-between rounded-xl border border-border bg-card/40 px-4 py-3"
                >
                  <span className="text-sm text-muted-foreground">
                    {Number(r.threshold)} XP →{' '}
                    <span className="font-semibold text-primary">{stroopsToUsdc(r.amount)} USDC</span>
                    {left !== null && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        · {soldOut ? 'none left' : `${left} of ${cap} left`}
                      </span>
                    )}
                  </span>
                  <Button
                    size="sm"
                    variant={r.claimed || soldOut || !unlocked ? 'secondary' : 'primary'}
                    onClick={() => onClaim(r.id)}
                    disabled={busy !== null || r.claimed || soldOut || !unlocked}
                  >
                    {r.claimed
                      ? 'Claimed'
                      : soldOut
                        ? 'Sold out'
                        : busy === r.id
                          ? 'Claiming…'
                          : unlocked
                            ? 'Claim'
                            : 'Locked'}
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

        <AnchorCashout address={address} />
      </div>
    </Frame>
  );
}

/**
 * Anchor off-ramp (SEP-24): authenticate with SEP-10, start an interactive withdrawal,
 * open the anchor's hosted flow, then — once the anchor reports
 * `pending_user_transfer_start` — send it the USDC with its memo. The status is polled
 * until the anchor reaches a terminal state.
 */
function AnchorCashout({ address }: { address: string }) {
  const anchor = getAnchorConfig();
  const anchorDomain = anchor?.homeDomain;
  const [amount, setAmount] = useState('');
  const [balance, setBalance] = useState<bigint | null>(null);
  const [session, setSession] = useState<WithdrawalSession | null>(null);
  const [busy, setBusy] = useState<null | 'start' | 'send'>(null);
  const [paidHash, setPaidHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (anchorDomain) void getUsdcBalance(address, address).then(setBalance);
  }, [address, anchorDomain]);

  const withdrawalId = session?.withdrawal.id;
  const status = session?.withdrawal.status;
  const token = session?.token;
  const transferServer = session?.toml.transferServer;

  // Poll while the withdrawal is open. Depends on the id/status only, so updating the
  // session with each poll result doesn't restart the timer.
  useEffect(() => {
    if (!withdrawalId || !token || !transferServer || !status || isTerminalStatus(status)) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await getWithdrawalStatus(withdrawalId, token, transferServer);
        if (!cancelled) setSession((s) => (s ? { ...s, withdrawal: next } : s));
      } catch {
        // A transient anchor outage should not erase the last known status.
      }
    };
    const timer = window.setInterval(() => void poll(), 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [withdrawalId, status, token, transferServer]);

  async function cashOut() {
    setBusy('start');
    setError(null);
    try {
      if (balance !== null && usdcToStroops(amount) > balance) {
        throw new Error('The withdrawal amount exceeds your available USDC.');
      }
      const wallet = await getWallet();
      const next = await startWithdrawal(wallet, amount);
      setSession(next);
      setPaidHash(null);
      setAmount('');
      if (next.withdrawal.url) window.open(next.withdrawal.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError(humanizeError(e));
    } finally {
      setBusy(null);
    }
  }

  async function sendToAnchor() {
    if (!session) return;
    setBusy('send');
    setError(null);
    try {
      const wallet = await getWallet();
      setPaidHash(await sendWithdrawalPayment(wallet, session.withdrawal, session.toml.usdcIssuer));
    } catch (e) {
      setError(humanizeError(e));
    } finally {
      setBusy(null);
    }
  }

  const w = session?.withdrawal;
  const awaitingTransfer = w?.status === 'pending_user_transfer_start' && !paidHash;

  return (
    <div className="mt-4 border-t border-border pt-3">
      {anchor ? (
        <>
          <label htmlFor="cashout-amount" className="mb-2 block text-xs text-muted-foreground">
            Cash out USDC to local currency via {anchor.homeDomain}
          </label>
          <div className="flex gap-2">
            <Input
              id="cashout-amount"
              className="h-9 min-w-0 flex-1"
              inputMode="decimal"
              placeholder="USDC amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <Button size="sm" variant="onchain" onClick={() => void cashOut()} disabled={busy !== null || !amount}>
              {busy === 'start' ? 'Starting…' : 'Cash out'}
            </Button>
          </div>
          {balance !== null && (
            <p className="mt-1 text-xs text-muted-foreground">Available: {stroopsToUsdc(balance)} USDC</p>
          )}
          {w && (
            <p className="mt-2 text-xs text-secondary" aria-live="polite">
              Withdrawal {w.status.replaceAll('_', ' ')}
              {w.message ? ` — ${w.message}` : ''}
            </p>
          )}
          {awaitingTransfer && (
            <Button
              size="sm"
              variant="onchain"
              className="mt-2"
              onClick={() => void sendToAnchor()}
              disabled={busy !== null}
            >
              {busy === 'send' ? 'Sending…' : `Send ${w?.amountIn} USDC to ${anchor.homeDomain}`}
            </Button>
          )}
          {paidHash && (
            <a
              href={txExplorerUrl(paidHash)}
              target="_blank"
              rel="noreferrer"
              className="mt-2 block text-xs text-secondary underline"
            >
              Payment sent — view transaction →
            </a>
          )}
          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          Cash out to local cash via a Stellar anchor (SEP-24 off-ramp) — coming at mainnet.
        </p>
      )}
    </div>
  );
}
