'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Frame } from '@/components/fx/frame';
import { Button } from '@/components/ui/button';
import { Sticker } from '@/components/ui/sticker';
import { useWallet } from '@/components/wallet/wallet-provider';
import { useTranslations } from '@/lib/i18n';
import { clearInviteRef, loadInviteRef, normalizeRefHandle } from '@/lib/invite-ref';
import { getInvitedBy } from '@/lib/registry';

/**
 * Invite nudge — if you arrived via a /v/<handle> link, the dashboard reminds you to
 * vouch your inviter back (closes the recruiting loop). Dismissable; clears the ref.
 * Your own link (opened to preview it before sharing) is not an invite: that ref is
 * dropped instead of shown. Once the inviter is bound on-chain (`invited_by` is set,
 * done during onboarding) the nudge hides itself — the graph already has the edge,
 * only the vouch-back remains.
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

  // Hide once the invite edge exists on-chain: the graph has it, only vouch-back remains.
  const address = profile?.address;
  const [bound, setBound] = useState(false);
  useEffect(() => {
    if (!address) return;
    let alive = true;
    getInvitedBy(address).then((inv) => alive && setBound(Boolean(inv)));
    return () => {
      alive = false;
    };
  }, [address]);

  if (!ref || bound) return null;

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
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={dismiss}
          aria-label={t('inviteNudge.dismiss')}
          className="-m-2 shrink-0 text-muted-foreground"
        >
          <X />
        </Button>
      </div>
    </Frame>
  );
}
