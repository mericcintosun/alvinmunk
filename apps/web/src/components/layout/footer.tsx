import Link from 'next/link';
import { Logo } from '@/components/brand/logo';
import { asset } from '@/lib/assets';

const COLS = [
  {
    title: 'Product',
    links: [
      { href: '/app', label: 'Open app' },
      { href: '/leaderboard', label: 'Leaderboard' },
      { href: '/how-it-works', label: 'How it works' },
    ],
  },
  {
    title: 'Learn',
    links: [
      { href: '/how-it-works#anti-sybil', label: 'Anti-sybil' },
      { href: '/wallet', label: 'Wallet demo' },
    ],
  },
  {
    title: 'Community',
    links: [
      { href: 'https://github.com/mericcintosun/alvinmunk', label: 'GitHub' },
      { href: 'https://x.com', label: 'X / Twitter' },
    ],
  },
];

export function Footer() {
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
            Reputation should name humans, not hoard points. Lit on Stellar.
          </p>
          <span className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-full border border-secondary/40 px-2.5 py-1 text-xs text-secondary/90">
            <span className="size-1.5 rounded-full bg-secondary motion-safe:animate-glow-pulse" />
            Live on Stellar testnet
          </span>
        </div>
        {COLS.map((col) => (
          <div key={col.title} className="flex flex-col gap-3">
            <h4 className="text-sm font-semibold text-foreground/90">{col.title}</h4>
            <ul className="flex flex-col gap-2">
              {col.links.map((l) => (
                <li key={l.label}>
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
        <span>© 2026 alvinmunk</span>
        <span>Collect people, not points.</span>
      </div>
    </footer>
  );
}
