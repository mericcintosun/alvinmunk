'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { useWallet } from '@/components/wallet/wallet-provider';
import { claimVouch } from '@/lib/reputation';
import { Crest } from '@/components/brand/crest';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn, humanizeError } from '@/lib/utils';

// reputation contract error codes → calm human copy (lib.rs Error enum).
const CLAIM_ERRORS: Record<number, string> = {
  4: "This vouch doesn't exist or has expired.",
  5: 'This star is already lit — it was claimed already.',
  6: "You can't claim your own vouch. Share the link with someone you trust instead.",
  8: "This link's claim code is invalid.",
  9: 'Daily limit reached — try again tomorrow.',
};

/**
 * Claim funnel — the viral moment (00-strategy §3). A friend lands here from a shared
 * link. Value first (who vouched you), then one tap; the wallet is provisioned silently.
 */
export default function ClaimPage(props: { params: { id: string } }) {
  return (
    <Suspense fallback={null}>
      <ClaimInner {...props} />
    </Suspense>
  );
}

function ClaimInner({ params }: { params: { id: string } }) {
  const { id } = params;
  const secret = useSearchParams().get('s') ?? '';
  const { connect, profile } = useWallet();
  const [state, setState] = useState<'preview' | 'claiming' | 'done' | 'error'>('preview');
  const [error, setError] = useState<string | null>(null);

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
      await claimVouch(wallet, Number(id), secret);
      setState('done');
    } catch (e) {
      setError(humanizeError(e, CLAIM_ERRORS));
      setState('error');
    }
  }

  const done = state === 'done';

  return (
    <div className="container flex max-w-lg flex-col items-center gap-7 py-16 text-center">
      <h1 className="text-3xl font-semibold text-balance sm:text-4xl">
        {done ? "You're connected." : 'Someone vouched for you.'}
      </h1>
      <p className="max-w-sm text-muted-foreground text-balance">
        {done
          ? 'Your star just ignited — your constellation grew by one. Keep the sky alive: vouch someone back.'
          : 'They put their reputation behind yours. Claim your half of the sky — two halves become one card.'}
      </p>

      {/* The half-card: voucher's side filled, your side a glowing socket until claimed */}
      <div className="flex items-center gap-2 py-2">
        <div className="rounded-2xl border border-border bg-card p-5">
          <Crest address={`voucher-${id}`} size={96} points={6} animate />
          <p className="mt-2 text-xs text-muted-foreground">a friend</p>
        </div>
        <Sparkles className={cn('size-6 shrink-0', done ? 'text-primary' : 'text-muted-foreground')} />
        <div
          className={cn(
            'rounded-2xl border p-5 transition-all',
            done
              ? 'border-primary/40 bg-primary/5 shadow-glow-primary motion-safe:animate-ignite'
              : 'border-dashed border-border bg-card/30',
          )}
        >
          {done ? (
            <Crest address={profile?.address ?? `claimer-${id}-${secret.slice(0, 6)}`} size={96} points={6} animate />
          ) : (
            <div className="flex size-24 items-center justify-center text-xs text-muted-foreground">
              your half
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">{done ? 'you' : '— · —'}</p>
        </div>
      </div>

      {!done ? (
        <div className="flex flex-col items-center gap-3">
          <Button size="lg" onClick={onClaim} disabled={state === 'claiming'}>
            {state === 'claiming' ? 'Lighting your star…' : 'Claim your star'}
          </Button>
          {error && (
            <>
              <p className="max-w-xs text-sm text-destructive">{error}</p>
              <Link href="/app" className="text-xs text-muted-foreground underline">
                Open the app instead →
              </Link>
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <Link href="/app" className={cn(buttonVariants({ size: 'lg' }))}>
            {profile ? 'Now vouch someone back →' : 'Create your passport →'}
          </Link>
          {profile && (
            <Link href={`/u/${profile.handle}`} className="text-xs text-muted-foreground underline">
              View your passport
            </Link>
          )}
        </div>
      )}

      {!done && (
        <p className="max-w-xs text-xs text-muted-foreground text-balance">
          New here? There&apos;s nothing to install — we set up your passport, and fees are
          sponsored on testnet. No seed phrase.
        </p>
      )}
    </div>
  );
}
