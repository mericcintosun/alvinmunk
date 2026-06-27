'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { toast } from 'sonner';
import { useWallet } from '@/components/wallet/wallet-provider';
import { recordGenesis } from '@/lib/genesis';
import { claimHandle, isHandleAvailable } from '@/lib/registry';
import { normalizeHandle, type Profile } from '@/lib/profile';
import { humanizeError } from '@/lib/utils';
import { Crest } from '@/components/brand/crest';
import { AvatarPicker } from '@/components/AvatarPicker';
import { type FaceId } from '@/lib/avatar';
import { asset, BRAND } from '@/lib/assets';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { IdentityBar } from '@/components/IdentityBar';
import { InviteNudge } from '@/components/InviteNudge';
import { PendingHalfCards } from '@/components/PendingHalfCards';
import { ActivityFeed } from '@/components/ActivityFeed';
import { VouchCompose } from '@/components/VouchCompose';
import { Quests } from '@/components/Quests';
import { Unlockables } from '@/components/Unlockables';
import { Tip } from '@/components/Tip';
import { Rewards } from '@/components/Rewards';

// three.js stays out of SSR + the marketing bundle — lazy, client-only.
const ConstellationHero3D = dynamic(() => import('@/components/brand/constellation-3d'), {
  ssr: false,
  loading: () => (
    <div className="aurora flex h-[58vh] max-h-[560px] min-h-[400px] w-full items-center justify-center rounded-3xl border border-border/60">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={asset(BRAND['logo-mark'].file)}
        alt=""
        width={48}
        height={68}
        className="select-none opacity-80 motion-safe:animate-breathe"
      />
    </div>
  ),
});

export default function AppHome() {
  const { profile, connect, setProfile } = useWallet();
  const [handle, setHandle] = useState('');
  const [creating, setCreating] = useState(false);
  const [face, setFace] = useState<FaceId | undefined>();
  // Live availability so the user learns "taken" while typing, not after a 2s submit.
  const [avail, setAvail] = useState<'idle' | 'checking' | 'free' | 'taken'>('idle');

  useEffect(() => {
    const h = normalizeHandle(handle);
    if (h.length < 3) {
      setAvail('idle');
      return;
    }
    setAvail('checking');
    let alive = true;
    const t = setTimeout(() => {
      isHandleAvailable(h)
        .then((free) => alive && setAvail(free ? 'free' : 'taken'))
        .catch(() => alive && setAvail('idle'));
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [handle]);

  // Invisible wallet: one step. Pick a handle → we silently provision a testnet wallet,
  // fund it, and write the genesis tx. No "connect wallet", no "mint", no jargon.
  async function createPassport() {
    const h = normalizeHandle(handle);
    if (h.length < 3) {
      toast.error('Pick a handle — 3+ letters or numbers.');
      return;
    }
    setCreating(true);
    try {
      const w = await connect();
      // The handle becomes your PUBLIC passport ID, so it must be free on-chain.
      if (!(await isHandleAvailable(h))) {
        toast.error(`@${h} is taken — pick another.`);
        return;
      }
      // Genesis is a classic manageData op (needs a G… source) — passkey smart accounts
      // (C…) can't author it, so we skip it there; the registry claim below IS the
      // on-chain identity binding for every wallet kind.
      const tx = w.kind === 'passkey' ? undefined : await recordGenesis(w, h);
      await claimHandle(w, h); // stamp the handle to chain (registry)
      const p: Profile = {
        handle: h,
        address: w.address,
        createdAt: Date.now(),
        genesisTx: tx,
        avatar: face ? { kind: 'face', id: face } : undefined,
      };
      setProfile(p);
      toast.success(`Your passport is live — @${h} stamped on-chain.`);
    } catch (e) {
      // Surface the FULL error (diagnostic events name the failing contract/value) —
      // toasts truncate and console is noisy with wallet-extension logs.
      console.error('🛑 createPassport failed →', e);
      toast.error(humanizeError(e));
    } finally {
      setCreating(false);
    }
  }

  // ─── Onboarding (no profile yet) ───
  if (!profile) {
    return (
      <div className="relative container flex max-w-md flex-col items-center gap-8 py-20">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 opacity-[0.05] [mask-image:radial-gradient(circle_at_top,black,transparent_70%)]"
          style={{ backgroundImage: `url(${asset('backgrounds/app-bg.png')})`, backgroundSize: 'cover', backgroundPosition: 'top' }}
        />
        <div className="text-center">
          <h1 className="text-3xl font-semibold">Create your passport</h1>
          <p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground text-balance">
            Pick a handle — we set everything up for you. Your first star is one tap away.
          </p>
        </div>

        <Crest address={handle ? `passport-${handle}` : 'new-passport'} size={160} points={6} animate />

        <div className="flex flex-col items-center gap-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            pick your face
          </p>
          <AvatarPicker value={face} onChange={setFace} size={48} />
        </div>

        <form
          className="flex w-full flex-col items-center gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void createPassport();
          }}
        >
          <Input
            autoFocus
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="your handle"
            className="text-center"
            aria-label="Handle"
            aria-describedby="handle-status"
          />
          <p id="handle-status" aria-live="polite" className="h-4 text-xs">
            {avail === 'checking' && <span className="text-muted-foreground">checking…</span>}
            {avail === 'free' && <span className="text-secondary">✓ @{normalizeHandle(handle)} is free</span>}
            {avail === 'taken' && <span className="text-destructive">@{normalizeHandle(handle)} is taken — try another</span>}
          </p>
          <Button type="submit" size="lg" disabled={creating || avail === 'taken'} className="w-full">
            {creating ? 'Creating your passport…' : 'Create my passport'}
          </Button>
        </form>

        <p className="text-center text-xs text-muted-foreground text-balance">
          Saved on this device · fees sponsored on testnet · no seed phrase.
        </p>
      </div>
    );
  }

  // ─── Dashboard ───
  return (
    <div className="container max-w-3xl py-8">
      {/* IDENTITY — @handle (claim/edit) + share + public link */}
      <IdentityBar />

      {/* HERO — your living 3D constellation */}
      <ConstellationHero3D address={profile.address} handle={profile.handle} />

      <div className="mt-8 grid gap-4">
        {/* INVITE — if you arrived via /v/<handle>, vouch your inviter back */}
        <InviteNudge />
        {/* RE-ENGAGEMENT — your unclaimed half-cards (stake at risk) */}
        <PendingHalfCards />
        {/* SOCIAL PROOF — the sky is moving */}
        <ActivityFeed />
        {/* PRIMARY — vouch = the viral install loop */}
        <VouchCompose />
        <Quests address={profile.address} />
        {/* CAPABILITY — reputation unlocks access (composable gates) */}
        <Unlockables address={profile.address} />
        <div className="mt-2">
          <p className="mb-3 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
            Spend
          </p>
          <div className="grid gap-4">
            <Tip address={profile.address} />
            <Rewards address={profile.address} />
          </div>
        </div>
      </div>
    </div>
  );
}
