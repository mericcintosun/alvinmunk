'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Sparkles } from 'lucide-react';
import { getPending, getProfile, type PendingBonusView } from '@/lib/reputation';
import { useWallet } from '@/components/wallet/wallet-provider';
import { useTranslations } from '@/lib/i18n';
import { FOCUS_MODE } from '@/lib/focus';

const QUESTS_PATH = '/app/quests';

/**
 * Pending bonus nudge — the claimer's side of the asymmetric 2nd-order gate (belts/08 §1).
 * Every voucher bonus queued on you (`get_pending`) is paid only when you complete your
 * first verified quest, so say so: "3 people get +5 XP each when you complete your first
 * quest", with a link to Quests. Shown only to an unverified user with a non-empty queue;
 * renders nothing while loading, when the read fails (including a deployed contract without
 * `get_pending`) and once they verify, and re-reads when the tab comes back into view.
 * Under FOCUS_MODE (quests hidden) the copy stays and the link goes, like OwedBonuses.
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
        // An unreadable profile leaves the decision to the queue, which verifying empties.
        getProfile(address).then(
          (p) => p.verified,
          () => false,
        ),
      ])
        .then(([bonuses, isVerified]) => {
          if (!alive) return;
          setPending(bonuses);
          setVerified(isVerified);
        })
        .catch(() => {
          /* keep the last state: an unknown queue never reads as "people are waiting" */
        });
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    setPending([]);
    setVerified(false);
    load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [address]);

  if (!address || verified || pending.length === 0) return null;

  const count = pending.length;
  const amount = pending[0].amount;
  const total = pending.reduce((sum, p) => sum + p.amount, 0);
  const title =
    count === 1
      ? t('pendingBonusNudge.title.one', { amount: String(amount) })
      : pending.every((p) => p.amount === amount)
        ? t('pendingBonusNudge.title.other', { count: String(count), amount: String(amount) })
        : t('pendingBonusNudge.title.mixed', { count: String(count), total: String(total) });

  return (
    <div className="rounded-2xl border border-tertiary/40 bg-tertiary/10 p-5">
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 size-5 shrink-0 text-tertiary" />
        <div className="flex-1">
          <p className="font-semibold text-foreground">{title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('pendingBonusNudge.body')}</p>
          {!FOCUS_MODE && (
            <Link
              href={QUESTS_PATH}
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-tertiary hover:underline"
            >
              {t('pendingBonusNudge.action')}
              <ArrowRight className="size-4" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
