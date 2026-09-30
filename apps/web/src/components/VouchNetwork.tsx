'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { shortAddr } from '@alvinmunk/shared';
import { Avatar } from '@/components/Avatar';
import { Frame } from '@/components/fx/frame';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchBackedBy, fetchVouchersOf, mutualNeighbours, timeAgo, type VoucherStar } from '@/lib/constellation';
import { fetchReputationEvents } from '@/lib/events';
import { useFormat, useLocale, useTranslations } from '@/lib/i18n';
import { withReadNetwork, type ReadNetwork } from '@/lib/read-network';
import { reverseHandles } from '@/lib/registry';
import { cn } from '@/lib/utils';

/** People read per list (the event fold's cap). */
const LIST_MAX = 14;
/** Faces shown per row before a "+N more" line. */
const STACK_MAX = 8;

/**
 * The people behind a profile's numbers (#277): who vouched for it, whom it backed, and —
 * when a signed-in viewer opens someone else's profile and the sets meet — who they both
 * know. It reads the reputation event window (lib/constellation), a recent slice; the
 * counts come from the durable on-chain counters (#302) and can be larger, which the
 * caption says. Every read takes `net`, so a `?network=testnet` profile shows that
 * network's people and links on within it.
 */
export function VouchNetwork({
  address,
  handle,
  net,
  viewer,
  isMe,
  vouchedByCount,
  backedCount,
}: {
  address: string;
  handle: string;
  net: ReadNetwork | null;
  /** The signed-in wallet (the deployment's network), for the mutual row. */
  viewer?: string;
  isMe: boolean;
  vouchedByCount?: number;
  backedCount?: number;
}) {
  const t = useTranslations();
  const { locale } = useLocale();
  // null = still reading (a skeleton, never "nobody").
  const [vouchers, setVouchers] = useState<VoucherStar[] | null>(null);
  const [backed, setBacked] = useState<VoucherStar[] | null>(null);
  const [mutual, setMutual] = useState<string[]>([]);
  const [handles, setHandles] = useState<Record<string, string | null>>({});

  useEffect(() => {
    let alive = true;
    setVouchers(null);
    setBacked(null);
    fetchVouchersOf(address, LIST_MAX, net)
      .catch(() => [])
      .then((v) => alive && setVouchers(v));
    fetchBackedBy(address, LIST_MAX, net)
      .catch(() => [])
      .then((b) => alive && setBacked(b));
    return () => {
      alive = false;
    };
  }, [address, net]);

  // Mutual only for a signed-in viewer on someone else's profile — and not on the override:
  // the viewer's own vouches live on the deployment's network.
  useEffect(() => {
    setMutual([]);
    if (!viewer || viewer === address || net) return;
    let alive = true;
    fetchReputationEvents()
      .then((events) => alive && setMutual(mutualNeighbours(viewer, address, events)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [address, viewer, net]);

  // One batched reverse_many for every face on the section, never re-asking an address.
  const people = [...(vouchers ?? []).map((p) => p.from), ...(backed ?? []).map((p) => p.from), ...mutual];
  const missing = [...new Set(people)].filter((a) => !(a in handles)).sort().join(',');
  useEffect(() => {
    if (!missing) return;
    let alive = true;
    reverseHandles(missing.split(','), net)
      .then((map) => alive && setHandles((h) => ({ ...h, ...map })))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [missing, net]);

  const face = (a: string, size: number, title?: string) => (
    <FaceLink key={a} address={a} handle={handles[a] ?? null} net={net} size={size} title={title} />
  );

  return (
    <Frame label={`network // @${handle}`} index="◍" className="mt-5">
      <div className="divide-y divide-border/50">
        <Row
          label={t('vouchNetwork.vouchedBy')}
          count={vouchedByCount}
          people={vouchers}
          accent="text-primary"
          render={(p) => face(p.from, 32, caption(p))}
          line={(p) => line(p)}
        />
        <Row
          label={isMe ? t('vouchNetwork.backed.me') : t('vouchNetwork.backed.them', { handle: `@${handle}` })}
          count={backedCount}
          people={backed}
          accent="text-tertiary"
          render={(p) => face(p.from, 32, caption(p))}
          line={(p) => line(p)}
        />
        {mutual.length > 0 && (
          <div className="p-5" data-testid="vouch-network-mutual">
            <p className="eyebrow-mono text-muted-foreground">
              {t('vouchNetwork.mutual')}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {mutual.map((a) => face(a, 26, name(a)))}
              <span className="ml-1 font-mono text-xs text-secondary">{mutual.map(name).join(' · ')}</span>
            </div>
          </div>
        )}
      </div>
      <p className="border-t border-border/50 px-5 py-3 text-2xs text-muted-foreground">
        {t('vouchNetwork.windowNote')}
      </p>
    </Frame>
  );

  function name(a: string) {
    return handles[a] ? `@${handles[a]}` : shortAddr(a);
  }
  function caption(p: VoucherStar) {
    return [name(p.from), p.note ? `“${p.note}”` : '', p.created ? timeAgo(p.created, locale) : '']
      .filter(Boolean)
      .join(' · ');
  }
  function line(p: VoucherStar) {
    return (
      <>
        <span className="text-foreground/80">{name(p.from)}</span>
        {p.note ? ` — “${p.note}”` : ''}
        {p.created ? ` · ${timeAgo(p.created, locale)}` : ''}
      </>
    );
  }
}

/** One labelled row: the durable count, a stack of faces, and who each one is. */
function Row({
  label,
  count,
  people,
  accent,
  render,
  line,
}: {
  label: string;
  count?: number;
  people: VoucherStar[] | null;
  accent: string;
  render: (p: VoucherStar) => React.ReactNode;
  line: (p: VoucherStar) => React.ReactNode;
}) {
  const t = useTranslations();
  const format = useFormat();
  const shown = (people ?? []).slice(0, STACK_MAX);
  return (
    <div className="p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 eyebrow-mono text-muted-foreground [overflow-wrap:anywhere]">{label}</p>
        {count !== undefined && (
          <p className={cn('font-display text-sm font-semibold', accent)}>{format.number(count)}</p>
        )}
      </div>
      {people === null ? (
        <div className="mt-3 flex items-center gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="size-8 rounded-full" />
          ))}
        </div>
      ) : people.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{t('vouchNetwork.empty')}</p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-1.5">{shown.map(render)}</div>
          <ul className="mt-2 space-y-0.5">
            {shown.map((p) => (
              <li key={`${p.from}-${p.vouchId}`} className="truncate font-mono text-2xs text-muted-foreground">
                {line(p)}
              </li>
            ))}
          </ul>
          {people.length > STACK_MAX && (
            <p className="mt-2 font-mono text-xs text-muted-foreground">
              {t('vouchNetwork.more', { count: String(people.length - STACK_MAX) })}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** A face linking to that person's profile (their score page without a handle), kept on
 *  the override network. */
function FaceLink({
  address,
  handle,
  net,
  size,
  title,
}: {
  address: string;
  handle: string | null;
  net: ReadNetwork | null;
  size: number;
  title?: string;
}) {
  const href = withReadNetwork(handle ? `/u/${handle}` : `/score/${address}`, net);
  return (
    <Link href={href} title={title} aria-label={title} className="block rounded-full transition-transform hover:scale-110">
      <Avatar address={address} handle={handle ?? undefined} size={size} />
    </Link>
  );
}
