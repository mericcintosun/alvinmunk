// Note: 'use client' means metadata must be defined in a parent layout. This route's
// title/description live in how-it-works/layout.tsx and use the root title template
// ('%s · alvinmunk') — "How it works" becomes "How it works · alvinmunk".

'use client';

import Link from 'next/link';
import { Frame } from '@/components/fx/frame';
import { Stamp } from '@/components/fx/stamp';
import { LoopScroll } from '@/components/fx/loop-scroll';
import { BorderBeam } from '@/components/fx/border-beam';
import { Sticker } from '@/components/ui/sticker';
import { buttonVariants } from '@/components/ui/button';
import { useTranslations } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { ReputationSnippet } from '@/components/ReputationSnippet';

/** Renders `raw` with `highlight` wrapped in a <strong> — for bolding inline XP labels. */
function SplitHighlight({ raw, highlight }: { raw: string; highlight: string }) {
  const parts = raw.split(highlight);
  if (parts.length < 2) return <>{raw}</>;
  return (
    <>
      {parts[0]}
      <strong className="text-foreground">{highlight}</strong>
      {parts[1]}
    </>
  );
}

const LIMIT_KEYS = [
  { id: 'LIM-01', tKey: 'howItWorks.lim01.t', dKey: 'howItWorks.lim01.d' },
  { id: 'LIM-02', tKey: 'howItWorks.lim02.t', dKey: 'howItWorks.lim02.d' },
  { id: 'LIM-03', tKey: 'howItWorks.lim03.t', dKey: 'howItWorks.lim03.d' },
  { id: 'LIM-04', tKey: 'howItWorks.lim04.t', dKey: 'howItWorks.lim04.d' },
  { id: 'LIM-05', tKey: 'howItWorks.lim05.t', dKey: 'howItWorks.lim05.d' },
  { id: 'LIM-06', tKey: 'howItWorks.lim06.t', dKey: 'howItWorks.lim06.d' },
];

export default function HowItWorks() {
  const t = useTranslations();

  return (
    <div className="container max-w-5xl py-16">
      {/* header */}
      <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-primary/80">{t('howItWorks.eyebrow')}</p>
      <h1 className="display-hero mt-4 flex flex-wrap items-center gap-3 font-display text-5xl font-semibold tracking-tight sm:text-6xl">
        {t('howItWorks.title')}
        <Sticker name="star-lime" size={48} className="h-10 w-auto motion-safe:animate-float" />
        <Sticker name="star-arc" size={56} className="hidden h-8 w-auto opacity-80 sm:block" />
        <Sticker name="doodle-spiral" size={30} className="hidden h-6 w-auto opacity-70 sm:block" />
      </h1>
      <p className="mt-5 max-w-xl text-lg text-muted-foreground text-balance">
        {t('howItWorks.subtitle')}
      </p>

      {/* the loop — scrollytelling */}
      <section className="mt-16">
        <div className="flex items-end justify-between border-b border-border/60 pb-3">
          <h2 className="flex items-center gap-2.5 font-display text-3xl font-semibold tracking-tight">
            {t('howItWorks.vouchLoop.title')}
            <Sticker name="doodle-spark" size={28} className="h-6 w-auto" />
          </h2>
          <span className="font-mono text-xs text-muted-foreground">{t('howItWorks.vouchLoop.scroll')}</span>
        </div>
        <div className="mt-8">
          <LoopScroll />
        </div>
      </section>

      {/* two tracks */}
      <section className="mt-20">
        <h2 className="border-b border-border/60 pb-3 font-display text-3xl font-semibold tracking-tight">
          {t('howItWorks.xpTracks.title')}
        </h2>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <Frame label={t('howItWorks.social.label')} index="A" tilt tape="br">
            <div className="relative p-7">
              <Sticker name="social-seen" size={70} rotate={6} className="absolute right-4 top-4" />
              <Stamp accent="primary">{t('howItWorks.social.stamp')}</Stamp>
              <h3 className="mt-4 text-xl font-semibold">{t('howItWorks.social.title')}</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                <SplitHighlight
                  raw={t('howItWorks.social.body', { notCashable: t('howItWorks.social.notCashable') })}
                  highlight={t('howItWorks.social.notCashable')}
                />
              </p>
            </div>
          </Frame>
          <Frame label={t('howItWorks.earned.label')} index="B" accent="secondary" tilt>
            <div className="relative p-7">
              <Sticker name="stamp-verified" size={72} rotate={-8} className="absolute right-3 top-3" />
              <Stamp accent="secondary">{t('howItWorks.earned.stamp')}</Stamp>
              <h3 className="mt-4 text-xl font-semibold">{t('howItWorks.earned.title')}</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                <SplitHighlight
                  raw={t('howItWorks.earned.body', { onlyTrack: t('howItWorks.earned.onlyTrack') })}
                  highlight={t('howItWorks.earned.onlyTrack')}
                />
              </p>
            </div>
          </Frame>
        </div>
      </section>

      {/* anti-sybil */}
      <section id="anti-sybil" className="mt-20 scroll-mt-24">
        <h2 className="border-b border-border/60 pb-3 font-display text-3xl font-semibold tracking-tight">
          {t('howItWorks.antiSybil.title')}
        </h2>
        <p className="mt-3 text-sm text-muted-foreground">
          {t('howItWorks.antiSybil.subtitle')}
        </p>
        <Frame label={t('howItWorks.antiSybil.frame')} index="06" className="mt-6" tape="tr">
          <Sticker name="stamp-strip" size={96} rotate={-4} className="absolute -top-4 right-10 z-10 hidden sm:block" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {LIMIT_KEYS.map((l, i) => (
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
                <h3 className="mt-3 font-semibold">{t(l.tKey)}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{t(l.dKey)}</p>
              </div>
            ))}
          </div>
        </Frame>
      </section>

      {/* devs */}
      <section id="devs" className="mt-20 scroll-mt-24">
        <h2 className="border-b border-border/60 pb-3 font-display text-3xl font-semibold tracking-tight">
          {t('howItWorks.devs.title')}
        </h2>
        <p className="mt-3 text-sm text-muted-foreground">
          {t('howItWorks.devs.body')}
        </p>
        <ReputationSnippet className="mt-6" />
      </section>

      <div className="relative mt-16 flex justify-center">
        <Sticker name="social-boom" size={64} rotate={-10} className="absolute -top-6 left-1/2 hidden -translate-x-[7rem] motion-safe:animate-float md:block" />
        <span className="relative inline-flex overflow-hidden rounded-full">
          <Link href="/app" className={cn(buttonVariants({ variant: 'flow', size: 'lg' }))}>
            {t('howItWorks.devs.openApp')}
          </Link>
          <BorderBeam size={60} duration={6} colorTo="hsl(var(--tertiary))" />
        </span>
      </div>
    </div>
  );
}
