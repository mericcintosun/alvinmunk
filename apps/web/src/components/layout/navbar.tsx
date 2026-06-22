'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { Logo } from '@/components/brand/logo';
import { ConnectButton } from '@/components/wallet/connect-button';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/how-it-works', label: 'How it works' },
  { href: '/leaderboard', label: 'Leaderboard' },
];

export function Navbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <nav className="container flex h-16 items-center justify-between gap-4">
        <Logo />

        <div className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => {
            const active = pathname === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  'rounded-full px-4 py-2 text-sm transition-colors',
                  active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {l.label}
              </Link>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden md:block">
            <ConnectButton />
          </div>
          <button
            className="inline-flex size-10 items-center justify-center rounded-full text-foreground md:hidden"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </nav>

      {open && (
        <div className="border-t border-border/60 bg-background/95 md:hidden">
          <div className="container flex flex-col gap-1 py-4">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-xl px-4 py-3 text-sm text-foreground/90 hover:bg-muted"
              >
                {l.label}
              </Link>
            ))}
            <div className="px-2 pt-2" onClick={() => setOpen(false)}>
              <ConnectButton />
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
