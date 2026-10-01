'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { getWallet } from '@/lib/wallet';
import { txExplorerUrl } from '@/lib/stellar';
import {
  enableUsdc,
  getUsdcBalance,
  hasUsdcTrustline,
  isValidAmount,
  requestTestUsdc,
  stroopsToUsdc,
  tip,
} from '@/lib/rewards';
import { resolveHandle } from '@/lib/registry';
import { normalizeHandle } from '@/lib/profile';
import { validateTip } from '@/lib/admin';
import { Frame } from '@/components/fx/frame';
import { NumberTicker } from '@/components/fx/number-ticker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { StateArt } from '@/components/ui/state-art';
import { Avatar } from '@/components/Avatar';
import { isStellarAddress, shortAddr } from '@alvinmunk/shared';
import { withTimeout, humanizeError } from '@/lib/utils';
import { toast } from '@/components/ui/toaster';
import { useTranslations } from '@/lib/i18n';
import {
  MoneyFlowConfirm,
  hasTippedOnMainnet,
  isRealMoney,
  rememberMainnetTip,
  type MoneyConfirmRequest,
} from '@/components/MoneyFlowConfirm';

// Rewards contract error codes that can surface on tip (mirrors contracts/rewards Error enum).
// An insufficient-USDC failure (the SAC's own error) is caught by humanizeError directly.
// Built from `t` so the copy follows the active locale. #8 and #20 are the contract's
// `validate_tip` (#144): a zero or self tip moves no value, so the chain refuses it —
// `validateTip` below normally catches those before anyone signs.
export function buildTipErrors(t: (key: string) => string): Record<number, string> {
  return {
    5: t('tip.error.paused'),
    8: t('tip.error.invalidAmount'),
    10: t('tip.error.review'),
    20: t('tip.error.selfTip'),
  };
}

/**
 * USDC tip rail (Green belt). A tip is a real wallet -> wallet USDC transfer. USDC is a
 * classic asset wrapped as a SAC, so a wallet needs a trustline to receive; test USDC
 * comes from the faucet. The cashable, spendable side — distinct from non-cashable Social XP.
 *
 * Every tip moves value: above 0 USDC, to somebody else. Checked here before signing
 * (`validateTip`) and again on-chain (#144), so the `tipped` event the feed reads is
 * always proof that a real spend happened.
 */
export function Tip({ address }: { address: string }) {
  const t = useTranslations();
  const [balance, setBalance] = useState<bigint | null>(null);
  const [trusts, setTrusts] = useState<boolean | null>(null);
  const [to, setTo] = useState('');
  // Feedback-driven: people think in @handles, not 56-char keys. Resolve a typed handle to
  // its on-chain address via the registry so the tip can target "@beko" instead of a G…/C….
  const [resolved, setResolved] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [amount, setAmount] = useState('1');
  const [busy, setBusy] = useState<null | 'enable' | 'faucet' | 'tip'>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A mainnet tip waiting on its confirmation (#291), with the amount exactly as typed.
  const [pending, setPending] = useState<{ request: MoneyConfirmRequest; amount: string } | null>(null);
  const [firstMainnetTip, setFirstMainnetTip] = useState(false);

  const refresh = useCallback(() => {
    // Timeout the gating reads so a slow Horizon/RPC degrades to a usable state instead
    // of leaving the balance stuck on "…" forever (demo-grade robustness).
    void withTimeout(getUsdcBalance(address, address), 12_000, 'balance')
      .then(setBalance)
      .catch(() => setBalance(0n));
    void withTimeout(hasUsdcTrustline(address), 12_000, 'trustline')
      .then(setTrusts)
      .catch(() => setTrusts(false));
  }, [address]);

  useEffect(refresh, [refresh]);

  // Resolve the recipient: a raw G…/C… key is used as-is; anything else is treated as a
  // handle and looked up on-chain (debounced). `resolved` is the address the tip actually
  // targets, so a mistyped handle can never silently send to a wrong-but-valid key.
  useEffect(() => {
    const raw = to.trim();
    if (isStellarAddress(raw)) {
      setResolved(raw);
      setResolving(false);
      return;
    }
    const handle = normalizeHandle(raw.replace(/^@/, ''));
    if (handle.length < 3) {
      setResolved(null);
      setResolving(false);
      return;
    }
    let alive = true;
    setResolving(true);
    const timer = setTimeout(() => {
      resolveHandle(handle)
        .catch(() => null)
        .then((addr) => {
          if (alive) {
            setResolved(addr);
            setResolving(false);
          }
        });
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [to]);

  async function run(kind: 'enable' | 'faucet' | 'tip', fn: () => Promise<string | void>) {
    setBusy(kind);
    setError(null);
    setHash(null);
    try {
      const h = await fn();
      if (typeof h === 'string' && h) setHash(h);
      // Success feedback — `tip` returns void (no hash), so without this it looked silent.
      toast.success(
        kind === 'tip'
          ? t('tip.toast.tip')
          : kind === 'faucet'
            ? t('tip.toast.faucet')
            : t('tip.toast.enable'),
      );
      refresh();
    } catch (e) {
      const msg = humanizeError(e, buildTipErrors(t), 'tip');
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(null);
    }
  }

  /** Sign and send: the only path to the wallet prompt. */
  function sendTip(to: string, amountInput: string) {
    return run('tip', async () => {
      const wallet = await getWallet();
      // The contract's own two checks (#144), run here first so a tip that could only
      // revert never costs a fee.
      const check = validateTip({ to, amount: amountInput }, wallet.address);
      if (!check.ok) {
        throw new Error(to === wallet.address ? t('tip.error.ownWallet') : check.error);
      }
      await tip(wallet, to, check.value);
      if (isRealMoney()) {
        rememberMainnetTip();
        setFirstMainnetTip(false);
      }
    });
  }

  function onSend() {
    // `resolved` is guaranteed a valid key here (the button is gated on it).
    if (!resolved) return;
    // Testnet: one click, as before.
    if (!isRealMoney()) {
      void sendTip(resolved, amount);
      return;
    }
    // Mainnet: never ask to confirm a tip that could only revert.
    const check = validateTip({ to: resolved, amount }, address);
    if (!check.ok) {
      const msg = resolved === address ? t('tip.error.ownWallet') : check.error;
      setError(msg);
      toast.error(msg);
      return;
    }
    const raw = to.trim();
    setError(null);
    setFirstMainnetTip(!hasTippedOnMainnet());
    // A snapshot: the dialog shows, and the tip sends, exactly this — later edits to the
    // form can't change what was confirmed.
    setPending({
      request: {
        kind: 'tip',
        to: resolved,
        handle: isStellarAddress(raw) ? null : normalizeHandle(raw.replace(/^@/, '')),
        amount: stroopsToUsdc(check.value),
      },
      amount,
    });
  }

  return (
    <Frame label={t('tip.frame')} index="03">
      <div className="p-5">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-base font-semibold">{t('tip.title')}</h2>
          <Badge variant="primary">
            {balance === null ? (
              '…'
            ) : (
              <NumberTicker value={Number(stroopsToUsdc(balance))} decimals={2} suffix=" USDC" />
            )}
          </Badge>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">{t('tip.subtitle')}</p>

        {trusts === false ? (
          <Button
            onClick={() => run('enable', () => getWallet().then(enableUsdc))}
            disabled={busy !== null}
            className="w-full"
          >
            {busy === 'enable' ? t('tip.enabling') : t('tip.enable')}
          </Button>
        ) : (
          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              onClick={() => run('faucet', () => requestTestUsdc(address))}
              disabled={busy !== null}
              className="w-full"
            >
              {busy === 'faucet' ? t('tip.requesting') : t('tip.faucet')}
            </Button>
            <Input
              value={to}
              onChange={(e) => setTo(e.target.value.trim())}
              placeholder={t('tip.recipientPlaceholder')}
              aria-label={t('tip.recipientAria')}
              className="font-mono text-xs"
            />
            {/* Resolution feedback: confirm who a handle points to before sending. */}
            {!isStellarAddress(to.trim()) && to.trim().length > 0 && (
              <div className="-mt-1 flex items-center text-xs text-muted-foreground">
                {resolving ? (
                  t('tip.lookingUp')
                ) : resolved ? (
                  <span className="flex items-center text-secondary">
                    → <Avatar address={resolved} size={16} ring={false} className="mx-1.5" />
                    {shortAddr(resolved, 6, 6)}
                  </span>
                ) : (
                  <span className="text-destructive">{t('tip.noWallet')}</span>
                )}
              </div>
            )}
            <div className="flex gap-2">
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder={t('tip.amountPlaceholder')}
                aria-label={t('tip.amountAria')}
                className="w-24"
              />
              <Button
                onClick={onSend}
                disabled={busy !== null || pending !== null || resolving || !resolved || !isValidAmount(amount)}
                className="flex-1"
              >
                {busy === 'tip' ? t('tip.sending') : t('tip.send')}
              </Button>
            </div>
          </div>
        )}

        {hash && (
          <div className="mt-3 flex flex-col items-center">
            <StateArt kind="tip-received" size={104} className="motion-safe:animate-ignite" />
            <a
              href={txExplorerUrl(hash)}
              target="_blank"
              rel="noreferrer"
              className="mt-1 block text-center text-xs text-secondary underline"
            >
              {t('tip.confirmed')}
            </a>
          </div>
        )}
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </div>

      {pending && (
        <MoneyFlowConfirm
          request={pending.request}
          requireAck={firstMainnetTip}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            setPending(null);
            void sendTip(pending.request.to, pending.amount);
          }}
        />
      )}
    </Frame>
  );
}
