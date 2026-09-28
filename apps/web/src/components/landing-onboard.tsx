'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { useWallet } from '@/components/wallet/wallet-provider';
import { normalizeHandle, type Profile } from '@/lib/profile';
import { humanizeError } from '@/lib/utils';
import { track, identify, trackError } from '@/lib/track';
import { useTranslations } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * One-field onboarding, right on the landing hero. Type a handle, tap once, and we silently
 * provision a wallet (Face ID / dev), fund it, write genesis, and stamp the handle on-chain,
 * then drop you into the app. Returning users just get a shortcut into their app.
 *
 * NOTE: the heavy chain (registry → contracts → wallet → stellar-sdk) is DYNAMICALLY imported
 * inside the handlers. Statically importing it into this client component would pull stellar-sdk
 * into the server-rendered landing page and break the client-reference (renders as undefined).
 */
export function LandingOnboard() {
  const t = useTranslations();
  const { profile, connect, setProfile } = useWallet();
  const router = useRouter();
  const [handle, setHandle] = useState('');
  const [busy, setBusy] = useState(false);
  const [avail, setAvail] = useState<'idle' | 'checking' | 'free' | 'taken'>('idle');

  useEffect(() => {
    const h = normalizeHandle(handle);
    if (h.length < 3) return setAvail('idle');
    setAvail('checking');
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const { isHandleAvailable } = await import('@/lib/registry');
        const free = await isHandleAvailable(h);
        if (alive) setAvail(free ? 'free' : 'taken');
      } catch {
        if (alive) setAvail('idle');
      }
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [handle]);

  // Returning user: skip straight to the app.
  if (profile) {
    return (
      <Link href="/app" className="inline-flex">
        <Button variant="flow" size="lg">
          {t('onboard.landing.openApp')} <ArrowRight className="size-4" />
        </Button>
      </Link>
    );
  }

  async function createProfile() {
    const h = normalizeHandle(handle);
    if (h.length < 3) return toast.error(t('onboard.landing.errShort'));
    setBusy(true);
    try {
      const [{ recordGenesis }, { claimHandle, isHandleAvailable }] = await Promise.all([
        import('@/lib/genesis'),
        import('@/lib/registry'),
      ]);
      const w = await connect();
      if (!(await isHandleAvailable(h))) {
        toast.error(t('onboard.landing.errTaken', { handle: h }));
        return;
      }
      const tx = w.kind === 'passkey' ? undefined : await recordGenesis(w, h);
      await claimHandle(w, h);
      const p: Profile = { handle: h, address: w.address, createdAt: Date.now(), genesisTx: tx };
      setProfile(p);
      identify(w.address, { handle: h, walletKind: w.kind });
      track('profile_created', { walletKind: w.kind, from: 'landing' });
      toast.success(t('onboard.landing.success', { handle: h }));
      router.push('/app');
    } catch (e) {
      console.error('🛑 landing onboard failed →', e);
      trackError(e, { flow: 'landing_onboard' });
      toast.error(humanizeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="w-full max-w-md"
      onSubmit={(e) => {
        e.preventDefault();
        void createProfile();
      }}
    >
      <div className="glass flex items-center gap-2 rounded-full p-1.5 focus-within:ring-2 focus-within:ring-ring/40">
        <span className="pl-3 text-lg text-muted-foreground">@</span>
        <Input
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder={t('onboard.landing.placeholder')}
          aria-label={t('onboard.landing.ariaLabel')}
          aria-describedby="landing-handle-status"
          className="h-11 flex-1 border-0 bg-transparent focus-visible:ring-0"
        />
        <Button type="submit" variant="flow" size="md" disabled={busy || avail === 'taken'} className="shrink-0">
          {busy ? t('onboard.landing.creating') : t('onboard.landing.startFree')}
          {!busy && <ArrowRight className="size-4" />}
        </Button>
      </div>
      <p id="landing-handle-status" aria-live="polite" className="mt-2 h-4 pl-4 text-xs">
        {avail === 'checking' && <span className="text-muted-foreground">{t('onboard.landing.checking')}</span>}
        {avail === 'free' && <span className="text-secondary">{t('onboard.landing.handleFree', { handle: normalizeHandle(handle) })}</span>}
        {avail === 'taken' && <span className="text-destructive">{t('onboard.landing.handleTaken', { handle: normalizeHandle(handle) })}</span>}
        {avail === 'idle' && <span className="text-muted-foreground">{t('onboard.landing.pill')}</span>}
      </p>
    </form>
  );
}
