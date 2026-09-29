'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useWallet } from '@/components/wallet/wallet-provider';
import { normalizeHandle, type Profile } from '@/lib/profile';
import { humanizeError } from '@/lib/utils';
import { track, identify, trackError } from '@/lib/track';
import { useTranslations } from '@/lib/i18n';
import type { FaceId } from '@/lib/avatar';

/** Where a create-profile flow runs from. Drives both the `onboard.<from>.*` i18n keys
 *  and the `from` field on the `profile_created` track event. */
export type CreateProfileSource = 'app' | 'landing' | 'claim';

export type HandleAvailability = 'idle' | 'checking' | 'free' | 'taken';

export interface UseCreateProfileOptions {
  from: CreateProfileSource;
  /** Chosen avatar face, if the caller offers a face picker (only `onboarding.tsx` does). */
  face?: FaceId;
  /** Called once the profile has been created and stored. `landing-onboard.tsx` uses this
   *  to navigate into `/app`; other callers stay put — the claim page just hides the inline
   *  picker once `useWallet().profile` is set. */
  onCreated?: (profile: Profile) => void;
}

export interface UseCreateProfileResult {
  handle: string;
  setHandle: (h: string) => void;
  /** `normalizeHandle(handle)` — exposed so callers don't need to import/re-derive it. */
  normalizedHandle: string;
  avail: HandleAvailability;
  creating: boolean;
  createProfile: () => Promise<void>;
}

/**
 * The create-profile flow shared by `onboarding.tsx`, `landing-onboard.tsx` and the claim
 * page's inline handle picker (issue #268): debounced availability check, on-chain genesis
 * + claim, and the toast/track/identify side effects — kept in one place so the three flows
 * can't drift out of sync again.
 *
 * IMPORTANT — never re-prompts a wallet: this hook reuses `useWallet().wallet` when the
 * caller already has one connected (e.g. the claim page just connected to submit
 * `claimVouch`), and only falls back to `connect()` when there is none yet. That is what
 * keeps the claim page's inline picker from triggering a second connect / FaceID prompt.
 *
 * The chain modules (`lib/genesis`, `lib/registry`) are dynamically imported inside the
 * effect/callback, never at module scope — `landing-onboard.tsx` renders on the
 * server-rendered marketing page, and a static import here would pull stellar-sdk into
 * that bundle (see the NOTE in `landing-onboard.tsx`).
 */
export function useCreateProfile({ from, face, onCreated }: UseCreateProfileOptions): UseCreateProfileResult {
  const t = useTranslations();
  const { wallet, connect, setProfile } = useWallet();
  const [handle, setHandle] = useState('');
  const [creating, setCreating] = useState(false);
  const [avail, setAvail] = useState<HandleAvailability>('idle');
  const normalizedHandle = normalizeHandle(handle);

  useEffect(() => {
    if (normalizedHandle.length < 3) {
      setAvail('idle');
      return;
    }
    setAvail('checking');
    let alive = true;
    const timer = setTimeout(() => {
      import('@/lib/registry')
        .then(({ isHandleAvailable }) => isHandleAvailable(normalizedHandle))
        .then((free) => alive && setAvail(free ? 'free' : 'taken'))
        .catch(() => alive && setAvail('idle'));
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [normalizedHandle]);

  const createProfile = useCallback(async () => {
    const h = normalizedHandle;
    if (h.length < 3) {
      toast.error(t(`onboard.${from}.errShort`));
      return;
    }
    setCreating(true);
    try {
      const [{ recordGenesis }, { claimHandle, isHandleAvailable }] = await Promise.all([
        import('@/lib/genesis'),
        import('@/lib/registry'),
      ]);
      // Reuse an already-connected wallet when there is one, so this never re-triggers
      // connect() / a second FaceID prompt (e.g. right after claimVouch on the claim page).
      const w = wallet ?? (await connect());
      if (!(await isHandleAvailable(h))) {
        setAvail('taken');
        toast.error(t(`onboard.${from}.errTaken`, { handle: h }));
        return;
      }
      const tx = w.kind === 'passkey' ? undefined : await recordGenesis(w, h);
      await claimHandle(w, h);
      const p: Profile = {
        handle: h,
        address: w.address,
        createdAt: Date.now(),
        genesisTx: tx,
        avatar: face ? { kind: 'face', id: face } : undefined,
        source: from,
      };
      setProfile(p);
      identify(w.address, { handle: h, walletKind: w.kind });
      track('profile_created', { walletKind: w.kind, from });
      toast.success(t(`onboard.${from}.success`, { handle: h }));
      onCreated?.(p);
    } catch (e) {
      console.error('🛑 createProfile failed →', e);
      trackError(e, { flow: 'create_profile', from });
      toast.error(humanizeError(e));
    } finally {
      setCreating(false);
    }
  }, [normalizedHandle, wallet, connect, setProfile, face, from, onCreated, t]);

  return { handle, setHandle, normalizedHandle, avail, creating, createProfile };
}
