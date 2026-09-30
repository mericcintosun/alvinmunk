'use client';

import { useState } from 'react';
import { useCreateProfile } from '@/hooks/use-create-profile';
import { HANDLE_MAX_CHARS, normalizeHandle } from '@/lib/profile';
import { useTranslations } from '@/lib/i18n';
import { Crest } from '@/components/brand/crest';
import { AvatarPicker } from '@/components/AvatarPicker';
import { type FaceId } from '@/lib/avatar';
import { asset } from '@/lib/assets';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { HandleHint } from '@/components/handle-hint';

/** `initialHandle`: prefilled from `/app?handle=<x>` (the "Claim @x" link on `/u/<x>`). */
export function Onboarding({ initialHandle }: { initialHandle?: string }) {
  const t = useTranslations();
  const [face, setFace] = useState<FaceId | undefined>();
  const { handle, setHandle, avail, reservedUntil, creating, createProfile, restoring, restoreAccount } =
    useCreateProfile({
      from: 'app',
      face,
      initialHandle,
    });

  return (
    <div className="relative container flex max-w-md flex-col items-center gap-8 py-20">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.05] [mask-image:radial-gradient(circle_at_top,black,transparent_70%)]"
        style={{ backgroundImage: `url(${asset('backgrounds/tile-256.png')})`, backgroundSize: '180px' }}
      />
      <div className="text-center">
        <p className="eyebrow mb-3">{t('onboard.eyebrow')}</p>
        <h1 className="text-3xl font-semibold">{t('onboard.title')}</h1>
        <p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground text-balance">
          {t('onboard.subtitle')}
        </p>
      </div>

      <Crest address={handle ? `profile-${handle}` : 'new-profile'} size={160} points={6} animate />

      <div className="flex flex-col items-center gap-2">
        <p className="text-xs font-medium text-muted-foreground">{t('onboard.pickFace')}</p>
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
          placeholder={t('onboard.placeholder')}
          className="text-center"
          aria-label={t('onboard.ariaLabel')}
          aria-describedby="handle-status handle-rules"
          maxLength={HANDLE_MAX_CHARS}
        />
        <HandleHint id="handle-rules" value={handle} className="text-center" />
        <p id="handle-status" aria-live="polite" className="min-h-4 text-center text-xs">
          {avail === 'checking' && <span className="text-muted-foreground">{t('onboard.checking')}</span>}
          {avail === 'free' && <span className="text-secondary">{t('onboard.handleFree', { handle: normalizeHandle(handle) })}</span>}
          {avail === 'taken' && <span className="text-destructive">{t('onboard.handleTaken', { handle: normalizeHandle(handle) })}</span>}
          {avail === 'reserved' && reservedUntil && <span className="text-destructive">{t('onboard.handleReserved', { handle: normalizeHandle(handle), date: reservedUntil })}</span>}
        </p>
        <Button
          type="submit"
          size="lg"
          disabled={creating || restoring || avail === 'taken' || avail === 'reserved'}
          className="w-full"
        >
          {creating ? t('onboard.creating') : t('onboard.submit')}
        </Button>
      </form>

      <div className="flex flex-col items-center gap-1.5">
        <p className="text-xs text-muted-foreground">{t('onboard.app.or')}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={creating || restoring}
          onClick={() => void restoreAccount()}
        >
          {restoring ? t('onboard.app.restoring') : t('onboard.app.restore')}
        </Button>
      </div>

      <p className="text-center text-xs text-muted-foreground text-balance">
        {t('onboard.footer')}
      </p>
    </div>
  );
}
