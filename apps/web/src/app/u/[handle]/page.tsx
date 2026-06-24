'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useWallet } from '@/components/wallet/wallet-provider';
import { getScores } from '@/lib/reputation';
import { resolveHandle } from '@/lib/registry';
import { Crest } from '@/components/brand/crest';
import { Frame } from '@/components/fx/frame';
import { Stamp } from '@/components/fx/stamp';
import { ShareRow } from '@/components/fx/share-row';
import { Skeleton } from '@/components/ui/skeleton';
import { buttonVariants } from '@/components/ui/button';
import { cn, shortAddress } from '@/lib/utils';

/**
 * Public passport. The handle is resolved ON-CHAIN via the registry, so ANY claimed
 * @handle renders for anyone (the share-link target). Falls back to an honest "unclaimed"
 * state for free handles.
 */
export default function ProfilePage({ params }: { params: { handle: string } }) {
  const handle = params.handle.toLowerCase();
  const { profile } = useWallet();
  const [address, setAddress] = useState<string | null | undefined>(undefined); // undefined = loading
  const [scores, setScores] = useState<{ social: number; earned: number } | null>(null);

  useEffect(() => {
    let alive = true;
    setAddress(undefined);
    setScores(null);
    resolveHandle(handle)
      .then(async (addr) => {
        if (!alive) return;
        setAddress(addr);
        if (addr) setScores(await getScores(addr).catch(() => ({ social: 0, earned: 0 })));
      })
      .catch(() => alive && setAddress(null));
    return () => {
      alive = false;
    };
  }, [handle]);

  const isMe = !!address && profile?.address === address;

  if (address === undefined) {
    return (
      <div className="container max-w-2xl py-14">
        <Frame label={`passport // @${handle}`} index="…">
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
        <Frame label={`passport // @${handle}`} index="FREE">
          <div className="flex flex-col items-center gap-4 p-8 text-center">
            <Crest address={`unclaimed-${handle}`} size={120} points={5} />
            <h1 className="font-display text-2xl font-semibold">@{handle}</h1>
            <p className="font-mono text-xs uppercase tracking-wider text-secondary">available</p>
            <p className="text-sm text-muted-foreground text-balance">
              This handle isn&apos;t claimed yet. Open the app, pick it, and it stamps to chain as
              your passport ID.
            </p>
            <Link href="/app" className={cn(buttonVariants({ variant: 'flow' }))}>
              Claim @{handle}
            </Link>
          </div>
        </Frame>
      </div>
    );
  }

  const constellation = scores ? Math.max(1, Math.round(scores.social / 10)) : undefined;

  return (
    <div className="container max-w-2xl py-14">
      <Frame label={`passport // @${handle}`} index="ID" tilt>
        <div className="grid gap-6 p-7 sm:grid-cols-[auto_1fr] sm:items-center sm:p-8">
          <Crest address={address} handle={handle} size={140} points={7} animate />
          <div>
            <h1 className="font-display text-3xl font-semibold">@{handle}</h1>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{shortAddress(address)}</p>
            <div className="mt-3">
              <Stamp accent="secondary">✦ LIT ON STELLAR</Stamp>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 divide-x divide-border/60 border-t border-border/60">
          <Field label="SOCIAL_XP" value={scores?.social} accent="primary" />
          <Field label="EARNED_XP" value={scores?.earned} accent="secondary" />
          <Field label="STARS" value={constellation} accent="tertiary" />
        </div>
      </Frame>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Link href="/app" className={cn(buttonVariants({ variant: 'flow' }))}>
          {isMe ? 'Vouch someone' : `Vouch @${handle}`}
        </Link>
        <Link href="/leaderboard" className={cn(buttonVariants({ variant: 'outline' }), 'glass')}>
          Leaderboard
        </Link>
        <ShareRow
          path={`/u/${handle}`}
          text={
            isMe
              ? 'My constellation on Stellar Passport — collect people, not points.'
              : `@${handle} on Stellar Passport — collect people, not points.`
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
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      {value === undefined ? (
        <Skeleton className="mt-2 h-8 w-12" />
      ) : (
        <p className={cn('mt-2 font-display text-3xl font-semibold', c)}>{value}</p>
      )}
    </div>
  );
}
