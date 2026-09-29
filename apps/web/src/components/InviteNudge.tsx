'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Frame } from '@/components/fx/frame';
import { Sticker } from '@/components/ui/sticker';
import { readRefHandle } from '@/lib/invite';
import { getInvitedBy } from '@/lib/registry';
import { useWallet } from '@/components/wallet/wallet-provider';

/**
 * Invite nudge — if you arrived via a /v/<handle> link, the dashboard reminds you to
 * vouch your inviter back (closes the recruiting loop). Dismissable; clears the ref.
 * Once the inviter is bound on-chain (`invited_by` is set, done during onboarding) the
 * nudge is history — the graph has the edge, only the vouch-back is left.
 */
export function InviteNudge() {
  const [ref, setRef] = useState<string | null>(null);
  const { profile } = useWallet();

  useEffect(() => {
    setRef(readRefHandle());
  }, []);

  // An on-chain binding means the invite relationship already lives in the registry —
  // stop nudging (also covers a re-onboard where the stashed ref is stale).
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
    try {
      sessionStorage.removeItem('alvinmunk.ref');
    } catch {
      /* noop */
    }
    setRef(null);
  }

  return (
    <Frame label="invite // pending" index="REF" accent="secondary">
      <div className="flex items-center justify-between gap-3 p-4">
        <Sticker name="hand-shake" size={48} className="hidden shrink-0 sm:block" />
        <p className="flex-1 text-sm">
          <span className="font-mono text-secondary">@{ref}</span> invited you — light a star and send
          it back to complete the loop.
        </p>
        <button onClick={dismiss} aria-label="Dismiss" className="shrink-0 text-muted-foreground hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>
    </Frame>
  );
}
