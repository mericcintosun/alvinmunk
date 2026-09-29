'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Frame } from '@/components/fx/frame';
import { Sticker } from '@/components/ui/sticker';
import { useWallet } from '@/components/wallet/wallet-provider';
import { useTranslations } from '@/lib/i18n';
import { clearInviteRef, loadInviteRef, normalizeRefHandle } from '@/lib/invite-ref';

/**
 * Invite nudge — if you arrived via a /v/<handle> link, the dashboard reminds you to
 * vouch your inviter back (closes the recruiting loop). Dismissable; clears the ref.
 * Your own link (opened to preview it before sharing) is not an invite: that ref is
 * dropped instead of shown.
 */
export function InviteNudge() {
  const t = useTranslations();
  const { profile } = useWallet();
  const ownHandle = profile ? normalizeRefHandle(profile.handle) : null;
  const [ref, setRef] = useState<string | null>(null);

  useEffect(() => {
    if (!ownHandle) return; // nothing to compare the ref against yet
    const stored = loadInviteRef();
    if (stored === ownHandle) {
      clearInviteRef();
      setRef(null);
      return;
    }
    setRef(stored);
  }, [ownHandle]);

  if (!ref) return null;

  function dismiss() {
    clearInviteRef();
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
