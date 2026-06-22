import Link from 'next/link';
import { ArrowRight, Sparkles, ShieldCheck, Coins, Globe } from 'lucide-react';
import { Crest } from '@/components/brand/crest';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const SAMPLE = [
  'GABCXOXOXOXOXOXOXOXOXOXOXOXOXOXOXOXOXOXOXOXOXOXOXOXAYSE',
  'GMEHMETXOXOXOXOXOXOXOXOXOXOXOXOXOXOXOXOXOXOXOXOXOXOXMET',
  'GDENIZXOXOXOXOXOXOXOXOXOXOXOXOXOXOXOXOXOXOXOXOXOXOXDENIZ',
  'GLEYLAXOXOXOXOXOXOXOXOXOXOXOXOXOXOXOXOXOXOXOXOXOXOXLEYLA',
  'GKEREMXOXOXOXOXOXOXOXOXOXOXOXOXOXOXOXOXOXOXOXOXOXOXKEREM',
];

export default function LandingPage() {
  return (
    <div className="overflow-x-hidden">
      {/* ───────────── Hero ───────────── */}
      <section className="container grid items-center gap-12 py-16 md:grid-cols-2 md:py-28">
        <div className="flex flex-col items-start gap-6 animate-fade-up">
          <Badge variant="primary">Proof-of-people on Stellar</Badge>
          <h1 className="text-4xl font-semibold leading-[1.05] text-balance sm:text-5xl md:text-6xl">
            Collect people,
            <br />
            not points.
          </h1>
          <p className="max-w-md text-lg text-muted-foreground text-balance">
            Someone you trust vouches for you — and it becomes a star in your constellation.
            The more people back you, the brighter you shine.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/app" className={cn(buttonVariants({ size: 'lg' }))}>
              Open the app <ArrowRight className="size-4" />
            </Link>
            <Link href="/how-it-works" className={cn(buttonVariants({ variant: 'outline', size: 'lg' }))}>
              See how it works
            </Link>
          </div>
          <p className="text-xs text-muted-foreground">
            No seed phrase · fees sponsored on testnet · live on Stellar
          </p>
        </div>

        <div className="relative flex items-center justify-center">
          <div className="absolute size-72 rounded-full bg-primary/10 blur-3xl" aria-hidden />
          <Crest
            address="stellar-passport-hero-constellation"
            size={300}
            points={9}
            animate
            className="relative"
          />
        </div>
      </section>

      {/* ───────────── How it works ───────────── */}
      <section className="container py-16">
        <h2 className="mb-10 text-center text-3xl font-semibold">How it works</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { n: '01', t: 'Vouch', d: 'Pick someone you trust, add one line — why. You light a star for them.' },
            { n: '02', t: 'Claim', d: 'They open your link, connect, and claim their half. Two halves become one card.' },
            { n: '03', t: 'Constellation', d: 'Every vouch adds a star. Your passport grows with your people.' },
          ].map((s) => (
            <Card key={s.n}>
              <CardContent className="flex flex-col gap-2 p-6">
                <span className="font-mono text-sm text-primary">{s.n}</span>
                <h3 className="text-lg font-semibold">{s.t}</h3>
                <p className="text-sm text-muted-foreground">{s.d}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* ───────────── Why different ───────────── */}
      <section className="container py-16">
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            { icon: Sparkles, t: 'Names humans, not tasks', d: 'Every card is one person + one moment — never a faceless badge.' },
            { icon: ShieldCheck, t: 'Honest by design', d: 'Daily caps, first-pair-only, and a separate cashable track keep it real, not farmable.' },
            { icon: Coins, t: 'Spendable recognition', d: 'Earned reputation can unlock real USDC — backed, capped, and gated.' },
            { icon: Globe, t: 'Yours, on-chain', d: 'Your constellation lives on Stellar and can be read by other apps.' },
          ].map((f) => (
            <Card key={f.t}>
              <CardContent className="flex items-start gap-4 p-6">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <f.icon className="size-5" />
                </div>
                <div>
                  <h3 className="font-semibold">{f.t}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{f.d}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* ───────────── Leaderboard peek ───────────── */}
      <section className="container py-16">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-2xl font-semibold">The most-connected</h2>
          <Link href="/leaderboard" className="text-sm text-primary hover:underline">
            See the night sky →
          </Link>
        </div>
        <div className="flex flex-wrap justify-center gap-6">
          {SAMPLE.map((addr, i) => (
            <div key={addr} className="flex flex-col items-center gap-2">
              <Crest address={addr} size={64} points={i + 4} />
              <span className="text-xs text-muted-foreground">★ {(SAMPLE.length - i) * 4}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ───────────── Dev teaser ───────────── */}
      <section className="container py-16">
        <Card className="nebula overflow-hidden">
          <CardContent className="grid items-center gap-6 p-8 md:grid-cols-2">
            <div>
              <Badge variant="onchain" className="mb-3">For developers</Badge>
              <h2 className="text-2xl font-semibold">Reputation other apps can read.</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                One call returns a wallet&apos;s score. Build allowlists, gates, and trust
                signals on a primitive that&apos;s on-chain and open.
              </p>
              <Link href="/how-it-works#devs" className="mt-4 inline-flex text-sm text-primary hover:underline">
                Read the docs →
              </Link>
            </div>
            <pre className="overflow-x-auto rounded-xl border border-border bg-background/60 p-4 font-mono text-xs text-foreground/80">
{`const score = await getScore(address);
// → 42`}
            </pre>
          </CardContent>
        </Card>
      </section>

      {/* ───────────── Final CTA ───────────── */}
      <section className="container py-20 text-center">
        <h2 className="text-3xl font-semibold text-balance sm:text-4xl">
          Someone&apos;s waiting to be recognized.
        </h2>
        <Link href="/app" className={cn(buttonVariants({ size: 'lg' }), 'mt-6')}>
          Open the app <ArrowRight className="size-4" />
        </Link>
      </section>
    </div>
  );
}
