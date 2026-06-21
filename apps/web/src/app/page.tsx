'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getWallet, isPasskeyConfigured, type Wallet } from '@/lib/wallet';
import { getXlmBalance, txExplorerUrl } from '@/lib/stellar';
import { recordGenesis } from '@/lib/genesis';
import { loadProfile, saveProfile, normalizeHandle, type Profile } from '@/lib/profile';
import { GenesisStamp } from '@/components/GenesisStamp';
import { VouchCompose } from '@/components/VouchCompose';

type Step = 'connect' | 'handle' | 'genesis' | 'done';

export default function Home() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [step, setStep] = useState<Step>('connect');
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [handle, setHandle] = useState('');
  const [balance, setBalance] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Returning user: skip onboarding.
  useEffect(() => {
    const p = loadProfile();
    if (p) {
      setProfile(p);
      setStep('done');
      getXlmBalance(p.address).then(setBalance);
    }
  }, []);

  async function onConnect() {
    setError(null);
    setBusy(true);
    try {
      const w = await getWallet();
      setWallet(w);
      setBalance(await getXlmBalance(w.address));
      setStep('handle');
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }

  async function onGenesis() {
    if (!wallet) return;
    const h = normalizeHandle(handle);
    if (h.length < 3) {
      setError('Pick a handle (3+ letters/numbers).');
      return;
    }
    setError(null);
    setBusy(true);
    setStep('genesis');
    const t0 = Date.now();
    try {
      const tx = await recordGenesis(wallet, h);
      const p: Profile = {
        handle: h,
        address: wallet.address,
        createdAt: Date.now(),
        genesisTx: tx,
      };
      saveProfile(p);
      setProfile(p);
      setElapsed((Date.now() - t0) / 1000);
      setBalance(await getXlmBalance(wallet.address));
      setStep('done');
    } catch (e) {
      setError(msg(e));
      setStep('handle');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 p-6">
      <header className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">
          Stellar <span className="text-stellar">Passport</span>
        </h1>
        <p className="mt-2 text-sm text-white/60">Collect people, not points.</p>
      </header>

      {/* The hero artifact */}
      {profile ? (
        <GenesisStamp
          address={profile.address}
          handle={profile.handle}
          joinedAt={profile.createdAt}
        />
      ) : (
        <div className="flex aspect-[1.6/1] w-full items-center justify-center rounded-2xl border border-dashed border-white/15 text-sm text-white/30">
          Your first stamp lands here
        </div>
      )}

      {/* Step machine */}
      {step === 'connect' && (
        <div className="flex flex-col items-center gap-2">
          <button
            onClick={onConnect}
            disabled={busy}
            className="rounded-full bg-stellar px-6 py-3 font-semibold text-ink active:scale-95 disabled:opacity-60"
          >
            {busy ? 'Connecting…' : 'Continue with Face ID'}
          </button>
          {!isPasskeyConfigured() && (
            <p className="text-[11px] text-white/30">dev wallet (testnet) — passkey infra not set</p>
          )}
        </div>
      )}

      {step === 'handle' && (
        <div className="flex w-full flex-col items-center gap-3">
          <p className="text-xs text-white/50">
            funded: {balance ? `${Number(balance).toFixed(1)} XLM` : '…'} ·{' '}
            {wallet?.address.slice(0, 6)}…
          </p>
          <input
            autoFocus
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="pick a handle"
            className="w-full rounded-xl bg-white/5 px-4 py-3 text-center outline-none ring-1 ring-white/10 focus:ring-stellar"
          />
          <button
            onClick={onGenesis}
            disabled={busy}
            className="rounded-full bg-stellar px-6 py-3 font-semibold text-ink active:scale-95 disabled:opacity-60"
          >
            Mint my Genesis Stamp
          </button>
        </div>
      )}

      {step === 'genesis' && (
        <p className="animate-pulse text-sm text-white/60">Going on-chain…</p>
      )}

      {step === 'done' && profile && (
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="text-sm text-white/70">
            You’re on-chain ✨ {elapsed != null && <span>in {elapsed.toFixed(1)}s</span>}
          </p>
          <p className="text-[11px] text-white/40">Fees paid by app: $0.00</p>
          {profile.genesisTx && (
            <a
              href={txExplorerUrl(profile.genesisTx)}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-sigil underline"
            >
              view your first transaction →
            </a>
          )}
        </div>
      )}

      {/* Yellow belt: the vouch loop, available once you have a passport */}
      {step === 'done' && profile && (
        <>
          <VouchCompose />
          <Link href="/leaderboard" className="text-xs text-white/50 underline">
            see who’s most connected →
          </Link>
        </>
      )}

      {error && <p className="max-w-xs text-center text-xs text-red-400">{error}</p>}

      <footer className="mt-4 text-center text-[11px] text-white/30">
        Yellow belt · vouch loop live · belts/02-yellow-belt.md
      </footer>
    </main>
  );
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : 'something went wrong';
}
