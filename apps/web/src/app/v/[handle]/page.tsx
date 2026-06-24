'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { resolveHandle } from '@/lib/registry';
import { getScores } from '@/lib/reputation';
import { Crest } from '@/components/brand/crest';
import { Avatar } from '@/components/Avatar';
import { Frame } from '@/components/fx/frame';
import { Stamp } from '@/components/fx/stamp';
import { BorderBeam } from '@/components/fx/border-beam';
import { AuroraText } from '@/components/fx/shiny-text';
import { buttonVariants } from '@/components/ui/button';
import { cn, shortAddress } from '@/lib/utils';

/**
 * Vouch-invite deep link — `/v/<handle>` is shared by @handle to recruit. The visitor
 * lands on a personalized, OG-rich invite, onboards in two taps, and is nudged to vouch
 * @handle back on the dashboard (we stash the inviter in sessionStorage). One user
 * becomes a recruiting funnel.
 */
export default function InvitePage({ params }: { params: { handle: string } }) {
  const handle = params.handle.toLowerCase();
  const [address, setAddress] = useState<string | null | undefined>(undefined);
  const [scores, setScores] = useState<{ social: number; earned: number } | null>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem('passport.ref', handle); // dashboard nudges a vouch-back
    } catch {
      /* storage unavailable */
    }
    let alive = true;
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

  const stars = scores ? Math.max(1, Math.round(scores.social / 10)) : 0;

  return (
    <div className="container max-w-lg py-16">
      <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-primary/80">{'// you_are_invited'}</p>
      <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight text-balance">
        @{handle} wants you in their <AuroraText>constellation.</AuroraText>
      </h1>
      <p className="mt-3 text-muted-foreground text-balance">
        Stellar Passport — collect people, not points. Make yours in two taps (no seed phrase, fees
        sponsored), then vouch them back so your stars connect.
      </p>

      <Frame label={`invite // @${handle}`} index="REF" className="mt-7" tilt tape="tr">
        <div className="flex items-center gap-5 p-7">
          {address ? (
            <Avatar address={address} handle={handle} size={96} />
          ) : (
            <Crest address={`unclaimed-${handle}`} size={96} points={7} animate />
          )}
          <div className="min-w-0">
            <div className="font-display text-2xl font-semibold">@{handle}</div>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {address ? shortAddress(address) : 'new to the sky'}
            </p>
            <div className="mt-2">
              <Stamp accent="secondary">✦ {address ? `${stars} stars` : 'be their first'}</Stamp>
            </div>
          </div>
        </div>
      </Frame>

      <div className="mt-6">
        <span className="relative inline-flex overflow-hidden rounded-full">
          <Link href="/app" className={cn(buttonVariants({ variant: 'flow', size: 'lg' }))}>
            Create your passport <ArrowRight className="size-4" />
          </Link>
          <BorderBeam size={60} duration={6} colorTo="hsl(var(--tertiary))" />
        </span>
      </div>
      <p className="mt-4 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        no_seed_phrase / fees_sponsored / 2_taps
      </p>
    </div>
  );
}
