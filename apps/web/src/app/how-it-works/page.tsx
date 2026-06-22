import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'How it works',
  description: 'The vouch loop, the two-track model, and our honest anti-sybil design.',
};

export default function HowItWorks() {
  return (
    <div className="container max-w-3xl py-16">
      <h1 className="text-4xl font-semibold">How it works</h1>
      <p className="mt-3 text-lg text-muted-foreground text-balance">
        Stellar Passport turns trust into something you can see — and other apps can read.
        Here&apos;s the whole machine, including the limits.
      </p>

      {/* The loop */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold">The vouch loop</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {[
            ['Vouch', 'You pick someone you trust and add one line. No address needed — you get a share link.'],
            ['Claim', 'They open the link, connect, and claim their half. Both sides earn Social XP (first pair only).'],
            ['Constellation', 'Each new connection lights a star. Your passport grows with your people.'],
          ].map(([t, d]) => (
            <Card key={t}>
              <CardContent className="p-5">
                <h3 className="font-semibold">{t}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{d}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Two tracks */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold">Two kinds of XP</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Card>
            <CardContent className="p-5">
              <Badge variant="primary" className="mb-2">Social XP</Badge>
              <p className="text-sm text-muted-foreground">
                Earned from vouches. Powers your rank, leaderboard, and clout. It is{' '}
                <strong className="text-foreground">never cashable</strong> — and that&apos;s on purpose.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <Badge variant="onchain" className="mb-2">Earned XP</Badge>
              <p className="text-sm text-muted-foreground">
                Earned only from attester-verified quests. It is the{' '}
                <strong className="text-foreground">only track</strong> that can unlock USDC rewards.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Anti-sybil */}
      <section id="anti-sybil" className="mt-12 scroll-mt-24">
        <h2 className="text-2xl font-semibold">Anti-sybil, honestly</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          We&apos;d rather show you the limits than pretend they don&apos;t exist.
        </p>
        <ul className="mt-4 grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
          {[
            ['First-pair-only', 'A repeated A→B vouch mints the card but grants 0 extra XP — no back-and-forth pumping.'],
            ['Daily cap', 'A wallet can only mint so many vouches per day.'],
            ['Two-track split', 'Vouches earn clout, not cash. Only verified quests touch the treasury.'],
            ['Ring detection', 'Reciprocal rings (A↔B) are flagged off-chain and can be frozen.'],
            ['Treasury circuit breaker', 'A per-reward amount + a global daily cap bound every payout.'],
            ['Proof-of-funding', 'On mainnet, a wallet must have received external value before it can cash out.'],
          ].map(([t, d]) => (
            <li key={t} className="rounded-xl border border-border bg-card/40 p-4">
              <span className="font-medium text-foreground">{t}.</span> {d}
            </li>
          ))}
        </ul>
      </section>

      {/* For devs */}
      <section id="devs" className="mt-12 scroll-mt-24">
        <h2 className="text-2xl font-semibold">For developers</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Passport emits a canonical attestation primitive. Any app can read a wallet&apos;s
          reputation with one call.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-xl border border-border bg-card/60 p-4 font-mono text-xs text-foreground/80">
{`// read a Social score (non-cashable)
const score = await getScore(address);   // → 42
// read the cashable Earned track
const earned = await getEarned(address); // → 30`}
        </pre>
      </section>

      <div className="mt-12 flex justify-center">
        <Link href="/app" className={cn(buttonVariants({ size: 'lg' }))}>
          Open the app
        </Link>
      </div>
    </div>
  );
}
