import Link from 'next/link';
import { ArrowRight, Sparkles, ShieldCheck, Coins, Globe } from 'lucide-react';
import { Crest } from '@/components/brand/crest';
import { Reveal, Parallax } from '@/components/motion/reveal';
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

const TICKER = [
  'Ayşe lit a star for Mehmet',
  'Deniz vouched Leyla',
  'Kerem backed Selin',
  'Mert recognized Ada',
  'Zeynep vouched Can',
  'Efe lit a star for Naz',
];

export default function LandingPage() {
  return (
    <div className="overflow-x-hidden">
      {/* ───────────── Hero ───────────── */}
      <section className="relative">
        <div className="container grid items-center gap-10 py-20 md:grid-cols-[1.1fr_0.9fr] md:py-28">
          <div className="flex flex-col items-start gap-6">
            <Reveal>
              <Badge variant="primary">Proof-of-people on Stellar</Badge>
            </Reveal>
            <Reveal delay={0.05}>
              <h1 className="text-5xl font-semibold leading-[0.98] tracking-tight text-balance sm:text-6xl md:text-7xl">
                Collect people,
                <br />
                <span className="text-gradient">not points.</span>
              </h1>
            </Reveal>
            <Reveal delay={0.12}>
              <p className="max-w-md text-lg text-muted-foreground text-balance">
                Someone you trust vouches for you — and it becomes a star in your
                constellation. The more people back you, the brighter you shine.
              </p>
            </Reveal>
            <Reveal delay={0.18}>
              <div className="flex flex-wrap items-center gap-3">
                <Link href="/app" className={cn(buttonVariants({ size: 'lg' }))}>
                  Open the app <ArrowRight className="size-4" />
                </Link>
                <Link
                  href="/how-it-works"
                  className={cn(buttonVariants({ variant: 'outline', size: 'lg' }))}
                >
                  See how it works
                </Link>
              </div>
            </Reveal>
            <Reveal delay={0.24}>
              <p className="text-xs text-muted-foreground">
                No seed phrase · fees sponsored on testnet · live on Stellar
              </p>
            </Reveal>
          </div>

          {/* Floating crest with a breathing glow halo */}
          <div className="relative flex items-center justify-center">
            <div
              className="absolute size-72 rounded-full bg-primary/20 blur-3xl motion-safe:animate-glow-pulse md:size-96"
              aria-hidden
            />
            <Parallax speed={0.12} className="relative">
              <div className="motion-safe:animate-float">
                <Crest
                  address="stellar-passport-hero-constellation"
                  size={320}
                  points={9}
                  animate
                />
              </div>
            </Parallax>
          </div>
        </div>

        {/* Live vouch ticker (marquee) */}
        <div className="border-y border-border/50 bg-card/30 py-3 [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
          <div className="flex w-max motion-safe:animate-marquee gap-10 pr-10">
            {[...TICKER, ...TICKER].map((t, i) => (
              <span key={i} className="flex items-center gap-2 whitespace-nowrap text-sm text-muted-foreground">
                <Sparkles className="size-3.5 text-primary" />
                {t}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ───────────── How it works (scrollytelling steps) ───────────── */}
      <section className="container py-24">
        <Reveal>
          <h2 className="mb-14 text-center text-4xl font-semibold tracking-tight">How it works</h2>
        </Reveal>
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {[
            { n: '01', t: 'Vouch', d: 'Pick someone you trust, add one line — why. You light a star for them.' },
            { n: '02', t: 'Claim', d: 'They open your link, connect in one tap, and claim their half. Two halves become one card.' },
            { n: '03', t: 'Constellation', d: 'Every vouch adds a star. Your passport grows with the people who back you.' },
          ].map((s, i) => (
            <Reveal key={s.n} delay={i * 0.08}>
              <div className="group flex items-start gap-6 rounded-2xl border border-border/70 bg-card/40 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 hover:bg-card">
                <span className="font-display text-5xl font-semibold text-primary/30 transition-colors group-hover:text-primary/60">
                  {s.n}
                </span>
                <div className="pt-1">
                  <h3 className="text-xl font-semibold">{s.t}</h3>
                  <p className="mt-1 text-muted-foreground">{s.d}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ───────────── Why different (bento, asymmetric) ───────────── */}
      <section className="container py-12">
        <Reveal>
          <h2 className="mb-10 text-3xl font-semibold tracking-tight">Why it&apos;s different</h2>
        </Reveal>
        <div className="grid gap-4 md:grid-cols-3 md:grid-rows-2">
          <Reveal className="md:col-span-2 md:row-span-2">
            <BentoTile
              big
              icon={Sparkles}
              title="Names humans, not tasks"
              body="Every card is one person and one moment — never a faceless badge or a points counter. Your reputation has a face."
            />
          </Reveal>
          <Reveal delay={0.06}>
            <BentoTile icon={ShieldCheck} title="Honest by design" body="Daily caps, first-pair-only, and a separate cashable track keep it real — not farmable." />
          </Reveal>
          <Reveal delay={0.12}>
            <BentoTile icon={Coins} title="Spendable recognition" body="Earned reputation unlocks real USDC — backed, capped, gated." />
          </Reveal>
          <Reveal delay={0.18} className="md:col-span-3">
            <BentoTile
              wide
              icon={Globe}
              title="Yours, on-chain — and readable by other apps"
              body="Your constellation lives on Stellar. The reputation primitive can be read by any app in one call."
            />
          </Reveal>
        </div>
      </section>

      {/* ───────────── Leaderboard peek ───────────── */}
      <section className="container py-24">
        <Reveal>
          <div className="mb-10 flex items-end justify-between">
            <h2 className="text-3xl font-semibold tracking-tight">The most-connected</h2>
            <Link href="/leaderboard" className="text-sm text-primary hover:underline">
              See the night sky →
            </Link>
          </div>
        </Reveal>
        <Reveal>
          <div className="flex flex-wrap justify-center gap-x-10 gap-y-8">
            {SAMPLE.map((addr, i) => (
              <div key={addr} className="group flex flex-col items-center gap-2">
                <div className="transition-transform duration-300 group-hover:scale-110">
                  <Crest address={addr} size={72} points={i + 4} />
                </div>
                <span className="text-xs text-muted-foreground">★ {(SAMPLE.length - i) * 4}</span>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* ───────────── Dev teaser ───────────── */}
      <section className="container py-12">
        <Reveal>
          <Card className="nebula overflow-hidden border-secondary/20">
            <CardContent className="grid items-center gap-8 p-8 md:grid-cols-2 md:p-12">
              <div>
                <Badge variant="onchain" className="mb-4">For developers</Badge>
                <h2 className="text-3xl font-semibold tracking-tight">Reputation other apps can read.</h2>
                <p className="mt-3 text-muted-foreground">
                  One call returns a wallet&apos;s score. Build allowlists, gates, and trust
                  signals on a primitive that&apos;s on-chain and open.
                </p>
                <Link href="/how-it-works#devs" className="mt-5 inline-flex text-sm text-primary hover:underline">
                  Read the docs →
                </Link>
              </div>
              <pre className="overflow-x-auto rounded-xl border border-border bg-background/70 p-5 font-mono text-sm leading-relaxed text-foreground/80">
                <span className="text-muted-foreground">{'// read a wallet’s reputation'}</span>
                {'\n'}
                <span className="text-secondary">const</span> score = <span className="text-secondary">await</span> getScore(addr);
                {'\n'}
                <span className="text-primary">{'// → 42'}</span>
              </pre>
            </CardContent>
          </Card>
        </Reveal>
      </section>

      {/* ───────────── Final CTA ───────────── */}
      <section className="relative py-28 text-center">
        <div className="absolute left-1/2 top-1/2 size-[28rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-3xl motion-safe:animate-glow-pulse" aria-hidden />
        <div className="container relative">
          <Reveal>
            <h2 className="mx-auto max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              Someone&apos;s waiting to be <span className="text-gradient">recognized.</span>
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <Link href="/app" className={cn(buttonVariants({ size: 'lg' }), 'mt-8')}>
              Open the app <ArrowRight className="size-4" />
            </Link>
          </Reveal>
        </div>
      </section>
    </div>
  );
}

function BentoTile({
  icon: Icon,
  title,
  body,
  big,
  wide,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  big?: boolean;
  wide?: boolean;
}) {
  return (
    <div
      className={cn(
        'group flex h-full flex-col rounded-2xl border border-border/70 bg-card/40 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 hover:bg-card hover:shadow-card',
        big && 'justify-between md:p-8',
      )}
    >
      <div
        className={cn(
          'flex shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary/20',
          big ? 'size-14' : 'size-11',
        )}
      >
        <Icon className={big ? 'size-7' : 'size-5'} />
      </div>
      <div className={cn(big || wide ? 'mt-6' : 'mt-4')}>
        <h3 className={cn('font-semibold', big ? 'text-2xl' : 'text-lg')}>{title}</h3>
        <p className={cn('mt-2 text-muted-foreground', big ? 'max-w-md text-base' : 'text-sm')}>{body}</p>
      </div>
    </div>
  );
}
