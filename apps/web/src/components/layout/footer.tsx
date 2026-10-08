'use client';

import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { Logo } from '@/components/brand/logo';
import { NetworkBadge } from '@/components/layout/network-badge';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { useTranslations } from '@/lib/i18n';
import { asset } from '@/lib/assets';
import { feedbackFormLink } from '@/lib/feedback';

/** The canonical repo (the `upstream` remote): the docs, CONTRIBUTING and SECURITY links
 *  are files in it, so they are built from one base instead of five literals. */
const REPO_URL = 'https://github.com/mericcintosun/alvinmunk';

/** An outbound link opens in a new tab and says so; a same-origin one routes with `<Link>`. */
const isExternal = (href: string) => href.startsWith('http');

const LINK_CLASS =
  'inline-flex items-center gap-1 text-sm text-foreground/70 transition-colors hover:text-foreground';

export function Footer() {
  const t = useTranslations();
  const feedback = feedbackFormLink(); // null → no form configured, no link (#287)

  const COLS = [
    {
      title: t('footer.col.product'),
      links: [
        { href: '/app', label: t('footer.link.openApp') },
        { href: '/leaderboard', label: t('footer.link.leaderboard') },
        { href: '/stats', label: t('footer.link.stats') },
        { href: '/how-it-works', label: t('footer.link.howItWorks') },
      ],
    },
    {
      title: t('footer.col.learn'),
      links: [
        { href: '/how-it-works#anti-sybil', label: t('footer.link.antiSybil') },
        { href: '/wallet', label: t('footer.link.walletDemo') },
        { href: `${REPO_URL}/tree/main/docs`, label: t('footer.link.docs') },
      ],
    },
    {
      // No X/Twitter entry: the project has no profile yet (docs/GTM.md) and the link was a
      // bare placeholder, not a destination (#511). Add it back with the real handle.
      title: t('footer.col.community'),
      links: [
        { href: REPO_URL, label: t('footer.link.github') },
        { href: `${REPO_URL}/blob/main/CONTRIBUTING.md`, label: t('footer.link.contribute') },
        { href: `${REPO_URL}/blob/main/SECURITY.md`, label: t('footer.link.security') },
        ...(feedback ? [{ href: feedback, label: t('footer.link.feedback') }] : []),
      ],
    },
  ];

  return (
    <footer className="relative mt-28 border-t border-border/60 print:hidden">
      {/* faint sticker-tile texture — warmth under the cosmic base, masked to stay subtle */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.04] [mask-image:linear-gradient(to_bottom,transparent,black)]"
        style={{
          backgroundImage: `url(${asset('backgrounds/tile-256.png')})`,
          backgroundSize: '180px',
        }}
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
            {/* h2, not h4: these columns sit directly under the page's own h1, so a smaller
                number here is a skipped level. `text-sm` keeps the old visual size (#511). */}
            <h2 className="text-sm font-semibold text-foreground/90">{col.title}</h2>
            <ul className="flex flex-col gap-2">
              {col.links.map((l) =>
                isExternal(l.href) ? (
                  <li key={l.href}>
                    <a
                      href={l.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={t('footer.link.external', { label: l.label })}
                      className={LINK_CLASS}
                    >
                      {l.label}
                      <ExternalLink className="size-3.5 shrink-0 opacity-70" aria-hidden />
                    </a>
                  </li>
                ) : (
                  <li key={l.href}>
                    <Link href={l.href} className={LINK_CLASS}>
                      {l.label}
                    </Link>
                  </li>
                ),
              )}
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
