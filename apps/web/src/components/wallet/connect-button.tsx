'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { User, Copy, LogOut, ChevronDown } from 'lucide-react';
import { useWallet } from './wallet-provider';
import { Crest } from '@/components/brand/crest';
import { buttonVariants } from '@/components/ui/button';
import { cn, shortAddress } from '@/lib/utils';

/**
 * Navbar identity. No profile → a primary "Open app" CTA (onboarding lives in /app).
 * Connected → a crest+handle chip that opens an account menu (View profile, Copy
 * address, Disconnect) — the disconnect path that was previously missing.
 */
export function ConnectButton() {
  const { profile, balance, disconnect } = useWallet();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  if (!profile) {
    return (
      <Link href="/app" className={cn(buttonVariants({ size: 'sm' }))}>
        Open app
      </Link>
    );
  }

  const item =
    'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-muted [&_svg]:size-4';

  async function copyAddress() {
    await navigator.clipboard.writeText(profile!.address);
    toast.success('Address copied');
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 py-1 pl-1 pr-2.5 transition-colors hover:bg-muted"
      >
        <Crest address={profile.address} handle={profile.handle} size={28} points={5} />
        <span className="text-sm font-medium">@{profile.handle}</span>
        <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-60 rounded-xl border border-border bg-popover p-1.5 shadow-card"
        >
          <div className="px-3 py-2">
            <p className="font-mono text-xs text-muted-foreground">{shortAddress(profile.address)}</p>
            {balance != null && (
              <p className="mt-0.5 text-xs text-muted-foreground">{Number(balance).toFixed(1)} XLM</p>
            )}
          </div>
          <div className="my-1 h-px bg-border" />
          <Link href={`/u/${profile.handle}`} role="menuitem" onClick={() => setOpen(false)} className={item}>
            <User /> View profile
          </Link>
          <button role="menuitem" onClick={copyAddress} className={item}>
            <Copy /> Copy address
          </button>
          <div className="my-1 h-px bg-border" />
          <button
            role="menuitem"
            onClick={() => {
              disconnect();
              setOpen(false);
              toast('Disconnected — your profile stays on-chain.');
            }}
            className={cn(item, 'text-destructive hover:bg-destructive/10')}
          >
            <LogOut /> Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
