import type { Metadata } from 'next';
import Link from 'next/link';
import { Frame } from '@/components/fx/frame';
import { Stamp } from '@/components/fx/stamp';
import { LoopScroll } from '@/components/fx/loop-scroll';
import { BorderBeam } from '@/components/fx/border-beam';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'How it works',
  description: 'The vouch loop, the two-track model, and our honest anti-sybil design.',
};

const LIMITS = [
  { id: 'LIM-01', t: 'First-pair-only', d: 'A repeated A→B vouch mints the card but grants 0 extra XP — no back-and-forth pumping.' },
  { id: 'LIM-02', t: 'Daily cap', d: 'A wallet can only mint so many vouches per day (on-chain counter).' },
  { id: 'LIM-03', t: 'Two-track split', d: 'Vouches earn clout, not cash. Only verified quests touch the treasury.' },
  { id: 'LIM-04', t: 'Ring detection', d: 'Reciprocal rings (A↔B) are flagged off-chain and can be frozen.' },
  { id: 'LIM-05', t: 'Circuit breaker', d: 'A per-reward amount + a global daily cap bound every payout.' },
  { id: 'LIM-06', t: 'Proof-of-funding', d: 'On mainnet, a wallet must have received external value before it can cash out.' },
];

export default function HowItWorks() {
  return (
    <div className="container max-w-5xl py-16">
      {/* header */}
      <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-primary/80">{'// the_machine'}</p>
      <h1 className="display-hero mt-4 font-display text-5xl font-semibold tracking-tight sm:text-6xl">
        How it works
      </h1>
      <p className="mt-5 max-w-xl text-lg text-muted-foreground text-balance">
        Stellar Passport turns trust into something you can see — and other apps can read.
        Here&apos;s the whole machine, including the limits.
      </p>

      {/* the loop — scrollytelling */}
      <section className="mt-16">
        <div className="flex items-end justify-between border-b border-border/60 pb-3">
          <h2 className="font-display text-3xl font-semibold tracking-tight">The vouch loop</h2>
          <span className="font-mono text-xs text-muted-foreground">scroll ↓</span>
        </div>
        <div className="mt-8">
          <LoopScroll />
        </div>
      </section>

      {/* two tracks */}
      <section className="mt-20">
        <h2 className="border-b border-border/60 pb-3 font-display text-3xl font-semibold tracking-tight">
          Two kinds of XP
        </h2>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <Frame label="track // social" index="A" tilt>
            <div className="p-7">
              <Stamp accent="primary">CLOUT · NOT CASH</Stamp>
              <h3 className="mt-4 text-xl font-semibold">Social XP</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Earned from vouches. Powers your rank, leaderboard, and clout. It is{' '}
                <strong className="text-foreground">never cashable</strong> — and that&apos;s on purpose.
              </p>
            </div>
          </Frame>
          <Frame label="track // earned" index="B" accent="secondary" tilt>
            <div className="p-7">
              <Stamp accent="secondary">UNLOCKS USDC</Stamp>
              <h3 className="mt-4 text-xl font-semibold">Earned XP</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Earned only from attester-verified quests. It is the{' '}
                <strong className="text-foreground">only track</strong> that can unlock USDC rewards.
              </p>
            </div>
          </Frame>
        </div>
      </section>

      {/* anti-sybil — passport data page */}
      <section id="anti-sybil" className="mt-20 scroll-mt-24">
        <h2 className="border-b border-border/60 pb-3 font-display text-3xl font-semibold tracking-tight">
          Anti-sybil, honestly
        </h2>
        <p className="mt-3 text-sm text-muted-foreground">
          We&apos;d rather show you the limits than pretend they don&apos;t exist.
        </p>
        <Frame label="constraints // enforced" index="06" className="mt-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {LIMITS.map((l, i) => (
              <div
                key={l.id}
                className={cn(
                  'border-border/50 p-6',
                  i % 3 !== 2 && 'lg:border-r',
                  i % 2 === 0 && 'sm:border-r lg:border-r',
                  i >= 1 && 'border-t sm:[&:nth-child(2)]:border-t-0 lg:[&:nth-child(3)]:border-t-0',
                )}
              >
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary/60">{l.id}</span>
                <h3 className="mt-3 font-semibold">{l.t}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{l.d}</p>
              </div>
            ))}
          </div>
        </Frame>
      </section>

      {/* devs — terminal */}
      <section id="devs" className="mt-20 scroll-mt-24">
        <h2 className="border-b border-border/60 pb-3 font-display text-3xl font-semibold tracking-tight">
          For developers
        </h2>
        <p className="mt-3 text-sm text-muted-foreground">
          Passport emits a canonical attestation primitive. Any app can read a wallet&apos;s
          reputation with one call.
        </p>
        <div className="mt-6 border border-border/70 bg-background/70">
          <div className="flex items-center gap-1.5 border-b border-border/60 px-3 py-2">
            <span className="size-2.5 rounded-full bg-destructive/70" />
            <span className="size-2.5 rounded-full bg-warning/70" />
            <span className="size-2.5 rounded-full bg-secondary/70" />
            <span className="ml-2 font-mono text-[10px] text-muted-foreground">read-reputation.ts</span>
          </div>
          <pre className="overflow-x-auto p-5 font-mono text-xs leading-relaxed text-foreground/80">
{`// read a Social score (non-cashable)
const score = await getScore(address);   // → 42
// read the cashable Earned track
const earned = await getEarned(address); // → 30`}
          </pre>
        </div>
      </section>

      <div className="mt-16 flex justify-center">
        <span className="relative inline-flex overflow-hidden rounded-full">
          <Link href="/app" className={cn(buttonVariants({ variant: 'flow', size: 'lg' }))}>
            Open the app
          </Link>
          <BorderBeam size={60} duration={6} colorTo="hsl(var(--tertiary))" />
        </span>
      </div>
    </div>
  );
}
