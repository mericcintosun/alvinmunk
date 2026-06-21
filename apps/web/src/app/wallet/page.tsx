'use client';

import { useState } from 'react';
import Link from 'next/link';
import { connectFreighter, type Wallet } from '@/lib/wallet';
import { getXlmBalance, txExplorerUrl } from '@/lib/stellar';
import { sendXlm, type PaymentResult } from '@/lib/payments';
import { shortAddr } from '@passport/shared';

/**
 * White-belt Level-1 demo: Freighter connect/disconnect, balance display, and a
 * testnet XLM payment with success/failure + tx-hash feedback. This page maps
 * 1:1 to the official Level-1 submission checklist.
 */
export default function WalletPage() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('1');
  const [result, setResult] = useState<PaymentResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validAddr = /^G[A-Z2-7]{55}$/.test(to.trim());
  const validAmount = Number(amount) > 0;

  async function connect() {
    setError(null);
    setBusy(true);
    try {
      const w = await connectFreighter();
      setWallet(w);
      setBalance(await getXlmBalance(w.address));
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }

  function disconnect() {
    setWallet(null);
    setBalance(null);
    setResult(null);
  }

  async function refresh() {
    if (wallet) setBalance(await getXlmBalance(wallet.address));
  }

  async function pay() {
    if (!wallet) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await sendXlm(wallet, to.trim(), amount);
      setResult(r);
      await refresh();
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Classic wallet · Level 1</h1>
        <Link href="/" className="text-xs text-white/50 underline">
          ← passport
        </Link>
      </header>

      {!wallet ? (
        <button
          onClick={connect}
          disabled={busy}
          className="rounded-full bg-stellar px-6 py-3 font-semibold text-ink active:scale-95 disabled:opacity-60"
        >
          {busy ? 'Connecting…' : 'Connect Freighter'}
        </button>
      ) : (
        <>
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-white/50">connected</p>
                <p className="font-mono text-sm">{shortAddr(wallet.address)}</p>
              </div>
              <button onClick={disconnect} className="rounded bg-white/10 px-3 py-1 text-xs">
                Disconnect
              </button>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-sm">
                Balance:{' '}
                <span className="font-semibold text-stellar">
                  {balance ? `${Number(balance).toFixed(2)} XLM` : '…'}
                </span>
              </span>
              <button onClick={refresh} className="text-[11px] text-white/40 underline">
                refresh
              </button>
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <h2 className="mb-3 text-sm font-semibold text-white/80">Send XLM (testnet)</h2>
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="destination address (G…)"
              className="mb-2 w-full rounded-lg bg-white/5 px-3 py-2 font-mono text-xs outline-none ring-1 ring-white/10 focus:ring-stellar"
            />
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="amount"
              className="mb-3 w-full rounded-lg bg-white/5 px-3 py-2 text-sm outline-none ring-1 ring-white/10 focus:ring-stellar"
            />
            <button
              onClick={pay}
              disabled={busy || !validAddr || !validAmount}
              className="w-full rounded-full bg-stellar py-2.5 text-sm font-semibold text-ink active:scale-95 disabled:opacity-50"
            >
              {busy ? 'Sending…' : 'Send'}
            </button>

            {result && (
              <div
                className={`mt-3 rounded-lg p-3 text-xs ${
                  result.status === 'SUCCESS'
                    ? 'bg-green-500/10 text-green-300 ring-1 ring-green-500/30'
                    : result.status === 'FAILED'
                      ? 'bg-red-500/10 text-red-300 ring-1 ring-red-500/30'
                      : 'bg-white/5 text-white/60'
                }`}
              >
                <p className="font-semibold">
                  {result.status === 'SUCCESS'
                    ? '✓ Payment confirmed'
                    : result.status === 'FAILED'
                      ? '✗ Payment failed'
                      : '… Submitted (pending)'}
                </p>
                <a
                  href={txExplorerUrl(result.hash)}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all underline"
                >
                  {result.hash}
                </a>
              </div>
            )}
          </section>
        </>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
    </main>
  );
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : 'something went wrong';
}
