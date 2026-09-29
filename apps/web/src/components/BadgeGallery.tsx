'use client';

import React, { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { Frame } from '@/components/fx/frame';
import { Avatar } from '@/components/Avatar';
import { Sticker } from '@/components/ui/sticker';
import { Skeleton } from '@/components/ui/skeleton';
import { getBadges, visibleBadges, type Badge, type BadgePerson } from '@/lib/badges';
import { FOCUS_MODE } from '@/lib/focus';
import { useTranslations, type TFn } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { shortAddr } from '@alvinmunk/shared';

type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; badges: Badge[] };

/**
 * BadgeGallery — the milestone row (belts/04: "badge gallery on the profile") for
 * `address`, which is always the profile OWNER. Earned badges are full-color stickers;
 * locked ones are greyed out WITH the remaining step ("2 more people to back"). A badge
 * tied to a person names them ("lit by @alice"). Pure reads: no XP, no treasury, no writes.
 */
export function BadgeGallery({ address, className }: { address: string; className?: string }) {
  const t = useTranslations();
  const headingId = useId();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    getBadges(address)
      .then((badges) => alive && setState({ status: 'ready', badges: visibleBadges(badges, FOCUS_MODE) }))
      .catch(() => alive && setState({ status: 'error' }));
    return () => {
      alive = false;
    };
  }, [address, attempt]);

  const index =
    state.status === 'ready'
      ? `${state.badges.filter((b) => b.earned).length}/${state.badges.length}`
      : state.status === 'error'
        ? '—'
        : '…';

  return (
    <section aria-labelledby={headingId}>
      <Frame label={t('badges.frame')} index={index} accent="tertiary" tape="br" className={className}>
        <h2 id={headingId} className="sr-only">
          {t('badges.heading')}
        </h2>
        {state.status === 'error' ? (
          <div className="flex flex-wrap items-center justify-between gap-3 p-4" role="alert">
            <p className="text-sm text-muted-foreground">{t('badges.error')}</p>
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="font-mono text-xs uppercase tracking-wider text-primary underline-offset-4 hover:underline"
            >
              {t('badges.retry')}
            </button>
          </div>
        ) : (
          <ul
            className="grid grid-cols-3 gap-2 p-4 sm:grid-cols-6"
            aria-busy={state.status === 'loading'}
            data-testid="badge-gallery"
          >
            {state.status === 'loading' ? (
              <>
                <li className="sr-only">{t('badges.loading')}</li>
                {Array.from({ length: 6 }).map((_, i) => (
                  <li key={i} aria-hidden className="flex flex-col items-center gap-2 p-2">
                    <Skeleton className="size-12" />
                    <Skeleton className="h-3 w-14" />
                  </li>
                ))}
              </>
            ) : (
              state.badges.map((b) => <BadgeTile key={b.id} badge={b} />)
            )}
          </ul>
        )}
      </Frame>
    </section>
  );
}

function BadgeTile({ badge }: { badge: Badge }) {
  const t = useTranslations();
  const key = `badges.${badge.id}`;
  return (
    <li className="flex flex-col items-center gap-1.5 p-2 text-center" data-badge={badge.id} data-earned={badge.earned}>
      <div className="flex h-12 items-center justify-center">
        {/* Decorative: the badge name below is the accessible label. */}
        <Sticker name={badge.sticker} size={48} className={cn(!badge.earned && 'opacity-40 grayscale')} />
      </div>
      <p className={cn('text-[11px] font-semibold leading-tight', !badge.earned && 'text-muted-foreground')}>
        {t(`${key}.name`)}
        <span className="sr-only"> — {t(badge.earned ? 'badges.earned' : 'badges.locked')}</span>
      </p>
      <p className="font-mono text-[9px] uppercase leading-tight tracking-wider text-muted-foreground">
        <BadgeDetail badge={badge} t={t} />
      </p>
    </li>
  );
}

/** Earned: who made it happen, else the milestone. Locked: the remaining step. */
function BadgeDetail({ badge, t }: { badge: Badge; t: TFn }) {
  const key = `badges.${badge.id}`;
  if (!badge.earned) {
    return badge.remaining === undefined
      ? t(`${key}.next`)
      : t(`${key}.next.${badge.remaining === 1 ? 'one' : 'other'}`, { count: String(badge.remaining) });
  }
  if (badge.person) {
    // The template places {name} (word order differs per locale); the name is a live link.
    const [before, after = ''] = t(`${key}.by`).split('{name}');
    return (
      <>
        {before}
        <PersonName person={badge.person} />
        {after}
      </>
    );
  }
  return t(`${key}.desc`, badge.target === undefined ? undefined : { count: String(badge.target) });
}

function PersonName({ person }: { person: BadgePerson }) {
  if (!person.handle) return <span className="normal-case">{shortAddr(person.address)}</span>;
  return (
    <Link
      href={`/u/${person.handle}`}
      className="inline-flex items-center gap-1 align-middle normal-case text-foreground underline-offset-2 hover:underline"
    >
      <span aria-hidden>
        <Avatar address={person.address} size={14} ring={false} />
      </span>
      @{person.handle}
    </Link>
  );
}
