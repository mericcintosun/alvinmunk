'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useWallet } from '@/components/wallet/wallet-provider';
import { getSocialScore, getEarnedScore } from '@/lib/reputation';
import { Crest } from '@/components/brand/crest';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { buttonVariants } from '@/components/ui/button';
import { cn, shortAddress } from '@/lib/utils';

export default function ProfilePage({ params }: { params: { handle: string } }) {
  const { handle } = params;
  const { profile } = useWallet();
  const isMe = profile?.handle === handle.toLowerCase();
  const address = isMe ? profile?.address : null;

  const [scores, setScores] = useState<{ social: number; earned: number } | null>(null);

  useEffect(() => {
    if (!address) return;
    Promise.all([
      getSocialScore(address, address).catch(() => 0),
      getEarnedScore(address, address).catch(() => 0),
    ]).then(([social, earned]) => setScores({ social, earned }));
  }, [address]);

  // Handle→address resolution is on-chain-deferred; we can only render a passport we
  // hold locally (the current user). Unknown handles get an honest empty state.
  if (!isMe || !address) {
    return (
      <div className="container max-w-md py-24 text-center">
        <Crest address={`unknown-${handle}`} size={120} points={5} />
        <h1 className="mt-6 text-2xl font-semibold">@{handle}</h1>
        <p className="mt-2 text-sm text-muted-foreground text-balance">
          This passport isn&apos;t resolvable from here yet — public handle lookup lands with
          the on-chain directory. Vouch someone and your own passport shows here.
        </p>
        <Link href="/app" className={cn(buttonVariants(), 'mt-6')}>
          Open the app
        </Link>
      </div>
    );
  }

  return (
    <div className="container max-w-2xl py-12">
      <Card className="overflow-hidden">
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          <Crest address={address} handle={handle} size={140} points={7} animate />
          <div>
            <h1 className="text-2xl font-semibold">@{handle}</h1>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{shortAddress(address)}</p>
          </div>
          <Badge variant="onchain">Lit on Stellar testnet</Badge>

          {/* Faces-over-numbers stat row */}
          <div className="mt-2 grid w-full grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Social XP" value={scores?.social} accent="primary" />
            <Stat label="Earned XP" value={scores?.earned} accent="onchain" />
            <Stat label="Constellation" value={scores ? Math.max(1, Math.round(scores.social / 10)) : undefined} accent="primary" />
          </div>

          <div className="mt-4 flex gap-3">
            <Link href="/app" className={cn(buttonVariants())}>
              {isMe ? 'Vouch someone' : 'Vouch @' + handle}
            </Link>
            <Link href="/leaderboard" className={cn(buttonVariants({ variant: 'outline' }))}>
              Leaderboard
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value?: number; accent: 'primary' | 'onchain' }) {
  return (
    <div className="rounded-xl border border-border bg-card/40 p-4">
      {value === undefined ? (
        <Skeleton className="mx-auto h-7 w-10" />
      ) : (
        <div className={cn('text-2xl font-semibold', accent === 'primary' ? 'text-primary' : 'text-secondary')}>
          {value}
        </div>
      )}
      <div className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}
