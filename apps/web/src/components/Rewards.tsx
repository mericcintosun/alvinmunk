'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { getWallet } from '@/lib/wallet';
import { txExplorerUrl } from '@/lib/stellar';
import { getEarnedScore } from '@/lib/reputation';
import { getStreak } from '@/lib/quests';
import { claimReward, getRewardsFor, getUsdcBalance, stroopsToUsdc, usdcToStroops, type RewardStatus } from '@/lib/rewards';
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
import { useTranslations } from '@/lib/i18n';
import { MoneyFlowConfirm, isRealMoney, type MoneyConfirmRequest } from '@/components/MoneyFlowConfirm';

// Rewards contract error codes → friendly copy (mirrors contracts/rewards Error enum).
// Built from `t` so the copy follows the active locale. 15–17 and 19 are admin-only
// (add_reward / set_reward_active / set_daily_cap / set_reward_min_streak).
export function buildRewardErrors(t: (key: string) => string): Record<number, string> {
  return {
    3: t('rewards.error.xp'),
    4: t('rewards.error.already'),
    5: t('rewards.error.paused'),
    7: t('rewards.error.inactive'),
    9: t('rewards.error.daily'),
    10: t('rewards.error.review'),
    12: t('rewards.error.funding'),
    13: t('rewards.error.pool'),
    15: t('rewards.error.threshold'),
    16: t('rewards.error.overDailyCap'),
    17: t('rewards.error.capBelowReward'),
    18: t('rewards.error.streakTooShort'),
    19: t('rewards.error.streakUnset'),
    100: t('rewards.error.treasury'),
  };
}

// Blocks that stop every row alike (paused, account under review, unfunded): shown once.
const WALLET_BLOCKS = new Set([5, 10, 12]);
// Row blocks the row doesn't already show (XP, streak and supply are on the row itself).
const ROW_HINTS = new Set([9, 19]);

/**
 * Rank -> reward unlock table (Green belt). Each reward is admin-registered on-chain
 * (Earned-XP threshold -> USDC); the contract pays the STORED amount, so rank buys
 * something real and the treasury can't be drained. Earned-gated (vouches never unlock it).
 * A reward can also require a live weekly quest streak (`min_streak`); `get_streak`
 * already reads a lapsed run as 0, so the count shown is the one the contract checks.
 *
 * The table renders from ONE `get_rewards_for` simulation: each row's `claimed` and
 * `eligible` come from the contract, with `reason` = the error `claim_reward` would revert
 * with, so a row that can't be claimed says why instead of failing on click.
 */
export function Rewards({ address }: { address: string }) {
  const t = useTranslations();
  const [earned, setEarned] = useState<number | null>(null);
  const [streak, setStreak] = useState<number>(0);
  const [rows, setRows] = useState<RewardStatus[] | null>(null);
  const [remainingToday, setRemainingToday] = useState<bigint | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A mainnet claim waiting on its confirmation (#291).
  const [pending, setPending] = useState<{ id: number; request: MoneyConfirmRequest } | null>(null);

  const refresh = useCallback(async () => {
    // Timeout the gating reads so a slow RPC degrades to "no rewards" instead of an
    // endless skeleton in front of a tester/judge.
    const [e, table, weeks] = await Promise.all([
      withTimeout(getEarnedScore(address, address), 12_000, 'score').catch(() => 0),
      withTimeout(getRewardsFor(address, address), 12_000, 'rewards').catch(() => ({
        rows: [] as RewardStatus[],
        remainingToday: null,
      })),
      withTimeout(getStreak(address, address), 12_000, 'streak')
        .then((st) => st.weeks)
        .catch(() => 0),
    ]);
    setEarned(e);
    setStreak(weeks);
    setRows(table.rows);
    setRemainingToday(table.remainingToday);
  }, [address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Mainnet claims pay real USDC: confirm first. Testnet claims run on the click, as before. */
  function onClaim(id: number, amount: bigint) {
    if (!isRealMoney()) {
      void claim(id);
      return;
    }
    setPending({ id, request: { kind: 'claim', to: address, amount: stroopsToUsdc(amount) } });
  }

  async function claim(id: number) {
    setBusy(id);
    setError(null);
    setHash(null);
    try {
      const wallet = await getWallet();
      await claimReward(wallet, id);
      await refresh();
      toast.success(t('rewards.toast.success'));
    } catch (e) {
      const msg = humanizeError(e, buildRewardErrors(t), 'reward');
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(null);
    }
  }

  const errors = buildRewardErrors(t);
  const walletBlock = rows?.find((r) => WALLET_BLOCKS.has(r.reason))?.reason;

  return (
    <Frame label={t('rewards.frame')} index="04" accent="secondary">
      <div className="p-5">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-base font-semibold">{t('rewards.title')}</h2>
          <Badge variant="onchain">
            {t('rewards.earnedXp')}: {earned === null ? '…' : <NumberTicker value={earned} className="ml-0.5" />}
          </Badge>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">{t('rewards.subtitle')}</p>
        {remainingToday !== null && (
          <p className="mb-3 text-xs text-muted-foreground">
            {t('rewards.dailyLeft', { amount: stroopsToUsdc(remainingToday) })}
          </p>
        )}
        {walletBlock !== undefined && <p className="mb-3 text-sm text-destructive">{errors[walletBlock]}</p>}

        {rows === null ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('rewards.noRewards')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map(({ entry: r, claimed, eligible, reason }) => {
              const minStreak = r.min_streak ?? 0;
              const cap = r.max_claims ?? 0;
              const left = cap > 0 ? Math.max(0, cap - (r.claims ?? 0)) : null;
              const soldOut = left === 0;
              const hint = !claimed && ROW_HINTS.has(reason) ? errors[reason] : null;
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
                        ·{' '}
                        {soldOut
                          ? t('rewards.noneLeft')
                          : t('rewards.leftOfCap', { left: String(left), cap: String(cap) })}
                      </span>
                    )}
                    {minStreak > 0 && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        · needs a {minStreak}-week streak (you: {streak})
                      </span>
                    )}
                    {hint && <span className="mt-0.5 block text-xs text-destructive">{hint}</span>}
                  </span>
                  <Button
                    size="sm"
                    variant={claimed || soldOut || !eligible ? 'secondary' : 'primary'}
                    onClick={() => onClaim(r.id, r.amount)}
                    disabled={busy !== null || pending !== null || claimed || soldOut || !eligible}
                  >
                    {claimed
                      ? t('rewards.claimed')
                      : soldOut
                        ? t('rewards.soldOut')
                        : busy === r.id
                          ? t('rewards.claiming')
                          : eligible
                            ? t('rewards.claim')
                            : t('rewards.locked')}
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
            {t('rewards.claimedOnChain')}
          </a>
        )}
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

        <AnchorCashout address={address} />
      </div>

      {pending && (
        <MoneyFlowConfirm
          request={pending.request}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            setPending(null);
            void claim(pending.id);
          }}
        />
      )}
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
  const t = useTranslations();
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
        throw new Error(t('rewards.cashout.exceeds'));
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
            {t('rewards.cashout.label', { domain: anchor.homeDomain })}
          </label>
          <div className="flex gap-2">
            <Input
              id="cashout-amount"
              className="h-9 min-w-0 flex-1"
              inputMode="decimal"
              placeholder={t('rewards.cashout.placeholder')}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <Button size="sm" variant="onchain" onClick={() => void cashOut()} disabled={busy !== null || !amount}>
              {busy === 'start' ? t('rewards.cashout.starting') : t('rewards.cashout.button')}
            </Button>
          </div>
          {balance !== null && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t('rewards.cashout.available', { amount: stroopsToUsdc(balance) })}
            </p>
          )}
          {w && (
            <p className="mt-2 text-xs text-secondary" aria-live="polite">
              {t('rewards.cashout.withdrawal', { status: w.status.replaceAll('_', ' ') })}
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
              {busy === 'send'
                ? t('rewards.cashout.sending')
                : t('rewards.cashout.send', { amount: String(w?.amountIn ?? ''), domain: anchor.homeDomain })}
            </Button>
          )}
          {paidHash && (
            <a
              href={txExplorerUrl(paidHash)}
              target="_blank"
              rel="noreferrer"
              className="mt-2 block text-xs text-secondary underline"
            >
              {t('rewards.cashout.paid')}
            </a>
          )}
          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        </>
      ) : (
        <p className="text-xs text-muted-foreground">{t('rewards.cashout.unavailable')}</p>
      )}
    </div>
  );
}
