'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { Logo } from '@/components/brand/logo';
import { ConnectButton } from '@/components/wallet/connect-button';
import { ThemeToggle } from '@/components/theme-toggle';
import { useTranslations } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export function Navbar() {
  const t = useTranslations();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  const LINKS = [
    { href: '/how-it-works', label: t('nav.howItWorks') },
    { href: '/leaderboard', label: t('nav.leaderboard') },
    { href: '/stats', label: t('nav.stats') },
    { href: '/wallet', label: t('nav.wallet') },
  ];

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Back/forward navigation never taps a link inside the panel, so any route change
  // closes it too.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const closePanel = () => setOpen(false);

  return (
    <header
      className={cn(
        'sticky top-0 z-40 backdrop-blur-xl transition-colors duration-300',
        scrolled ? 'border-b border-border/70 bg-background/80' : 'border-b border-transparent bg-background/30',
      )}
    >
      <nav className="container flex h-16 items-center justify-between gap-4">
        <Logo />

        <div className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => {
            const active = pathname === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? 'page' : undefined}
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
          <ThemeToggle />
          <div className="hidden md:block">
            <ConnectButton />
          </div>
          <button
            className="inline-flex size-10 items-center justify-center rounded-full text-foreground md:hidden"
            aria-label={open ? t('nav.closeMenu') : t('nav.openMenu')}
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </nav>

      {open && (
        <div id="mobile-nav" className="border-t border-border/60 bg-background/95 md:hidden">
          <div className="container flex flex-col gap-1 py-4">
            {LINKS.map((l) => {
              const active = pathname === l.href;
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={active ? 'page' : undefined}
                  onClick={closePanel}
                  className="rounded-xl px-4 py-3 text-sm text-foreground/90 hover:bg-muted"
                >
                  {l.label}
                </Link>
              );
            })}
            {/* Close only when a link inside is followed: a wrapper that closed on any click
                would unmount the account menu the moment its chip is tapped. */}
            <div className="px-2 pt-2">
              <ConnectButton onNavigate={closePanel} />
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
