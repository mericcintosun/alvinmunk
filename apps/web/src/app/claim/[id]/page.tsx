'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { shortAddr } from '@passport/shared';
import { useWallet } from '@/components/wallet/wallet-provider';
import { claimVouch, getVouch, VOUCH_TTL_SECS, type VouchView } from '@/lib/reputation';
import { Crest } from '@/components/brand/crest';
import { Frame } from '@/components/fx/frame';
import { Stamp } from '@/components/fx/stamp';
import { BorderBeam } from '@/components/fx/border-beam';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StateArt } from '@/components/ui/state-art';
import { Sticker } from '@/components/ui/sticker';
import { cn, humanizeError, withTimeout } from '@/lib/utils';

/** Read the claim-secret from the URL fragment (#s=…), falling back to the legacy ?s=
 *  query for links shared before the switch. The fragment never reaches the server. */
function readSecret(): string {
  if (typeof window === 'undefined') return '';
  const fromHash = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('s');
  const fromQuery = new URLSearchParams(window.location.search).get('s');
  return fromHash ?? fromQuery ?? '';
}

const CLAIM_ERRORS: Record<number, string> = {
  4: "This vouch doesn't exist or has expired.",
  5: 'This star is already lit — it was claimed already.',
  6: "You can't claim your own vouch. Share the link with someone you trust instead.",
  8: "This link's claim code is invalid.",
  9: 'Daily limit reached — try again tomorrow.',
};

export default function ClaimPage(props: { params: { id: string } }) {
  return (
    <Suspense fallback={null}>
      <ClaimInner {...props} />
    </Suspense>
  );
}

function ClaimInner({ params }: { params: { id: string } }) {
  const { id } = params;
  const vid = Number(id);
  const validId = Number.isInteger(vid) && vid >= 0;
  const { connect, profile } = useWallet();
  const [secret, setSecret] = useState('');
  const [state, setState] = useState<'preview' | 'claiming' | 'done' | 'error'>('preview');
  const [error, setError] = useState<string | null>(null);
  const [vouch, setVouch] = useState<VouchView | null | undefined>(undefined);
  // Distinguish "couldn't read the chain" (retryable) from "this vouch doesn't exist"
  // so a slow/failing RPC never masquerades as an expired or missing vouch.
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => setSecret(readSecret()), []);

  useEffect(() => {
    if (!validId) {
      setVouch(null);
      return;
    }
    let alive = true;
    setVouch(undefined);
    setLoadError(false);
    withTimeout(getVouch(vid), 15_000, 'vouch')
      .then((v) => alive && setVouch(v ?? null))
      .catch(() => {
        if (alive) {
          setVouch(null);
          setLoadError(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [vid, validId, reloadKey]);

  const loading = validId && vouch === undefined && !loadError;

  const nowSec = Math.floor(Date.now() / 1000);
  const deadline = vouch ? vouch.created + VOUCH_TTL_SECS : 0;
  const daysLeft = vouch ? Math.max(0, Math.ceil((deadline - nowSec) / 86_400)) : 0;
  const windowOpen = vouch ? !vouch.slashed && !vouch.claimed && nowSec < deadline : false;

  async function onClaim() {
    if (!secret) {
      setError('This link is missing its claim code.');
      setState('error');
      return;
    }
    setState('claiming');
    setError(null);
    try {
      const wallet = await connect();
      await claimVouch(wallet, vid, secret);
      setState('done');
    } catch (e) {
      setError(humanizeError(e, CLAIM_ERRORS));
      setState('error');
    }
  }

  const done = state === 'done';
  const status = done ? 'CLAIMED' : vouch?.claimed ? 'CLAIMED' : windowOpen ? 'OPEN' : vouch ? 'EXPIRED' : '—';

  // Loading — show a skeleton, not a half-rendered "from / —" frame at the most
  // emotionally loaded moment of the funnel.
  if (loading) {
    return (
      <div className="container max-w-lg py-16">
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-primary/80">
          {'// incoming_vouch'}
        </p>
        <Skeleton className="mt-4 h-10 w-3/4" />
        <Skeleton className="mt-3 h-4 w-full max-w-sm" />
        <Frame label={`vouch // #${id}`} index="…" className="mt-7">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 p-6">
            <Skeleton className="mx-auto size-[88px] rounded-full" />
            <ArrowRight className="size-5 text-muted-foreground/40" />
            <Skeleton className="mx-auto size-[88px] rounded-full" />
          </div>
        </Frame>
      </div>
    );
  }

  // Couldn't read the vouch (invalid link or RPC failure) — honest, retryable, never
  // disguised as "expired".
  if (!validId || loadError) {
    return (
      <div className="container max-w-lg py-16">
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-primary/80">
          {`// ${validId ? 'unreadable' : 'invalid_link'}`}
        </p>
        <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight">
          {validId ? "Couldn't read this vouch." : 'This link looks broken.'}
        </h1>
        <p className="mt-3 max-w-sm text-muted-foreground text-balance">
          {validId
            ? 'The network didn’t answer in time. Your vouch is safe — try again.'
            : 'The claim link is malformed. Ask the person who sent it to re-share it.'}
        </p>
        <div className="mt-7 flex flex-col items-start gap-3">
          {validId && (
            <Button variant="flow" size="lg" onClick={() => setReloadKey((k) => k + 1)}>
              Try again <ArrowRight className="size-4" />
            </Button>
          )}
          <Link href="/app" className="font-mono text-xs text-muted-foreground underline">
            open_the_app →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container max-w-lg py-16">
      <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-primary/80">
        {done ? '// connected' : '// incoming_vouch'}
      </p>
      <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight">
        {done ? "You're connected." : 'Someone vouched for you.'}
      </h1>
      <p className="mt-3 max-w-sm text-muted-foreground text-balance">
        {done
          ? 'Your star just ignited — your constellation grew by one. Keep the sky alive: vouch someone back.'
          : 'They put their reputation behind yours. Claim your half — two halves become one card.'}
      </p>

      <Frame label={`vouch // #${id}`} index={status} className="mt-7">
        {/* the two halves */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 p-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <Crest address={vouch?.from ?? `voucher-${id}`} size={88} points={6} animate />
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {vouch ? shortAddr(vouch.from) : 'from'}
            </span>
          </div>
          <ArrowRight className={cn('size-5', done ? 'text-primary' : 'text-muted-foreground')} />
          <div className="flex flex-col items-center gap-2 text-center">
            <div
              className={cn(
                'grid size-[88px] place-items-center border transition-all',
                done
                  ? 'border-primary/40 bg-primary/5 motion-safe:animate-ignite'
                  : 'border-dashed border-border bg-surface/30',
              )}
            >
              {done ? (
                <Crest address={profile?.address ?? `claimer-${id}`} size={80} points={6} animate />
              ) : (
                <span className="font-mono text-[10px] uppercase text-muted-foreground">your half</span>
              )}
            </div>
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {done ? 'you' : 'unclaimed'}
            </span>
          </div>
        </div>

        {/* note */}
        {!done && vouch?.note && (
          <p className="border-t border-border/60 px-6 py-4 text-center text-sm italic text-foreground/85">
            &ldquo;{vouch.note}&rdquo;
          </p>
        )}

        {/* data fields */}
        <div className="grid grid-cols-3 divide-x divide-border/60 border-t border-border/60 font-mono">
          <Field label="STATUS" value={status} />
          <Field label="STAKE" value={vouch ? `${vouch.stake} XP` : '—'} />
          <Field label="WINDOW" value={vouch ? (windowOpen ? `${daysLeft}d left` : 'closed') : '—'} />
        </div>
      </Frame>

      {!done && vouch && windowOpen && (
        <p className="mt-3 text-xs text-muted-foreground">
          They staked <strong className="text-foreground">{vouch.stake} reputation</strong> on you — claim within{' '}
          {daysLeft} day{daysLeft === 1 ? '' : 's'} to keep it from being slashed.
        </p>
      )}

      <div className="mt-7">
        {!done ? (
          <div className="flex flex-col items-start gap-3">
            <span className="relative inline-flex overflow-hidden rounded-full">
              <Button variant="flow" size="lg" onClick={onClaim} disabled={state === 'claiming'}>
                {state === 'claiming' ? 'Lighting your star…' : 'Claim your star'}
                {state !== 'claiming' && <ArrowRight className="size-4" />}
              </Button>
              {state !== 'claiming' && <BorderBeam size={56} duration={6} colorTo="hsl(var(--tertiary))" />}
            </span>
            {error && (
              <>
                <p className="max-w-xs text-sm text-destructive">{error}</p>
                <Link href="/app" className="font-mono text-xs text-muted-foreground underline">
                  open_the_app →
                </Link>
              </>
            )}
            <p className="max-w-xs text-xs text-muted-foreground text-balance">
              Nothing to install — we set up your passport, fees sponsored on testnet. No seed phrase.
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <div className="relative self-stretch">
              <StateArt kind="claim-success" size={220} className="mx-auto motion-safe:animate-ignite" />
              <Sticker name="stamp-verified" size={88} rotate={-8} className="absolute -right-1 top-0 motion-safe:animate-ignite" />
            </div>
            <Stamp accent="secondary">✦ STAR IGNITED</Stamp>
            <Link href="/app" className={cn(buttonVariants({ variant: 'flow', size: 'lg' }))}>
              {profile ? 'Now vouch someone back' : 'Create your passport'} <ArrowRight className="size-4" />
            </Link>
            {profile && (
              <Link href={`/u/${profile.handle}`} className="font-mono text-xs text-muted-foreground underline">
                view_your_passport →
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-3 text-center">
      <p className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm text-foreground">{value}</p>
    </div>
  );
}
