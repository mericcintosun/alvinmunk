'use client';

import Link from 'next/link';
import { Logo } from '@/components/brand/logo';
import { NetworkBadge } from '@/components/layout/network-badge';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { useTranslations } from '@/lib/i18n';
import { asset } from '@/lib/assets';

export function Footer() {
  const t = useTranslations();

  const COLS = [
    {
      title: t('footer.col.product'),
      links: [
        { href: '/app', label: t('footer.link.openApp') },
        { href: '/leaderboard', label: t('footer.link.leaderboard') },
        { href: '/how-it-works', label: t('footer.link.howItWorks') },
      ],
    },
    {
      title: t('footer.col.learn'),
      links: [
        { href: '/how-it-works#anti-sybil', label: t('footer.link.antiSybil') },
        { href: '/wallet', label: t('footer.link.walletDemo') },
      ],
    },
    {
      title: t('footer.col.community'),
      links: [
        { href: 'https://github.com/mericcintosun/alvinmunk', label: t('footer.link.github') },
        { href: 'https://x.com', label: t('footer.link.twitter') },
      ],
    },
  ];

  return (
    <footer className="relative mt-28 border-t border-border/60">
      {/* faint sticker-tile texture — warmth under the cosmic base, masked to stay subtle */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.04] [mask-image:linear-gradient(to_bottom,transparent,black)]"
        style={{ backgroundImage: `url(${asset('backgrounds/tile-256.png')})`, backgroundSize: '180px' }}
      />

      <div className="container grid gap-10 py-14 md:grid-cols-[1.6fr_1fr_1fr_1fr]">
        <div className="flex flex-col gap-3">
          <Logo />
          <p className="max-w-xs text-sm text-muted-foreground text-balance">
            {t('footer.tagline')}
          </p>
          {/* Which Stellar network these funds are real on — links to /api/health. It replaces a
              static "Live on Stellar testnet" pill that would have kept saying testnet on mainnet. */}
          <NetworkBadge className="mt-1" />
          {/* Language switcher lives here — prominent but not distracting */}
          <LanguageSwitcher variant="pill" className="mt-1 w-fit" />
        </div>
        {COLS.map((col) => (
          <div key={col.title} className="flex flex-col gap-3">
            <h4 className="text-sm font-semibold text-foreground/90">{col.title}</h4>
            <ul className="flex flex-col gap-2">
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="text-sm text-foreground/70 transition-colors hover:text-foreground"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="container flex flex-col items-center justify-between gap-2 border-t border-border/40 py-6 text-sm text-muted-foreground sm:flex-row">
        <span>{t('footer.copyright')}</span>
        <span>{t('footer.slogan')}</span>
      </div>
    </footer>
  );
}
