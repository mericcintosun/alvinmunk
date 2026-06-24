import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Logo } from '@/components/brand/logo';
import { asset } from '@/lib/assets';

const COLS = [
  {
    title: 'PRODUCT',
    links: [
      { href: '/app', label: 'App' },
      { href: '/leaderboard', label: 'Leaderboard' },
      { href: '/how-it-works', label: 'How it works' },
    ],
  },
  {
    title: 'LEARN',
    links: [
      { href: '/how-it-works', label: 'How it works' },
      { href: '/how-it-works#anti-sybil', label: 'Anti-sybil' },
    ],
  },
  {
    title: 'COMMUNITY',
    links: [
      { href: 'https://github.com/mericcintosun/alvinmunk', label: 'GitHub' },
      { href: 'https://x.com', label: 'X / Twitter' },
    ],
  },
];

// Passport machine-readable zone — a real-document flourish, brand voice encoded.
const MRZ1 = 'P<STELLAR<PASSPORT<<COLLECT<PEOPLE<NOT<POINTS<<<<<<<<<<<<<<<<<<<<<<';
const MRZ2 = 'STELLAR<<TESTNET<<<2026<<<PROOF<OF<PEOPLE<<REPUTATION<HAS<A<FACE<<0';

export function Footer() {
  return (
    <footer className="relative mt-28 border-t border-border/60">
      {/* faint sticker-tile texture — warmth under the cosmic base, masked to stay subtle */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.04] [mask-image:linear-gradient(to_bottom,transparent,black)]"
        style={{ backgroundImage: `url(${asset('backgrounds/tile-256.png')})`, backgroundSize: '180px' }}
      />
      {/* corner crosshair markers */}
      <Plus className="pointer-events-none absolute left-3 top-3 size-3 text-border" />
      <Plus className="pointer-events-none absolute right-3 top-3 size-3 text-border" />

      <div className="container grid gap-10 py-14 md:grid-cols-[1.6fr_1fr_1fr_1fr]">
        <div className="flex flex-col gap-3">
          <Logo />
          <p className="max-w-xs text-sm text-muted-foreground text-balance">
            Reputation should name humans, not hoard points. Lit on Stellar.
          </p>
          <span className="mt-1 inline-flex w-fit items-center gap-1.5 border border-secondary/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.15em] text-secondary/80">
            <span className="size-1.5 rounded-full bg-secondary motion-safe:animate-glow-pulse" />
            live · stellar testnet
          </span>
        </div>
        {COLS.map((col) => (
          <div key={col.title} className="flex flex-col gap-3">
            <h4 className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              {col.title}
            </h4>
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

      {/* MRZ strip */}
      <div className="overflow-hidden border-t border-border/60 bg-surface/30">
        <div className="container py-3">
          <p className="truncate font-mono text-[10px] uppercase leading-relaxed tracking-[0.35em] text-muted-foreground/55">
            {MRZ1}
          </p>
          <p className="truncate font-mono text-[10px] uppercase leading-relaxed tracking-[0.35em] text-muted-foreground/55">
            {MRZ2}
          </p>
        </div>
      </div>

      <div className="container flex flex-col items-center justify-between gap-2 border-t border-border/40 py-6 font-mono text-[11px] text-muted-foreground sm:flex-row">
        <span>© 2026 STELLAR_PASSPORT</span>
        <span>collect_people · not_points</span>
      </div>
    </footer>
  );
}
