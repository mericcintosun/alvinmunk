'use client';

import { useCallback, useEffect, useState } from 'react';
import { getWallet } from '@/lib/wallet';
import { txExplorerUrl } from '@/lib/stellar';
import {
  enableUsdc,
  getUsdcBalance,
  hasUsdcTrustline,
  requestTestUsdc,
  stroopsToUsdc,
  tip,
  usdcToStroops,
} from '@/lib/rewards';

/**
 * USDC tip rail (Green belt — shipped FIRST to de-risk retention, per 00-strategy §5).
 * A tip is a real wallet -> wallet USDC transfer. USDC is a classic asset wrapped as a
 * SAC, so a wallet needs a trustline to receive; test USDC comes from the faucet.
 * This is the cashable, spendable side — distinct from non-cashable Social XP.
 */
export function Tip({ address }: { address: string }) {
  const [balance, setBalance] = useState<bigint | null>(null);
  const [trusts, setTrusts] = useState<boolean | null>(null);
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('1');
  const [busy, setBusy] = useState<null | 'enable' | 'faucet' | 'tip'>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void getUsdcBalance(address, address).then(setBalance).catch(() => setBalance(0n));
    void hasUsdcTrustline(address).then(setTrusts).catch(() => setTrusts(false));
  }, [address]);

  useEffect(refresh, [refresh]);

  async function run(kind: 'enable' | 'faucet' | 'tip', fn: () => Promise<string | void>) {
    setBusy(kind);
    setError(null);
    setHash(null);
    try {
      const h = await fn();
      if (typeof h === 'string' && h) setHash(h);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'action failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="w-full rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white/80">USDC tip</h2>
        <span className="text-xs text-white/50">
          Balance:{' '}
          <span className="font-semibold text-stellar">
            {balance === null ? '…' : `${stroopsToUsdc(balance)} USDC`}
          </span>
        </span>
      </div>
      <p className="mb-3 text-[11px] text-white/40">
        Spendable, cashable rail — send real testnet USDC wallet&nbsp;→&nbsp;wallet.
      </p>

      {trusts === false ? (
        <button
          onClick={() => run('enable', () => getWallet().then(enableUsdc))}
          disabled={busy !== null}
          className="w-full rounded-full bg-sigil/80 py-2.5 text-sm font-semibold text-white active:scale-95 disabled:opacity-50"
        >
          {busy === 'enable' ? 'Enabling…' : 'Enable USDC (1 tap)'}
        </button>
      ) : (
        <div className="space-y-2">
          <button
            onClick={() => run('faucet', () => requestTestUsdc(address))}
            disabled={busy !== null}
            className="w-full rounded-full border border-white/15 py-2 text-xs font-semibold text-white/80 active:scale-95 disabled:opacity-50"
          >
            {busy === 'faucet' ? 'Requesting…' : 'Get 5 test USDC'}
          </button>
          <input
            value={to}
            onChange={(e) => setTo(e.target.value.trim())}
            placeholder="Recipient G… address"
            className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-white placeholder:text-white/30"
          />
          <div className="flex gap-2">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="1.0"
              className="w-24 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-white placeholder:text-white/30"
            />
            <button
              onClick={() =>
                run('tip', async () => {
                  const wallet = await getWallet();
                  await tip(wallet, to, usdcToStroops(amount));
                })
              }
              disabled={busy !== null || !/^G[A-Z2-7]{55}$/.test(to)}
              className="flex-1 rounded-full bg-stellar/90 py-2.5 text-sm font-semibold text-black active:scale-95 disabled:opacity-40"
            >
              {busy === 'tip' ? 'Sending…' : 'Send tip'}
            </button>
          </div>
        </div>
      )}

      {hash && (
        <a
          href={txExplorerUrl(hash)}
          target="_blank"
          rel="noreferrer"
          className="mt-2 block text-center text-xs text-sigil underline"
        >
          confirmed on-chain →
        </a>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </section>
  );
}
