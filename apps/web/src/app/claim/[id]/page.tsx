'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { useWallet } from '@/components/wallet/wallet-provider';
import { claimVouch } from '@/lib/reputation';
import { Crest } from '@/components/brand/crest';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Claim funnel — the viral moment (00-strategy §3). A non-crypto friend lands here from a
 * shared link: "Someone vouched for you. Claim your half of the sky." Works logged-out;
 * the value (who vouched you) is shown before any wallet friction.
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
  const { connect } = useWallet();
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
      setError(e instanceof Error ? e.message : 'Claim failed');
      setState('error');
    }
  }

  const done = state === 'done';

  return (
    <div className="container flex max-w-lg flex-col items-center gap-8 py-16 text-center">
      <h1 className="text-3xl font-semibold text-balance">
        {done ? "You're connected." : 'Someone vouched for you.'}
      </h1>
      <p className="max-w-sm text-muted-foreground text-balance">
        {done
          ? 'Your star just ignited. Keep the sky growing — vouch someone back.'
          : 'Claim your half of the sky. Two halves become one card.'}
      </p>

      {/* The half-card: voucher's side filled, your side a glowing socket until claimed */}
      <div className="flex items-center gap-2">
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
            <Crest address={`claimer-${id}-${secret.slice(0, 6)}`} size={96} points={6} animate />
          ) : (
            <div className="flex size-24 items-center justify-center text-xs text-muted-foreground">
              your half
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">{done ? 'you' : '— · —'}</p>
        </div>
      </div>

      {!done ? (
        <Button size="lg" onClick={onClaim} disabled={state === 'claiming'}>
          {state === 'claiming' ? 'Lighting your star…' : 'Claim your star'}
        </Button>
      ) : (
        <Link href="/app" className={cn(buttonVariants({ size: 'lg' }))}>
          Now vouch someone back →
        </Link>
      )}

      {error && <p className="max-w-xs text-sm text-destructive">{error}</p>}

      <p className="text-xs text-muted-foreground">
        Fees are sponsored on testnet — no gas, no seed phrase.
      </p>
    </div>
  );
}
