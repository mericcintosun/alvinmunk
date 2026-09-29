'use client';

import { useCallback, useEffect, useState } from 'react';
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
  usdcToStroops,
} from '@/lib/rewards';
import { resolveHandle } from '@/lib/registry';
import { normalizeHandle } from '@/lib/profile';
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

// Rewards contract error codes that can surface on tip (mirrors contracts/rewards Error enum).
// An insufficient-USDC failure (the SAC's own error) is caught by humanizeError directly.
const TIP_ERRORS: Record<number, string> = {
  5: 'Tips are paused right now — try again later.',
  10: 'This account is under review and can’t tip right now.',
};

/**
 * USDC tip rail (Green belt). A tip is a real wallet -> wallet USDC transfer. USDC is a
 * classic asset wrapped as a SAC, so a wallet needs a trustline to receive; test USDC
 * comes from the faucet. The cashable, spendable side — distinct from non-cashable Social XP.
 */
export function Tip({ address }: { address: string }) {
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
    const t = setTimeout(() => {
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
      clearTimeout(t);
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
          ? 'Tip sent 🎉'
          : kind === 'faucet'
            ? '5 test USDC added to your wallet'
            : 'USDC enabled — you can receive tips now',
      );
      refresh();
    } catch (e) {
      const msg = humanizeError(e, TIP_ERRORS);
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Frame label="spend // tip" index="03">
      <div className="p-5">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-base font-semibold">Send a tip</h2>
          <Badge variant="primary">
            {balance === null ? (
              '…'
            ) : (
              <NumberTicker value={Number(stroopsToUsdc(balance))} decimals={2} suffix=" USDC" />
            )}
          </Badge>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          A spendable, cashable rail — send real testnet USDC wallet&nbsp;→&nbsp;wallet.
        </p>

        {trusts === false ? (
          <Button
            onClick={() => run('enable', () => getWallet().then(enableUsdc))}
            disabled={busy !== null}
            className="w-full"
          >
            {busy === 'enable' ? 'Enabling…' : 'Enable USDC (1 tap)'}
          </Button>
        ) : (
          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              onClick={() => run('faucet', () => requestTestUsdc(address))}
              disabled={busy !== null}
              className="w-full"
            >
              {busy === 'faucet' ? 'Requesting…' : 'Get 5 test USDC'}
            </Button>
            <Input
              value={to}
              onChange={(e) => setTo(e.target.value.trim())}
              placeholder="@handle or address (G… / C…)"
              className="font-mono text-xs"
            />
            {/* Resolution feedback: confirm who a handle points to before sending. */}
            {!isStellarAddress(to.trim()) && to.trim().length > 0 && (
              <div className="-mt-1 flex items-center text-xs text-muted-foreground">
                {resolving ? (
                  'Looking up handle…'
                ) : resolved ? (
                  <span className="flex items-center text-secondary">
                    → <Avatar address={resolved} size={16} ring={false} className="mx-1.5" />
                    {shortAddr(resolved, 6, 6)}
                  </span>
                ) : (
                  <span className="text-destructive">No wallet found for that handle</span>
                )}
              </div>
            )}
            <div className="flex gap-2">
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="1.0"
                className="w-24"
              />
              <Button
                onClick={() =>
                  run('tip', async () => {
                    const wallet = await getWallet();
                    // `resolved` is guaranteed a valid key here (button is gated on it).
                    await tip(wallet, resolved!, usdcToStroops(amount));
                  })
                }
                disabled={busy !== null || resolving || !resolved || !isValidAmount(amount)}
                className="flex-1"
              >
                {busy === 'tip' ? 'Sending…' : 'Send tip'}
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
              confirmed on-chain →
            </a>
          </div>
        )}
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </div>
    </Frame>
  );
}
