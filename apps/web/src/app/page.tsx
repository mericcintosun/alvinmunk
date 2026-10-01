'use client';

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
import { asset, type StickerName } from '@/lib/assets';
import { cn } from '@/lib/utils';
import { LandingOnboard } from '@/components/landing-onboard';
import { useTranslations } from '@/lib/i18n';
import { ReputationSnippet } from '@/components/ReputationSnippet';

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

const STATS_META = [
  { code: 'CONTRACTS', v: 3, labelKey: 'landing.stats.onchain' },
  { code: 'XP_TRACKS', v: 2, labelKey: 'landing.stats.xpTracks' },
  { code: 'STAKE_WIN', v: 7, suffix: 'd', labelKey: 'landing.stats.stakeWin' },
];

export default function LandingPage() {
  const t = useTranslations();

  const STEPS = [
    { n: '01', tKey: 'landing.step.01.title', tagKey: 'landing.step.01.tag', dKey: 'landing.step.01.desc' },
    { n: '02', tKey: 'landing.step.02.title', tagKey: 'landing.step.02.tag', dKey: 'landing.step.02.desc' },
    { n: '03', tKey: 'landing.step.03.title', tagKey: 'landing.step.03.tag', dKey: 'landing.step.03.desc' },
  ];

  const FEATURES = [
    { id: 'F-01', icon: Sparkles, sticker: 'social-seen' as StickerName, titleKey: 'landing.features.f01.title', bodyKey: 'landing.features.f01.body', span: 'md:col-span-2', stampKey: 'landing.features.f01.stamp' },
    { id: 'F-02', icon: ShieldCheck, sticker: 'hand-crossed' as StickerName, titleKey: 'landing.features.f02.title', bodyKey: 'landing.features.f02.body' },
    { id: 'F-03', icon: Coins, sticker: 'ticker-coin' as StickerName, titleKey: 'landing.features.f03.title', bodyKey: 'landing.features.f03.body' },
    { id: 'F-04', icon: Globe, sticker: 'social-eye' as StickerName, titleKey: 'landing.features.f04.title', bodyKey: 'landing.features.f04.body', span: 'md:col-span-2' },
  ];

  return (
    <div className="overflow-x-hidden">
      {/* ───────────── Hero ───────────── */}
      <section className="brand-cursor relative isolate overflow-hidden">
        <HeroBackdrop className="absolute inset-0 -z-10" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-background via-background/75 to-transparent" aria-hidden />
        <div className="absolute inset-x-0 bottom-0 -z-10 h-40 bg-gradient-to-t from-background to-transparent" aria-hidden />

        <div className="container py-28 md:py-40">
          <div className="max-w-2xl">
            <Reveal>
              <p className="flex items-center gap-2 eyebrow-mono text-primary/80">
                <Plus className="size-3" />
                {t('landing.eyebrow')}
              </p>
            </Reveal>
            <Reveal delay={0.05}>
              <h1 className="display-hero mt-6 font-display font-semibold text-balance">
                {t('landing.hero.title1')}
                <br />
                <AuroraText>{t('landing.hero.title2')}</AuroraText>
              </h1>
            </Reveal>
            <Reveal delay={0.12}>
              <p className="mt-6 max-w-md text-lg text-muted-foreground text-balance">
                {t('landing.hero.subtitle')}
              </p>
            </Reveal>
            <Reveal delay={0.18}>
              <div className="mt-9 flex flex-col gap-3">
                {/* One-field onboarding, right here. Type a handle, tap once, you're in. */}
                <LandingOnboard />
                <Link
                  href="/how-it-works"
                  className="inline-flex w-fit items-center gap-1 pl-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {t('landing.hero.seeHowItWorks')} <ArrowRight className="size-3.5" />
                </Link>
              </div>
            </Reveal>
            <Reveal delay={0.24}>
              <p className="mt-7 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-2xs uppercase tracking-wider text-muted-foreground">
                {t('landing.hero.pills').split(' / ').map((pill, i, arr) => (
                  <span key={pill} className="contents">
                    <span>{pill}</span>
                    {i < arr.length - 1 && <span className="text-border">/</span>}
                  </span>
                ))}
              </p>
            </Reveal>
          </div>
        </div>

        {/* Live vouch ticker (marquee) */}
        <div className="border-y border-border/50 bg-card/20 py-3 backdrop-blur-sm [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
          <div className="flex w-max motion-safe:animate-marquee gap-10 pr-10">
            {[...TICKER, ...TICKER].map((tick, i) => (
              <span key={i} className="flex items-center gap-2 whitespace-nowrap font-mono text-xs text-muted-foreground">
                <Sticker name={TICKER_ICONS[i % TICKER_ICONS.length]} size={20} priority className="h-4 w-auto" />
                {tick}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ───────────── Stats (profile data row) ───────────── */}
      <section className="container py-14">
        <Reveal>
          <Frame label={t('landing.ticker.label')} index="00">
            <div className="grid grid-cols-1 divide-y divide-border/60 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              {STATS_META.map((s) => (
                <div key={s.code} className="p-6">
                  <p className="eyebrow-mono text-muted-foreground">{s.code}</p>
                  <p className="mt-2 font-display text-4xl font-semibold">
                    <NumberTicker value={s.v} suffix={s.suffix} />
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">{t(s.labelKey)}</p>
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
            <h2 className="font-display text-4xl font-semibold tracking-tight">{t('landing.howItWorks.title')}</h2>
            <span className="font-mono text-xs text-muted-foreground">{t('landing.howItWorks.range')}</span>
          </div>
        </Reveal>
        <div className="divide-y divide-border/50">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 0.06}>
              <div className="group grid grid-cols-[3rem_1fr] items-baseline gap-x-6 py-8 transition-colors hover:bg-surface/30 md:grid-cols-[6rem_1fr_14rem]">
                <span className="font-mono text-lg text-primary/60 transition-colors group-hover:text-primary">{s.n}</span>
                <div>
                  <h3 className="flex items-center gap-2.5 text-2xl font-semibold">
                    {t(s.tKey)}
                    <Sticker
                      name={STEP_STICKERS[i % STEP_STICKERS.length]}
                      size={34}
                      className="h-7 w-auto transition-transform group-hover:rotate-6 group-hover:scale-110"
                    />
                  </h3>
                  <p className="mt-2 max-w-lg text-muted-foreground">{t(s.dKey)}</p>
                </div>
                <span className="col-start-2 mt-2 eyebrow-mono text-muted-foreground md:col-start-3 md:mt-0 md:self-center md:text-right">
                  {t(s.tagKey)}
                </span>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ───────────── Why different (profile data page) ───────────── */}
      <section className="container py-12">
        <Reveal>
          <Frame label={t('landing.features.frame')} index="01" tilt>
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
                      <span className="eyebrow-mono text-primary/60">{f.id}</span>
                      <Sticker name={f.sticker} size={40} className="h-8 w-auto transition-transform group-hover:-rotate-6 group-hover:scale-110" />
                    </div>
                    <h3 className="mt-5 flex items-center gap-2 text-xl font-semibold">
                      <Icon className="size-4 text-muted-foreground" />
                      {t(f.titleKey)}
                    </h3>
                    <p className="mt-2 max-w-md text-sm text-muted-foreground">{t(f.bodyKey)}</p>
                    {f.stampKey && (
                      <div className="mt-4">
                        <Stamp accent="secondary">✦ {t(f.stampKey)}</Stamp>
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
              {t('landing.leaderboard.title')}
              <Sticker name="burst-new" size={52} rotate={-8} className="hidden h-9 w-auto sm:block" />
            </h2>
            <Link href="/leaderboard" className="font-mono text-xs text-primary hover:underline">
              {t('landing.leaderboard.link')}
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
                <span className="font-mono text-2xs text-muted-foreground">★ {(SAMPLE.length - i) * 4}</span>
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
                <Stamp accent="tertiary">{t('landing.dev.stamp')}</Stamp>
                <h2 className="mt-4 text-3xl font-semibold tracking-tight">
                  {t('landing.dev.title')} <AuroraText>{t('landing.dev.titleHighlight')}</AuroraText>
                </h2>
                <p className="mt-3 text-muted-foreground">
                  {t('landing.dev.body')}
                </p>
                <Link href="/how-it-works#devs" className="mt-5 inline-flex font-mono text-sm text-tertiary hover:underline">
                  {t('landing.dev.link')}
                </Link>
              </div>
              <ReputationSnippet className="min-w-0" />
            </div>
          </Frame>
        </Reveal>
      </section>

      {/* ───────────── Final CTA ───────────── */}
      <section className="relative overflow-hidden py-32 text-center">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.05] [mask-image:radial-gradient(circle_at_center,black,transparent_70%)]"
          style={{ backgroundImage: `url(${asset('backgrounds/tile-256.png')})`, backgroundSize: '180px' }}
        />
        <Meteors number={18} />
        <Sticker name="burst-wow" size={92} rotate={-12} className="pointer-events-none absolute left-[12%] top-16 hidden motion-safe:animate-float md:block" />
        <Sticker name="star-pop" size={70} className="pointer-events-none absolute right-[14%] bottom-20 hidden motion-safe:animate-float md:block" />
        <div className="absolute left-1/2 top-1/2 size-[30rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-3xl motion-safe:animate-glow-pulse" aria-hidden />
        <div className="container relative">
          <Reveal>
            <p className="mb-4 eyebrow-mono text-primary/70">{t('landing.cta.eyebrow')}</p>
            <h2 className="mx-auto max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              {t('landing.cta.title')} <AuroraText>{t('landing.cta.titleHighlight')}</AuroraText>
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <span className="relative mt-9 inline-flex overflow-hidden rounded-full">
              <Link href="/app" className={cn(buttonVariants({ variant: 'flow', size: 'lg' }))}>
                {t('landing.cta.button')} <ArrowRight className="size-4" />
              </Link>
              <BorderBeam size={60} duration={6} colorTo="hsl(var(--tertiary))" />
            </span>
          </Reveal>
        </div>
      </section>
    </div>
  );
}
