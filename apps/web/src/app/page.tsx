import Link from 'next/link';
import { ArrowRight, Sparkles, ShieldCheck, Coins, Globe, Plus } from 'lucide-react';
import { Crest } from '@/components/brand/crest';
import { HeroBackdrop } from '@/components/brand/hero-backdrop';
import { Reveal } from '@/components/motion/reveal';
import { Frame } from '@/components/fx/frame';
import { Stamp } from '@/components/fx/stamp';
import { BorderBeam } from '@/components/fx/border-beam';
import { NumberTicker } from '@/components/fx/number-ticker';
import { AuroraText } from '@/components/fx/shiny-text';
import { Meteors } from '@/components/fx/meteors';
import { Sticker } from '@/components/ui/sticker';
import { buttonVariants } from '@/components/ui/button';
import { asset, BRAND, type StickerName } from '@/lib/assets';
import { cn } from '@/lib/utils';

// Small sticker icons cycle through the live vouch ticker — heart=vouch, coin=tip, eye=seen.
const TICKER_ICONS: StickerName[] = ['ticker-heart', 'ticker-coin', 'ticker-eye'];
// One playful sticker per "how it works" step.
const STEP_STICKERS: StickerName[] = ['hand-open', 'hand-shake', 'star-lime'];

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

const STATS = [
  { code: 'CONTRACTS', v: 3, label: 'Soroban, on-chain' },
  { code: 'XP_TRACKS', v: 2, label: 'clout vs cashable' },
  { code: 'STAKE_WIN', v: 7, suffix: 'd', label: 'vouch window' },
];

const STEPS = [
  { n: '01', t: 'Vouch', tag: 'mint · 1 line', d: 'Pick someone you trust, add one line — why. You light a star for them.' },
  { n: '02', t: 'Claim', tag: 'one tap · sponsored', d: 'They open your link, connect in a tap, and claim their half. Two halves become one card.' },
  { n: '03', t: 'Constellation', tag: 'on-chain · forever', d: 'Every vouch adds a star. Your passport grows with the people who back you.' },
];

const FEATURES = [
  { id: 'F-01', icon: Sparkles, sticker: 'social-seen' as StickerName, title: 'Names humans, not tasks', body: 'Every card is one person and one moment — never a faceless badge or a points counter. Your reputation has a face.', span: 'md:col-span-2', stamp: 'NO POINTS' },
  { id: 'F-02', icon: ShieldCheck, sticker: 'hand-crossed' as StickerName, title: 'Honest by design', body: 'Daily caps, first-pair-only, and a separate cashable track keep it real — not farmable.' },
  { id: 'F-03', icon: Coins, sticker: 'ticker-coin' as StickerName, title: 'Spendable recognition', body: 'Earned reputation unlocks real USDC — backed, capped, gated.' },
  { id: 'F-04', icon: Globe, sticker: 'social-eye' as StickerName, title: 'Yours, on-chain — readable by any app', body: 'Your constellation lives on Stellar. The reputation primitive can be read by any app in one call.', span: 'md:col-span-2' },
];

export default function LandingPage() {
  return (
    <div className="overflow-x-hidden">
      {/* ───────────── Hero ───────────── */}
      <section className="brand-cursor relative isolate overflow-hidden">
        <HeroBackdrop className="absolute inset-0 -z-10" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-background via-background/75 to-transparent" aria-hidden />
        <div className="absolute inset-x-0 bottom-0 -z-10 h-40 bg-gradient-to-t from-background to-transparent" aria-hidden />

        {/* The passport centerpiece — a warm, physical object beside the cosmic field (md+). */}
        <img
          src={asset(BRAND.centerpiece.file)}
          alt=""
          aria-hidden
          width={460}
          height={459}
          draggable={false}
          className="pointer-events-none absolute -right-10 top-1/2 hidden -translate-y-1/2 select-none opacity-90 motion-safe:animate-float lg:block xl:right-6"
        />

        <div className="container py-28 md:py-40">
          <div className="max-w-2xl">
            <Reveal>
              <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.28em] text-primary/80">
                <Plus className="size-3" />
                proof-of-people · stellar
              </p>
            </Reveal>
            <Reveal delay={0.05}>
              <h1 className="display-hero mt-6 font-display font-semibold text-balance">
                Collect people,
                <br />
                <AuroraText>not points.</AuroraText>
              </h1>
            </Reveal>
            <Reveal delay={0.12}>
              <p className="mt-6 max-w-md text-lg text-muted-foreground text-balance">
                Someone you trust vouches for you — and it becomes a star in your
                constellation. The more people back you, the brighter you shine.
              </p>
            </Reveal>
            <Reveal delay={0.18}>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <span className="relative inline-flex overflow-hidden rounded-full">
                  <Link href="/app" className={cn(buttonVariants({ variant: 'flow', size: 'lg' }))}>
                    Open the app <ArrowRight className="size-4" />
                  </Link>
                  <BorderBeam size={60} duration={6} colorTo="hsl(var(--tertiary))" />
                </span>
                <Link href="/how-it-works" className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'glass')}>
                  See how it works
                </Link>
              </div>
            </Reveal>
            <Reveal delay={0.24}>
              <p className="mt-7 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <span>no_seed_phrase</span>
                <span className="text-border">/</span>
                <span>fees_sponsored</span>
                <span className="text-border">/</span>
                <span>live_on_stellar</span>
              </p>
            </Reveal>
          </div>
        </div>

        {/* Live vouch ticker (marquee) */}
        <div className="border-y border-border/50 bg-card/20 py-3 backdrop-blur-sm [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
          <div className="flex w-max motion-safe:animate-marquee gap-10 pr-10">
            {[...TICKER, ...TICKER].map((t, i) => (
              <span key={i} className="flex items-center gap-2 whitespace-nowrap font-mono text-xs text-muted-foreground">
                <Sticker name={TICKER_ICONS[i % TICKER_ICONS.length]} size={20} className="h-4 w-auto" />
                {t}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ───────────── Stats (passport data row) ───────────── */}
      <section className="container py-14">
        <Reveal>
          <Frame label="on-chain // facts" index="00">
            <div className="grid grid-cols-1 divide-y divide-border/60 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              {STATS.map((s) => (
                <div key={s.code} className="p-6">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{s.code}</p>
                  <p className="mt-2 font-display text-4xl font-semibold">
                    <NumberTicker value={s.v} suffix={s.suffix} />
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">{s.label}</p>
                </div>
              ))}
            </div>
          </Frame>
        </Reveal>
      </section>

      {/* ───────────── How it works (editorial numbered rows) ───────────── */}
      <section className="container py-20">
        <Reveal>
          <div className="flex items-end justify-between border-b border-border/60 pb-4">
            <h2 className="font-display text-4xl font-semibold tracking-tight">How it works</h2>
            <span className="font-mono text-xs text-muted-foreground">[ 01 — 03 ]</span>
          </div>
        </Reveal>
        <div className="divide-y divide-border/50">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 0.06}>
              <div className="group grid grid-cols-[3rem_1fr] items-baseline gap-x-6 py-8 transition-colors hover:bg-surface/30 md:grid-cols-[6rem_1fr_14rem]">
                <span className="font-mono text-lg text-primary/60 transition-colors group-hover:text-primary">{s.n}</span>
                <div>
                  <h3 className="flex items-center gap-2.5 text-2xl font-semibold">
                    {s.t}
                    <Sticker
                      name={STEP_STICKERS[i % STEP_STICKERS.length]}
                      size={34}
                      className="h-7 w-auto transition-transform group-hover:rotate-6 group-hover:scale-110"
                    />
                  </h3>
                  <p className="mt-2 max-w-lg text-muted-foreground">{s.d}</p>
                </div>
                <span className="col-start-2 mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground md:col-start-3 md:mt-0 md:self-center md:text-right">
                  {s.tag}
                </span>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ───────────── Why different (passport data page) ───────────── */}
      <section className="container py-12">
        <Reveal>
          <Frame label="why_different" index="01" tilt>
            <div className="grid grid-cols-1 md:grid-cols-2">
              {FEATURES.map((f, i) => {
                const Icon = f.icon;
                return (
                  <div
                    key={f.id}
                    className={cn(
                      'relative border-border/50 p-7',
                      f.span,
                      'border-t md:border-t',
                      i % 2 === 0 && 'md:border-r',
                      i < 2 && 'md:border-t-0',
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary/60">{f.id}</span>
                      <Sticker name={f.sticker} size={40} className="h-8 w-auto transition-transform group-hover:-rotate-6 group-hover:scale-110" />
                    </div>
                    <h3 className="mt-5 flex items-center gap-2 text-xl font-semibold">
                      <Icon className="size-4 text-muted-foreground" />
                      {f.title}
                    </h3>
                    <p className="mt-2 max-w-md text-sm text-muted-foreground">{f.body}</p>
                    {f.stamp && (
                      <div className="mt-4">
                        <Stamp accent="secondary">✦ {f.stamp}</Stamp>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Frame>
        </Reveal>
      </section>

      {/* ───────────── Leaderboard peek ───────────── */}
      <section className="container py-20">
        <Reveal>
          <div className="mb-10 flex items-end justify-between border-b border-border/60 pb-4">
            <h2 className="flex items-center gap-3 font-display text-3xl font-semibold tracking-tight">
              The most-connected
              <Sticker name="burst-new" size={52} rotate={-8} className="hidden h-9 w-auto sm:block" />
            </h2>
            <Link href="/leaderboard" className="font-mono text-xs text-primary hover:underline">
              see_the_night_sky →
            </Link>
          </div>
        </Reveal>
        <Reveal>
          <div className="flex flex-wrap justify-center gap-x-10 gap-y-8 sm:justify-start">
            {SAMPLE.map((addr, i) => (
              <div key={addr} className="group flex flex-col items-center gap-2">
                <div className="transition-transform duration-300 group-hover:-translate-y-1 group-hover:scale-105">
                  <Crest address={addr} size={72} points={i + 4} />
                </div>
                <span className="font-mono text-[10px] text-muted-foreground">★ {(SAMPLE.length - i) * 4}</span>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* ───────────── Dev teaser (terminal frame) ───────────── */}
      <section className="container py-12">
        <Reveal>
          <Frame label="// for_developers" index="02" accent="tertiary">
            <div className="grid items-center gap-8 p-8 md:grid-cols-2 md:p-10">
              <div>
                <Stamp accent="tertiary">READ-ONLY · ON-CHAIN</Stamp>
                <h2 className="mt-4 text-3xl font-semibold tracking-tight">
                  Reputation other apps can <AuroraText>read.</AuroraText>
                </h2>
                <p className="mt-3 text-muted-foreground">
                  One call returns a wallet&apos;s score. Build allowlists, gates, and trust
                  signals on a primitive that&apos;s on-chain and open.
                </p>
                <Link href="/how-it-works#devs" className="mt-5 inline-flex font-mono text-sm text-tertiary hover:underline">
                  read_the_docs →
                </Link>
              </div>
              <div className="border border-border/70 bg-background/70">
                <div className="flex items-center gap-1.5 border-b border-border/60 px-3 py-2">
                  <span className="size-2.5 rounded-full bg-destructive/70" />
                  <span className="size-2.5 rounded-full bg-warning/70" />
                  <span className="size-2.5 rounded-full bg-secondary/70" />
                  <span className="ml-2 font-mono text-[10px] text-muted-foreground">reputation.ts</span>
                </div>
                <pre className="overflow-x-auto p-5 font-mono text-sm leading-relaxed text-foreground/80">
                  <span className="text-muted-foreground">{'// read a wallet’s reputation'}</span>
                  {'\n'}
                  <span className="text-primary">const</span> score = <span className="text-primary">await</span> getScore(addr);
                  {'\n'}
                  <span className="text-secondary">{'// → 42'}</span>
                </pre>
              </div>
            </div>
          </Frame>
        </Reveal>
      </section>

      {/* ───────────── Final CTA ───────────── */}
      <section className="relative overflow-hidden py-32 text-center">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.05] [mask-image:radial-gradient(circle_at_center,black,transparent_70%)]"
          style={{ backgroundImage: `url(${asset('backgrounds/landing-hero.png')})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
        />
        <Meteors number={18} />
        <Sticker name="burst-wow" size={92} rotate={-12} className="pointer-events-none absolute left-[12%] top-16 hidden motion-safe:animate-float md:block" />
        <Sticker name="star-pop" size={70} className="pointer-events-none absolute right-[14%] bottom-20 hidden motion-safe:animate-float md:block" />
        <div className="absolute left-1/2 top-1/2 size-[30rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-3xl motion-safe:animate-glow-pulse" aria-hidden />
        <div className="container relative">
          <Reveal>
            <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.28em] text-primary/70">{'// your_turn'}</p>
            <h2 className="mx-auto max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              Someone&apos;s waiting to be <AuroraText>recognized.</AuroraText>
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <span className="relative mt-9 inline-flex overflow-hidden rounded-full">
              <Link href="/app" className={cn(buttonVariants({ variant: 'flow', size: 'lg' }))}>
                Open the app <ArrowRight className="size-4" />
              </Link>
              <BorderBeam size={60} duration={6} colorTo="hsl(var(--tertiary))" />
            </span>
          </Reveal>
        </div>
      </section>
    </div>
  );
}
