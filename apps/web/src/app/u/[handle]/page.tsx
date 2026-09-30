'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useWallet } from '@/components/wallet/wallet-provider';
import { getScores, type PeopleCounts } from '@/lib/reputation';
import { getPeopleCounts } from '@/lib/constellation';
import { resolveHandle, getMeta, type OnChainMeta } from '@/lib/registry';
import { Crest } from '@/components/brand/crest';
import { Avatar } from '@/components/Avatar';
import { Frame } from '@/components/fx/frame';
import { Stamp } from '@/components/fx/stamp';
import { ShareRow } from '@/components/fx/share-row';
import { BadgeGallery } from '@/components/BadgeGallery';
import { VouchNetwork } from '@/components/VouchNetwork';
import { Skeleton } from '@/components/ui/skeleton';
import { buttonVariants } from '@/components/ui/button';
import { shortAddr } from '@alvinmunk/shared';
import { cn } from '@/lib/utils';
import { readNetworkFor, withReadNetwork } from '@/lib/read-network';
import { ReadOnlyBanner } from '@/components/read-only-banner';

/**
 * Public profile. The handle is resolved ON-CHAIN via the registry, so ANY claimed
 * @handle renders for anyone (the share-link target). Falls back to an honest "unclaimed"
 * state for free handles. `?network=testnet` on a mainnet deployment shows the testnet
 * profile, read-only (lib/read-network).
 */
export default function ProfilePage({
  params,
  searchParams,
}: {
  params: { handle: string };
  searchParams?: { network?: string | string[] };
}) {
  const handle = params.handle.toLowerCase();
  // A shared singleton (or null), so it is a stable effect dependency.
  const net = readNetworkFor(searchParams?.network);
  const { profile } = useWallet();
  const [address, setAddress] = useState<string | null | undefined>(undefined); // undefined = loading
  const [scores, setScores] = useState<{ social: number; earned: number } | null>(null);
  const [people, setPeople] = useState<PeopleCounts | null>(null);
  const [meta, setMeta] = useState<OnChainMeta | null>(null);

  useEffect(() => {
    let alive = true;
    setAddress(undefined);
    setScores(null);
    setPeople(null);
    setMeta(null);
    resolveHandle(handle, net)
      .then(async (addr) => {
        if (!alive) return;
        setAddress(addr);
        if (!addr) return;
        const [s, p, m] = await Promise.all([
          getScores(addr, net).catch(() => ({ social: 0, earned: 0 })),
          getPeopleCounts(addr, net).catch(() => ({ vouchedBy: 0, backed: 0 })),
          getMeta(addr, net), // null (default face, no bio) when unset or the registry predates it
        ]);
        if (!alive) return;
        setScores(s);
        setPeople(p);
        setMeta(m);
      })
      .catch(() => alive && setAddress(null));
    return () => {
      alive = false;
    };
  }, [handle, net]);

  // The signed-in profile lives on the deployment's network, never the override's.
  const isMe = !net && !!address && profile?.address === address;
  // The published face/bio for everyone; on your own profile the local copy (updated the
  // moment you pick, before the tx lands) wins.
  const avatar = (isMe ? profile?.avatar : undefined) ?? meta?.avatar;
  const bio = (isMe ? profile?.bio : undefined) ?? meta?.bio;

  if (address === undefined) {
    return (
      <div className="container max-w-2xl py-14">
        <Frame label={`profile // @${handle}`} index="…">
          <div className="flex items-center gap-6 p-8">
            <Skeleton className="size-32 rounded-full" />
            <div className="flex-1 space-y-3">
              <Skeleton className="h-7 w-40" />
              <Skeleton className="h-4 w-28" />
            </div>
          </div>
        </Frame>
      </div>
    );
  }

  if (address === null) {
    return (
      <div className="container max-w-md py-24">
        {net && <ReadOnlyBanner network={net.network} />}
        <Frame label={`profile // @${handle}`} index="FREE">
          <div className="flex flex-col items-center gap-4 p-8 text-center">
            <Crest address={`unclaimed-${handle}`} size={120} points={5} />
            <h1 className="font-display text-2xl font-semibold">@{handle}</h1>
            {net ? (
              <p className="text-sm text-muted-foreground text-balance">
                Nobody held this handle on {net.network}.
              </p>
            ) : (
              <>
                <p className="font-mono text-xs uppercase tracking-wider text-secondary">available</p>
                <p className="text-sm text-muted-foreground text-balance">
                  This handle isn&apos;t claimed yet. Open the app, pick it, and it stamps to chain as
                  your profile ID.
                </p>
                <Link href="/app" className={cn(buttonVariants({ variant: 'flow' }))}>
                  Claim @{handle}
                </Link>
              </>
            )}
          </div>
        </Frame>
      </div>
    );
  }

  return (
    <div className="container max-w-2xl py-14">
      {net && <ReadOnlyBanner network={net.network} />}
      <Frame label={`profile // @${handle}`} index={net ? net.network.toUpperCase() : 'ID'} tilt>
        <div className="grid gap-6 p-7 sm:grid-cols-[auto_1fr] sm:items-center sm:p-8">
          <Avatar address={address} avatar={avatar} handle={handle} size={140} />
          <div>
            <h1 className="font-display text-3xl font-semibold">@{handle}</h1>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{shortAddr(address)}</p>
            {bio && <p className="mt-2 break-words text-sm text-foreground/80">{bio}</p>}
            <div className="mt-3">
              <Stamp accent="secondary">✦ LIT ON STELLAR</Stamp>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 divide-x divide-border/60 border-t border-border/60">
          <Field label="VOUCHED_BY" value={people?.vouchedBy} accent="primary" />
          <Field label="BACKED" value={people?.backed} accent="tertiary" />
          <Field label="EARNED_XP" value={scores?.earned} accent="secondary" />
        </div>
      </Frame>

      {/* Milestone badges — earned + next-to-earn, on every public profile. They read the
          quest and rewards contracts too, which the override doesn't cover. */}
      {!net && (
        <div className="mt-5">
          <BadgeGallery address={address} />
        </div>
      )}

      {/* The people behind the numbers (#277): who vouched, whom they backed, who you share. */}
      <VouchNetwork
        address={address}
        handle={handle}
        net={net}
        viewer={profile?.address}
        isMe={isMe}
        vouchedByCount={people?.vouchedBy}
        backedCount={people?.backed}
      />

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {/* Read-only on the override: no vouch (or any other write) from here. */}
        {!net && (
          <Link href="/app" className={cn(buttonVariants({ variant: 'flow' }))}>
            {isMe ? 'Vouch someone' : `Vouch @${handle}`}
          </Link>
        )}
        <Link
          href={withReadNetwork('/leaderboard', net)}
          className={cn(buttonVariants({ variant: 'outline' }), 'glass')}
        >
          Leaderboard
        </Link>
        <ShareRow
          path={withReadNetwork(`/u/${handle}`, net)}
          text={
            isMe
              ? 'My constellation on alvinmunk — collect people, not points.'
              : `@${handle} on alvinmunk — collect people, not points.`
          }
        />
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  accent,
}: {
  label: string;
  value?: number;
  accent: 'primary' | 'secondary' | 'tertiary';
}) {
  const c = accent === 'primary' ? 'text-primary' : accent === 'secondary' ? 'text-secondary' : 'text-tertiary';
  return (
    <div className="p-5">
      <p className="eyebrow-mono text-muted-foreground">{label}</p>
      {value === undefined ? (
        <Skeleton className="mt-2 h-8 w-12" />
      ) : (
        <p className={cn('mt-2 font-display text-3xl font-semibold', c)}>{value}</p>
      )}
    </div>
  );
}
