'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { getPending, type PendingBonusView, getProfile } from '@/lib/reputation';
import { useWallet } from '@/components/wallet/wallet-provider';
import { useTranslations } from '@/lib/i18n';

/**
 * Pending bonus nudge — shows unverified users who have queued 2nd-order voucher bonuses
 * waiting on their first verified action. Turns the invisible anti-sybil rule into a
 * social reason to take the first verified quest: "3 people get +5 when you complete your
 * first quest". Self-hides when verified or when the queue is empty.
 */
export function PendingBonusNudge() {
  const t = useTranslations();
  const { profile } = useWallet();
  const address = profile?.address;
  const [pending, setPending] = useState<PendingBonusView[]>([]);
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    if (!address) return;
    let alive = true;
    const load = () => {
      Promise.all([
        getPending(address),
        getProfile(address).then((p) => p.verified).catch(() => false),
      ])
        .then(([bonuses, isVerified]) => {
          if (alive) {
            setPending(bonuses);
            setVerified(isVerified);
          }
        })
        .catch(() => {
          /* keep the last list or empty */
        });
    };
    setPending([]);
    setVerified(false);
    load();
    return () => {
      alive = false;
    };
  }, [address]);

  // Hide if verified or no pending bonuses
  if (!address || verified || pending.length === 0) return null;

  const total = pending.reduce((sum: number, p: PendingBonusView) => sum + p.amount, 0);

  return (
    <div className="rounded-2xl border border-tertiary/40 bg-tertiary/10 p-5">
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 size-5 shrink-0 text-tertiary" />
        <div className="flex-1">
          <p className="font-semibold text-foreground">
            {t('pendingBonusNudge.title', { count: String(pending.length), total: String(total) })}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{t('pendingBonusNudge.body')}</p>
          <Link
            href="/app/quests"
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-tertiary hover:underline"
          >
            {t('pendingBonusNudge.action')}
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
