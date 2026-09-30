'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useWallet } from '@/components/wallet/wallet-provider';
import { normalizeHandle, type Profile } from '@/lib/profile';
import { humanizeError } from '@/lib/utils';
import { track, identify, trackError } from '@/lib/track';
import { useLocale, useTranslations } from '@/lib/i18n';
import type { FaceId } from '@/lib/avatar';
import type { Wallet } from '@/lib/wallet';

/** Where a create-profile flow runs from. Drives the `from` field on analytics events, and
 *  whether the claim page's own `onboard.claim.*` messages are used (see `messageKey`). */
export type CreateProfileSource = 'app' | 'landing' | 'claim';

/** `reserved`: freed recently and cooling down for its previous owner (see `reservedUntil`). */
export type HandleAvailability = 'idle' | 'checking' | 'free' | 'taken' | 'reserved';

export interface UseCreateProfileOptions {
  from: CreateProfileSource;
  /** Handle to start with (normalized), e.g. the one a "Claim @x" link on `/u/<x>` carries.
   *  Read once on mount; its availability check starts right away. */
  initialHandle?: string;
  /** Chosen avatar face, if the caller offers a face picker. */
  face?: FaceId;
  /** Called once the profile is stored — created, or restored because the address already
   *  held a handle. `landing-onboard.tsx` uses this to navigate into `/app`; other callers
   *  stay put — the claim page just hides the inline picker once `useWallet().profile` is set. */
  onCreated?: (profile: Profile) => void;
}

export interface UseCreateProfileResult {
  handle: string;
  setHandle: (h: string) => void;
  /** `normalizeHandle(handle)` — exposed so callers don't need to import/re-derive it. */
  normalizedHandle: string;
  avail: HandleAvailability;
  /** When a `reserved` handle opens up to everyone, as a localized date; null otherwise. */
  reservedUntil: string | null;
  creating: boolean;
  createProfile: () => Promise<void>;
  /** A `restoreAccount` is running. */
  restoring: boolean;
  /**
   * "I already have an account" (issue #278): pick an existing passkey — a synced one on a
   * new phone, a second browser, after clearing site data — instead of enrolling a new one,
   * and adopt the handle its account holds. Creates nothing. Only the app onboarding offers
   * it, so only `onboard.app.*` defines its `restoreNoHandle` / `restoreNotFound` messages.
   */
  restoreAccount: () => Promise<void>;
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
export function useCreateProfile({
  from,
  face,
  onCreated,
  initialHandle,
}: UseCreateProfileOptions): UseCreateProfileResult {
  const t = useTranslations();
  const { locale } = useLocale();
  const { wallet, connect, setProfile, restoreProfile } = useWallet();
  const [handle, setHandle] = useState(() => normalizeHandle(initialHandle ?? ''));
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [avail, setAvail] = useState<HandleAvailability>('idle');
  const [reservedUntil, setReservedUntil] = useState<string | null>(null);
  const normalizedHandle = normalizeHandle(handle);
  // A handle its holder just released or renamed away from stays reserved for them for a
  // while; the connected wallet (if any) is asked about, since it may be that previous owner.
  const address = wallet?.address;
  const day = useCallback(
    (d: Date) => d.toLocaleDateString(locale, { dateStyle: 'medium' }),
    [locale],
  );
  // Landing and /app onboarding share one `onboard.*` set; the claim page keeps its own copy.
  const messageKey = useCallback(
    (key: string) => (from === 'claim' ? `onboard.claim.${key}` : `onboard.${key}`),
    [from],
  );

  useEffect(() => {
    if (normalizedHandle.length < 3) {
      setAvail('idle');
      return;
    }
    setAvail('checking');
    let alive = true;
    const timer = setTimeout(() => {
      import('@/lib/registry')
        .then(({ handleAvailability }) => handleAvailability(normalizedHandle, address))
        .then((a) => {
          if (!alive) return;
          setAvail(a.status);
          setReservedUntil(a.status === 'reserved' ? day(a.until) : null);
        })
        .catch(() => alive && setAvail('idle'));
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [normalizedHandle, address, day]);

  /** The address already holds `p`'s handle, now adopted as the local profile. */
  const welcomeBack = useCallback(
    (w: Wallet, p: Profile) => {
      identify(w.address, { handle: p.handle, walletKind: w.kind });
      track('profile_restored', { walletKind: w.kind, from });
      toast.success(t(messageKey('restored'), { handle: p.handle }));
      onCreated?.(p);
    },
    [from, onCreated, t, messageKey],
  );

  const createProfile = useCallback(async () => {
    const h = normalizedHandle;
    if (h.length < 3) {
      toast.error(t(messageKey('errShort')));
      return;
    }
    setCreating(true);
    try {
      const { claimHandle, handleAvailability } = await import('@/lib/registry');
      // Reuse an already-connected wallet when there is one, so this never re-triggers
      // connect() / a second FaceID prompt (e.g. right after claimVouch on the claim page).
      const w = wallet ?? (await connect());
      // An address that already holds a handle keeps it (a returning user whose passkey synced
      // here, or a wallet that claimed one elsewhere): claiming would RENAME it. A strict read,
      // so a registry outage stops here instead of passing for "no handle".
      const held = await restoreProfile(w);
      if (held) {
        welcomeBack(w, held);
        return;
      }
      const a = await handleAvailability(h, w.address);
      if (a.status === 'reserved') {
        setAvail('reserved');
        setReservedUntil(day(a.until));
        toast.error(t(messageKey('errReserved'), { handle: h, date: day(a.until) }));
        return;
      }
      if (a.status === 'taken') {
        setAvail('taken');
        toast.error(t(messageKey('errTaken'), { handle: h }));
        return;
      }
      // Passkey accounts skip the classic-account genesis tx, so they never load its module.
      const tx =
        w.kind === 'passkey'
          ? undefined
          : await import('@/lib/genesis').then(({ recordGenesis }) => recordGenesis(w, h));
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
      toast.success(t(messageKey('success'), { handle: h }));
      onCreated?.(p);
    } catch (e) {
      console.error('🛑 createProfile failed →', e);
      trackError(e, { flow: 'create_profile', from });
      toast.error(humanizeError(e));
    } finally {
      setCreating(false);
    }
  }, [normalizedHandle, wallet, connect, setProfile, restoreProfile, welcomeBack, face, from, onCreated, t, day, messageKey]);

  const restoreAccount = useCallback(async () => {
    setRestoring(true);
    try {
      const w = await connect('recover');
      const held = await restoreProfile(w);
      // The account is there but never claimed a handle: it is connected now, so the form
      // finishes it on this same account.
      if (!held) {
        toast(t(`onboard.${from}.restoreNoHandle`));
        return;
      }
      welcomeBack(w, held);
    } catch (e) {
      // Already loaded by the connect above; dynamic for the same bundle reason as the rest.
      const { AccountNotFoundError } = await import('@/lib/wallet');
      if (e instanceof AccountNotFoundError) {
        toast.error(t(`onboard.${from}.restoreNotFound`));
        return;
      }
      console.error('🛑 restoreAccount failed →', e);
      trackError(e, { flow: 'restore_account', from });
      toast.error(humanizeError(e));
    } finally {
      setRestoring(false);
    }
  }, [connect, restoreProfile, welcomeBack, from, t]);

  return {
    handle,
    setHandle,
    normalizedHandle,
    avail,
    reservedUntil,
    creating,
    createProfile,
    restoring,
    restoreAccount,
  };
}
