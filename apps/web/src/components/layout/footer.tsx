import Link from 'next/link';
import { Logo } from '@/components/brand/logo';
import { Badge } from '@/components/ui/badge';

const COLS = [
  {
    title: 'Product',
    links: [
      { href: '/app', label: 'App' },
      { href: '/leaderboard', label: 'Leaderboard' },
      { href: '/wallet', label: 'Wallet' },
    ],
  },
  {
    title: 'Learn',
    links: [
      { href: '/how-it-works', label: 'How it works' },
      { href: '/how-it-works#anti-sybil', label: 'Anti-sybil' },
    ],
  },
  {
    title: 'Community',
    links: [
      { href: 'https://github.com/mericcintosun/alvinmunk', label: 'GitHub' },
      { href: 'https://x.com', label: 'X' },
    ],
  },
];

export function Footer() {
  return (
    <footer className="mt-24 border-t border-border/60">
      <div className="container grid gap-10 py-12 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <div className="flex flex-col gap-3">
          <Logo />
          <p className="max-w-xs text-sm text-muted-foreground text-balance">
            Reputation should name humans, not hoard points. Lit on Stellar.
          </p>
          <Badge variant="onchain" className="w-fit">
            Live on Stellar testnet
          </Badge>
        </div>
        {COLS.map((col) => (
          <div key={col.title} className="flex flex-col gap-3">
            <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {col.title}
            </h4>
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
      <div className="container flex flex-col items-center justify-between gap-2 border-t border-border/40 py-6 text-xs text-muted-foreground sm:flex-row">
        <span>© {new Date().getFullYear()} Stellar Passport</span>
        <span>Collect people, not points.</span>
      </div>
    </footer>
  );
}
