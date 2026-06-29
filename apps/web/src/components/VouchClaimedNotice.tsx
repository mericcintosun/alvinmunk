'use client';

import { useEffect } from 'react';
import { toast } from '@/components/ui/toaster';
import { pollNewlyClaimed } from '@/lib/myvouches';

/**
 * In-app "your vouch was claimed" notice — the single loop-closing notification (roundtable):
 * when someone claims a vouch you minted, their star ignited and your sky grew. Fires once per
 * claim on dashboard load. Renders nothing; it only toasts. (True push is deferred — needs
 * web-push infra.)
 */
export function VouchClaimedNotice() {
  useEffect(() => {
    let alive = true;
    pollNewlyClaimed()
      .then((claimed) => {
        if (!alive || claimed.length === 0) return;
        if (claimed.length === 1) {
          toast.success(`🌟 Your vouch ignited — “${claimed[0].note}” was claimed.`);
        } else {
          toast.success(`🌟 ${claimed.length} of your vouches were claimed — your sky grew.`);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return null;
}
