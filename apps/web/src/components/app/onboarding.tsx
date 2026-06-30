'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useWallet } from '@/components/wallet/wallet-provider';
import { recordGenesis } from '@/lib/genesis';
import { claimHandle, isHandleAvailable } from '@/lib/registry';
import { normalizeHandle, type Profile } from '@/lib/profile';
import { humanizeError } from '@/lib/utils';
import { Crest } from '@/components/brand/crest';
import { AvatarPicker } from '@/components/AvatarPicker';
import { type FaceId } from '@/lib/avatar';
import { asset } from '@/lib/assets';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Onboarding — the no-profile state of the app. Pick a handle + a face and we silently
 * provision a testnet wallet, fund it, write the genesis tx, and stamp the handle on-chain.
 * No "connect wallet", no "mint", no seed phrase.
 */
export function Onboarding() {
  const { connect, setProfile } = useWallet();
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

  async function createProfile() {
    const h = normalizeHandle(handle);
    if (h.length < 3) {
      toast.error('Pick a handle — 3+ letters or numbers.');
      return;
    }
    setCreating(true);
    try {
      const w = await connect();
      // The handle becomes your PUBLIC profile ID, so it must be free on-chain.
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
      toast.success(`Your profile is live — @${h} stamped on-chain.`);
    } catch (e) {
      // Surface the FULL error (diagnostic events name the failing contract/value).
      console.error('🛑 createProfile failed →', e);
      toast.error(humanizeError(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="relative container flex max-w-md flex-col items-center gap-8 py-20">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.05] [mask-image:radial-gradient(circle_at_top,black,transparent_70%)]"
        style={{ backgroundImage: `url(${asset('backgrounds/app-bg.png')})`, backgroundSize: 'cover', backgroundPosition: 'top' }}
      />
      <div className="text-center">
        <p className="eyebrow mb-3">Step 1 of 1</p>
        <h1 className="text-3xl font-semibold">Create your profile</h1>
        <p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground text-balance">
          Pick a handle — we set everything up for you. Your first star is one tap away.
        </p>
      </div>

      <Crest address={handle ? `profile-${handle}` : 'new-profile'} size={160} points={6} animate />

      <div className="flex flex-col items-center gap-2">
        <p className="text-xs font-medium text-muted-foreground">Pick your face</p>
        <AvatarPicker value={face} onChange={setFace} size={48} />
      </div>

      <form
        className="flex w-full flex-col items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void createProfile();
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
          {avail === 'checking' && <span className="text-muted-foreground">Checking…</span>}
          {avail === 'free' && <span className="text-secondary">✓ @{normalizeHandle(handle)} is free</span>}
          {avail === 'taken' && <span className="text-destructive">@{normalizeHandle(handle)} is taken — try another</span>}
        </p>
        <Button type="submit" size="lg" disabled={creating || avail === 'taken'} className="w-full">
          {creating ? 'Creating your profile…' : 'Create my profile'}
        </Button>
      </form>

      <p className="text-center text-xs text-muted-foreground text-balance">
        Saved on this device · fees sponsored on testnet · no seed phrase.
      </p>
    </div>
  );
}
