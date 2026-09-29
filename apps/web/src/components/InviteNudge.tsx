'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Frame } from '@/components/fx/frame';
import { Sticker } from '@/components/ui/sticker';
import { useTranslations } from '@/lib/i18n';

/**
 * Invite nudge — if you arrived via a /v/<handle> link, the dashboard reminds you to
 * vouch your inviter back (closes the recruiting loop). Dismissable; clears the ref.
 */
export function InviteNudge() {
  const t = useTranslations();
  const [ref, setRef] = useState<string | null>(null);

  useEffect(() => {
    try {
      setRef(sessionStorage.getItem('alvinmunk.ref'));
    } catch {
      /* storage unavailable */
    }
  }, []);

  if (!ref) return null;

  function dismiss() {
    try {
      sessionStorage.removeItem('alvinmunk.ref');
    } catch {
      /* noop */
    }
    setRef(null);
  }

  return (
    <Frame label={t('inviteNudge.frame')} index="REF" accent="secondary">
      <div className="flex items-center justify-between gap-3 p-4">
        <Sticker name="hand-shake" size={48} className="hidden shrink-0 sm:block" />
        <p className="flex-1 text-sm">
          <span className="font-mono text-secondary">@{ref}</span> {t('inviteNudge.message')}
        </p>
        <button onClick={dismiss} aria-label={t('inviteNudge.dismiss')} className="shrink-0 text-muted-foreground hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>
    </Frame>
  );
}
