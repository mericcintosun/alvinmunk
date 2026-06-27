'use client';

import { useState } from 'react';
import { X, Wallet as WalletIcon } from 'lucide-react';
import { connectFreighter, connectAlbedo, type Wallet } from '@/lib/wallet';
import { cn } from '@/lib/utils';

/**
 * "Connect a Wallet" modal — a light, build-safe multi-wallet picker (no heavy
 * wallet-kit dependency). Freighter + Albedo connect for real; others are listed as
 * unavailable until wired. Returns a `Wallet` to the caller, which works with any
 * provider (the same `Wallet` interface drives balance + payments).
 */
type Option = {
  id: string;
  name: string;
  blurb: string;
  tint: string;
  connect?: () => Promise<Wallet>;
};

const OPTIONS: Option[] = [
  { id: 'freighter', name: 'Freighter', blurb: 'Browser extension', tint: 'bg-primary/20 text-primary', connect: connectFreighter },
  { id: 'albedo', name: 'Albedo', blurb: 'Web wallet · no install', tint: 'bg-tertiary/20 text-tertiary', connect: connectAlbedo },
  { id: 'xbull', name: 'xBull', blurb: 'Coming soon', tint: 'bg-muted text-muted-foreground' },
  { id: 'rabet', name: 'Rabet', blurb: 'Coming soon', tint: 'bg-muted text-muted-foreground' },
];

export function ConnectWalletModal({
  open,
  onClose,
  onConnected,
}: {
  open: boolean;
  onClose: () => void;
  onConnected: (w: Wallet) => void;
}) {
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function pick(opt: Option) {
    if (!opt.connect) return;
    setError(null);
    setConnecting(opt.id);
    try {
      const w = await opt.connect();
      onConnected(w);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not connect — try again.');
    } finally {
      setConnecting(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Connect a wallet"
      onClick={onClose}
    >
      <div
        className="grid w-full max-w-2xl overflow-hidden rounded-3xl border border-border/70 bg-card shadow-2xl md:grid-cols-2"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Learn more */}
        <div className="hidden flex-col gap-6 border-r border-border/60 bg-surface/40 p-7 md:flex">
          <h3 className="text-lg font-semibold">Learn more</h3>
          <div>
            <p className="text-sm font-medium">What is a wallet?</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Wallets are used to send, receive, and store the keys you use to sign blockchain
              transactions.
            </p>
          </div>
          <div>
            <p className="text-sm font-medium">What is Stellar?</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Stellar is a fast, low-cost public blockchain for payments and assets.
            </p>
          </div>
        </div>

        {/* Wallet list */}
        <div className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Connect a Wallet</h2>
            <button
              onClick={onClose}
              aria-label="Close"
              className="rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-5" />
            </button>
          </div>

          <ul className="flex flex-col gap-1.5">
            {OPTIONS.map((opt) => {
              const enabled = Boolean(opt.connect);
              const busy = connecting === opt.id;
              return (
                <li key={opt.id}>
                  <button
                    disabled={!enabled || busy}
                    onClick={() => pick(opt)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-2xl border border-transparent px-3 py-3 text-left transition-colors',
                      enabled ? 'hover:border-border/70 hover:bg-surface/60' : 'cursor-not-allowed opacity-60',
                    )}
                  >
                    <span className={cn('flex size-9 items-center justify-center rounded-full', opt.tint)}>
                      <WalletIcon className="size-4" />
                    </span>
                    <span className="flex-1">
                      <span className="block text-sm font-medium">{opt.name}</span>
                      <span className="block text-xs text-muted-foreground">{opt.blurb}</span>
                    </span>
                    {busy ? (
                      <span className="text-xs text-muted-foreground">Connecting…</span>
                    ) : !enabled ? (
                      <span className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
                        Not available
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>

          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

          <p className="mt-4 text-center text-[11px] text-muted-foreground">
            Testnet only · your keys never leave your wallet.
          </p>
        </div>
      </div>
    </div>
  );
}
