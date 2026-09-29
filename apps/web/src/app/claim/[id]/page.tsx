'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { shortAddr } from '@alvinmunk/shared';
import { useWallet } from '@/components/wallet/wallet-provider';
import {
  claimVouch,
  claimVouchSigned,
  getVouch,
  isClaimCode,
  parseClaimCode,
  VOUCH_TTL_SECS,
  type ClaimCode,
  type VouchView,
} from '@/lib/reputation';
import { getMeta, reverseHandle } from '@/lib/registry';
import { Avatar } from '@/components/Avatar';
import type { AvatarConfig } from '@/lib/avatar';
import { Crest } from '@/components/brand/crest';
import { Frame } from '@/components/fx/frame';
import { Stamp } from '@/components/fx/stamp';
import { BorderBeam } from '@/components/fx/border-beam';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StateArt } from '@/components/ui/state-art';
import { Sticker } from '@/components/ui/sticker';
import { Input } from '@/components/ui/input';
import { useCreateProfile } from '@/hooks/use-create-profile';
import { useTranslations } from '@/lib/i18n';
import { cn, humanizeError, withTimeout } from '@/lib/utils';

/** Read the claim code from the URL: the claim key's seed (#k=…) on current links, the
 *  plain secret (#s=…, or the older ?s= query) on links to cards minted before the key.
 *  The fragment never reaches the server. */
function readClaimCode(): ClaimCode | null {
  if (typeof window === 'undefined') return null;
  return parseClaimCode(window.location.hash, window.location.search);
}

const BAD_CODE = "This link's claim code is invalid.";

const CLAIM_ERRORS: Record<number, string> = {
  4: "This vouch doesn't exist or has expired.",
  5: 'This star is already lit — it was claimed already.',
  6: "You can't claim your own vouch. Share the link with someone you trust instead.",
  8: BAD_CODE,
  9: 'Daily limit reached — try again tomorrow.',
  13: "This link doesn't fit this vouch — ask the person who sent it to share it again.",
};

/** A claim signature that doesn't verify traps in the host (Error(Crypto, …)), not with a
 *  contract code: the link's key isn't this card's, or the link was cut short. */
function claimErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? '');
  return raw.includes('Error(Crypto,') ? BAD_CODE : humanizeError(e, CLAIM_ERRORS);
}

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
  const t = useTranslations();
  const [claimCode, setClaimCode] = useState<ClaimCode | null>(null);
  const [state, setState] = useState<'preview' | 'claiming' | 'done' | 'error'>('preview');
  const [error, setError] = useState<string | null>(null);
  const [vouch, setVouch] = useState<VouchView | null | undefined>(undefined);
  // Distinguish "couldn't read the chain" (retryable) from "this vouch doesn't exist"
  // so a slow/failing RPC never masquerades as an expired or missing vouch.
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  /** @handle of the voucher (null = none or lookup still in flight). Never blocks the claim. */
  const [voucherHandle, setVoucherHandle] = useState<string | null>(null);
  /** The voucher's published face (undefined = none / still loading → deterministic default). */
  const [voucherAvatar, setVoucherAvatar] = useState<AvatarConfig | undefined>(undefined);

  useEffect(() => setClaimCode(readClaimCode()), []);

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

  // Who vouched (#218): the voucher's @handle and face, looked up after the vouch loads and
  // fire-and-forget — a slow or failing read only keeps the address fallback; it never
  // blocks or delays the Claim button.
  useEffect(() => {
    const from = vouch?.from;
    if (!from) return;
    let alive = true;
    reverseHandle(from)
      .then((h) => alive && setVoucherHandle(h))
      .catch(() => {});
    getMeta(from)
      .then((meta) => alive && setVoucherAvatar(meta?.avatar))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [vouch?.from]);

  const nowSec = Math.floor(Date.now() / 1000);
  const deadline = vouch ? vouch.created + VOUCH_TTL_SECS : 0;
  const daysLeft = vouch ? Math.max(0, Math.ceil((deadline - nowSec) / 86_400)) : 0;
  const windowOpen = vouch ? !vouch.slashed && !vouch.claimed && nowSec < deadline : false;

  async function onClaim() {
    if (!claimCode) {
      setError('This link is missing its claim code.');
      setState('error');
      return;
    }
    if (!isClaimCode(claimCode.code)) {
      setError(BAD_CODE);
      setState('error');
      return;
    }
    setState('claiming');
    setError(null);
    try {
      const wallet = await connect();
      // The seed only signs here; the transaction carries a signature bound to this wallet.
      if (claimCode.kind === 'key') await claimVouchSigned(wallet, vid, claimCode.code);
      else await claimVouch(wallet, vid, claimCode.code);
      setState('done');
      // Fire-and-forget push notification to the voucher — no await so it never
      // blocks the success UX. Silently ignored if push infra is not configured.
      if (vouch?.from) {
        fetch('/api/push/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vouchId: vid,
            voucherAddress: vouch.from,
            note: vouch.note ?? undefined,
          }),
        }).catch(() => {});
      }
    } catch (e) {
      setError(claimErrorMessage(e));
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
        {done
          ? "You're connected."
          : voucherHandle
            ? t('claim.voucher.headlineHandle', { handle: voucherHandle })
            : t('claim.voucher.headlineFallback')}
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
            {vouch ? (
              <Avatar address={vouch.from} avatar={voucherAvatar} handle={voucherHandle ?? undefined} size={88} />
            ) : (
              <Crest address={`voucher-${id}`} size={88} points={6} animate />
            )}
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {voucherHandle ? `@${voucherHandle}` : vouch ? shortAddr(vouch.from) : 'from'}
            </span>
            {voucherHandle && vouch && !done && (
              <Link
                href={`/u/${voucherHandle}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[9px] uppercase tracking-wider text-primary/70 underline underline-offset-2 hover:text-primary transition-colors"
              >
                {t('claim.voucher.viewProfile', { handle: voucherHandle })}
              </Link>
            )}
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
              Nothing to install — we set up your profile, fees sponsored on testnet. No seed phrase.
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <div className="relative self-stretch">
              <StateArt kind="claim-success" size={220} className="mx-auto motion-safe:animate-ignite" />
              <Sticker name="stamp-verified" size={88} rotate={-8} className="absolute -right-1 top-0 motion-safe:animate-ignite" />
            </div>
            <Stamp accent="secondary">✦ STAR IGNITED</Stamp>
            {/* The peak emotional moment → the share. People share a nice thing said ABOUT them,
                not a number. Carry the praise line + link to their public constellation (OG card). */}
            {vouch?.note && (
              <p className="max-w-xs text-sm italic text-foreground/85">&ldquo;{vouch.note}&rdquo;</p>
            )}
            <a
              href={`https://twitter.com/intent/tweet?${new URLSearchParams({
                text: vouch?.note
                  ? `Someone just vouched for me on alvinmunk 🌟 "${vouch.note}" — reputation has a face, not a number. Collect people, not points:`
                  : 'My star just ignited on alvinmunk 🌟 — reputation has a face, not a number. Collect people, not points:',
                url: `${typeof window !== 'undefined' ? window.location.origin : ''}${profile ? `/u/${profile.handle}` : '/'}`,
              }).toString()}`}
              target="_blank"
              rel="noreferrer"
              className={cn(buttonVariants({ variant: 'flow', size: 'lg' }))}
            >
              Share your star <ArrowRight className="size-4" />
            </a>

            {/* Inline handle picker — the claimer just got a wallet, so they can pick
                a name without a second connect or FaceID prompt. */}
            {!profile && <ClaimHandlePicker />}

            {/* Skipping naming still leaves a valid claim; the old "Create your profile"
                path (and, for a returning user, their profile) both stay reachable. */}
            <Link href="/app" className="font-mono text-xs text-muted-foreground underline">
              {profile ? t('claim.openApp') : t('claim.skip')}
            </Link>
            {profile && (
              <Link href={`/u/${profile.handle}`} className="font-mono text-xs text-muted-foreground underline">
                {t('claim.viewProfile')}
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ClaimHandlePicker() {
  const t = useTranslations();
  const { handle, setHandle, avail, reservedUntil, creating, createProfile, normalizedHandle } =
    useCreateProfile({ from: 'claim' });

  return (
    <form
      className="flex w-full flex-col gap-2 rounded-2xl border border-border/60 bg-surface/30 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void createProfile();
      }}
    >
      <p className="text-sm font-medium">{t('claim.handle.title')}</p>
      <p className="text-xs text-muted-foreground">{t('claim.handle.subtitle')}</p>
      <div className="flex items-center gap-2">
        <span className="text-lg text-muted-foreground">@</span>
        <Input
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder={t('claim.handle.placeholder')}
          aria-label={t('claim.handle.ariaLabel')}
          aria-describedby="claim-handle-status"
          className="flex-1"
        />
      </div>
      <p id="claim-handle-status" aria-live="polite" className="h-4 text-xs">
        {avail === 'checking' && <span className="text-muted-foreground">{t('claim.handle.checking')}</span>}
        {avail === 'free' && <span className="text-secondary">{t('claim.handle.free', { handle: normalizedHandle })}</span>}
        {avail === 'taken' && <span className="text-destructive">{t('claim.handle.taken', { handle: normalizedHandle })}</span>}
        {avail === 'reserved' && reservedUntil && <span className="text-destructive">{t('claim.handle.reserved', { handle: normalizedHandle, date: reservedUntil })}</span>}
      </p>
      <Button type="submit" variant="flow" size="lg" disabled={creating || avail === 'taken' || avail === 'reserved' || normalizedHandle.length < 3}>
        {creating ? t('claim.handle.submitting') : t('claim.handle.submit', { handle: normalizedHandle || 'handle' })}
      </Button>
    </form>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3 text-center">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-xs text-foreground">{value}</span>
    </div>
  );
}
