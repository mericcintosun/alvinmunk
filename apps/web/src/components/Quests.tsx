'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Flame } from 'lucide-react';
import { getWallet } from '@/lib/wallet';
import { completeQuest, getCompleted, getQuestPeriods, getStreak } from '@/lib/quests';
import { DEFAULT_QUEST_IDS, WEEK_SECS } from '@/lib/attest';
import { getEarnedScore } from '@/lib/reputation';
import { resolveHandle } from '@/lib/registry';
import { normalizeHandle } from '@/lib/profile';
import { Frame } from '@/components/fx/frame';
import { NumberTicker } from '@/components/fx/number-ticker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { StateArt } from '@/components/ui/state-art';
import { Sticker } from '@/components/ui/sticker';
import { Avatar } from '@/components/Avatar';
import { WeekReset } from '@/components/WeekReset';
import { isStellarAddress, shortAddr } from '@alvinmunk/shared';
import { cn, humanizeError } from '@/lib/utils';
import { toast } from '@/components/ui/toaster';
import { useTranslations } from '@/lib/i18n';

// Quest ids are admin-created on the QuestRegistry; env-configurable so they can change per
// deployment without a code edit. The defaults (2 = refer, 3 = invite-converts, 4 = vouch-back)
// are shared with /api/attest, which only signs a quest id for its bound evidence type.
const REFERRAL_QUEST_ID = Number(
  process.env.NEXT_PUBLIC_DEFAULT_QUEST_ID || DEFAULT_QUEST_IDS.referral_tx,
);
const INVITE_QUEST_ID = Number(
  process.env.NEXT_PUBLIC_INVITE_QUEST_ID || DEFAULT_QUEST_IDS.invite_converts,
);
const VOUCHBACK_QUEST_ID = Number(
  process.env.NEXT_PUBLIC_VOUCHBACK_QUEST_ID || DEFAULT_QUEST_IDS.vouch_back,
);
const VOUCH_BACK_MIN = 3; // mirrors attest.ts VOUCH_BACK_MIN (UI copy only)
const QUEST_IDS = [REFERRAL_QUEST_ID, INVITE_QUEST_ID, VOUCHBACK_QUEST_ID];

type Evidence =
  | { type: 'referral_tx'; ref: string }
  | { type: 'invite_converts'; ref: string }
  | { type: 'vouch_back'; ref: string };

/**
 * Verified quests (Earned XP — the cashable track). The wallet owner proves ownership,
 * the attester verifies proof + on-chain activity, then grants Earned XP. Earned ≠ Social.
 * Three auto-verifiable quests: refer an active wallet, invite-converts (someone you invited
 * got vouched for), and vouch-back (you've vouched for ≥N people) — all feed the viral loop.
 * A quest the admin made repeatable (`set_quest_period`, #154) is tagged, shows as done only
 * for the current period, and opens again when the week rolls over.
 */
export function Quests({ address }: { address: string }) {
  const t = useTranslations();
  const [earned, setEarned] = useState<number | null>(null);
  const [streak, setStreak] = useState<{ weeks: number; best: number } | null>(null);
  const [completed, setCompleted] = useState<Record<number, boolean>>({});
  // Repeat period per quest id in seconds; absent or 0 = one-shot.
  const [periods, setPeriods] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState<null | 'referral' | 'invite' | 'vouchback'>(null);
  const [ref, setRef] = useState('');
  const [resolvedRef, setResolvedRef] = useState<string | null>(null);
  const [resolvingRef, setResolvingRef] = useState(false);
  const [invite, setInvite] = useState('');
  const [resolvedInvite, setResolvedInvite] = useState<string | null>(null);
  const [resolvingInvite, setResolvingInvite] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refTrim = ref.trim();
  const inviteTrim = invite.trim();
  const validRef = resolvedRef && isStellarAddress(resolvedRef) && resolvedRef !== address;
  const validInvite = resolvedInvite && isStellarAddress(resolvedInvite) && resolvedInvite !== address;

  useEffect(() => {
    if (isStellarAddress(refTrim)) {
      setResolvedRef(refTrim);
      setResolvingRef(false);
      return;
    }
    const handle = normalizeHandle(refTrim.replace(/^@/, ''));
    if (handle.length < 3) {
      setResolvedRef(null);
      setResolvingRef(false);
      return;
    }
    let alive = true;
    setResolvingRef(true);
    const timer = setTimeout(() => {
      resolveHandle(handle)
        .catch(() => null)
        .then((addr) => {
          if (alive) {
            setResolvedRef(addr);
            setResolvingRef(false);
          }
        });
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [refTrim]);

  useEffect(() => {
    if (isStellarAddress(inviteTrim)) {
      setResolvedInvite(inviteTrim);
      setResolvingInvite(false);
      return;
    }
    const handle = normalizeHandle(inviteTrim.replace(/^@/, ''));
    if (handle.length < 3) {
      setResolvedInvite(null);
      setResolvingInvite(false);
      return;
    }
    let alive = true;
    setResolvingInvite(true);
    const timer = setTimeout(() => {
      resolveHandle(handle)
        .catch(() => null)
        .then((addr) => {
          if (alive) {
            setResolvedInvite(addr);
            setResolvingInvite(false);
          }
        });
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [inviteTrim]);

  // Quests this wallet already completed show as done. `null` (the read failed, or the
  // deployed contract predates `get_completed`) leaves every quest available, as before.
  const loadCompleted = useCallback(
    (isAlive: () => boolean) =>
      getCompleted(address, QUEST_IDS, address).then((done) => {
        if (isAlive() && done) setCompleted(Object.fromEntries(done));
      }),
    [address],
  );

  useEffect(() => {
    getEarnedScore(address, address).then(setEarned).catch(() => setEarned(0));
    getStreak(address, address)
      .then((s) => setStreak({ weeks: s.weeks, best: s.best }))
      .catch(() => setStreak({ weeks: 0, best: 0 }));

    let alive = true;
    setCompleted({});
    void loadCompleted(() => alive);
    // `null` (a contract without repeatable quests, or a failed read): all one-shot.
    getQuestPeriods(QUEST_IDS, address).then((p) => {
      if (alive && p) setPeriods(Object.fromEntries(p));
    });
    return () => {
      alive = false;
    };
  }, [address, loadCompleted]);

  function reloadStreak() {
    getStreak(address, address)
      .then((s) => setStreak({ weeks: s.weeks, best: s.best }))
      .catch(() => {
        /* keep the last streak */
      });
  }

  // A run can lapse when the week rolls over, so the countdown re-reads the streak then —
  // and the completions, since a weekly quest opens again.
  function onRollover() {
    reloadStreak();
    if (QUEST_IDS.some((id) => (periods[id] ?? 0) > 0)) {
      setCompleted({});
      void loadCompleted(() => true);
    }
  }

  // The tag a repeatable quest carries, and the label its button shows once done.
  function repeats(id: number): string | null {
    const secs = periods[id] ?? 0;
    if (secs <= 0) return null;
    if (secs === WEEK_SECS) return t('quests.repeatsWeekly');
    return t('quests.repeatsEvery', { days: String(Math.round(secs / 86_400)) });
  }
  function doneLabel(id: number): string {
    const secs = periods[id] ?? 0;
    if (secs <= 0) return t('quests.completed');
    return secs === WEEK_SECS ? t('quests.completedThisWeek') : t('quests.completedThisRound');
  }
  const tag = (id: number) => {
    const text = repeats(id);
    return text ? (
      <span className="ml-2 font-mono text-2xs normal-case tracking-normal text-secondary">
        · {text}
      </span>
    ) : null;
  };

  // Runs after a verified quest, outside its error path: the XP is already granted on-chain, so a
  // slow or failed read keeps the last figures instead of reporting the quest as failed.
  function refreshScores() {
    getEarnedScore(address, address)
      .then(setEarned)
      .catch(() => {
        /* keep the last score */
      });
    reloadStreak();
  }

  async function run(kind: 'referral' | 'invite' | 'vouchback', questId: number, evidence: Evidence) {
    setBusy(kind);
    setError(null);
    setDone(false);
    try {
      const wallet = await getWallet();
      const r = await completeQuest(wallet, questId, evidence);
      if (r.ok || r.completed) setCompleted((prev) => ({ ...prev, [questId]: true }));
      if (!r.ok) throw new Error(r.error);
      setDone(true);
      toast.success(t('quests.toast.success'));
      refreshScores();
    } catch (e) {
      const msg = humanizeError(e);
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Frame label={t('quests.frame')} index="02" accent="secondary" tape="bl">
      <div className="relative p-5">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            {t('quests.title')}
            <Sticker name="social-plus1" size={28} className="h-6 w-auto" />
          </h2>
          <Badge variant="onchain">
            {t('quests.earnedXp')}: {earned === null ? '…' : <NumberTicker value={earned} className="ml-0.5" />}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{t('quests.subtitle')}</p>
        {streak && streak.weeks > 0 && (
          <StateArt kind="streak-fire" size={64} className="absolute right-4 top-4 motion-safe:animate-float" />
        )}
        {streak && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="eyebrow-mono text-muted-foreground">
              {t('quests.weeklyStamp')}
            </span>
            <div className="flex gap-1.5">
              {Array.from({ length: 7 }).map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    'size-3.5 border transition-colors',
                    i < Math.min(streak.weeks, 7) ? 'border-secondary bg-secondary/70' : 'border-border',
                  )}
                />
              ))}
            </div>
            <span className="flex items-center gap-1 font-mono text-2xs text-secondary">
              <Flame className="size-3.5" />
              {streak.weeks}
              {streak.best > streak.weeks && (
                <span className="text-muted-foreground">
                  {' · '}
                  {t('quests.streakBest', { best: String(streak.best) })}
                </span>
              )}
            </span>
            <WeekReset address={address} onRollover={onRollover} className="ml-auto" />
          </div>
        )}
        {/* Quest 1 — refer an active wallet */}
        <div className="mt-4">
          <label htmlFor="quest-ref" className="eyebrow-mono text-muted-foreground">
            {t('quests.referLabel')}
            {tag(REFERRAL_QUEST_ID)}
          </label>
          <Input
            id="quest-ref"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder={t('quests.handlePlaceholder')}
            className="mt-1.5 font-mono text-xs"
            aria-describedby="quest-ref-hint"
          />
          {!isStellarAddress(refTrim) && refTrim.length > 0 && (
            <div className="mt-1 flex items-center text-xs text-muted-foreground">
              {resolvingRef ? (
                t('quests.lookingUp')
              ) : resolvedRef ? (
                <span className="flex items-center text-secondary">
                  → <Avatar address={resolvedRef} size={16} ring={false} className="mx-1.5" />
                  {shortAddr(resolvedRef, 6, 6)}
                </span>
              ) : (
                <span className="text-destructive">{t('quests.noWallet')}</span>
              )}
            </div>
          )}
          <p id="quest-ref-hint" className="mt-1 text-2xs text-muted-foreground">
            {resolvedRef && resolvedRef === address
              ? t('quests.refSelf')
              : refTrim && !resolvingRef && !validRef
                ? t('quests.refInvalid')
                : t('quests.refHint')}
          </p>
          <Button
            variant={completed[REFERRAL_QUEST_ID] ? 'secondary' : 'onchain'}
            onClick={() => run('referral', REFERRAL_QUEST_ID, { type: 'referral_tx', ref: resolvedRef! })}
            disabled={busy !== null || completed[REFERRAL_QUEST_ID] || !validRef || resolvingRef}
            className="mt-2 w-full"
          >
            {completed[REFERRAL_QUEST_ID]
              ? doneLabel(REFERRAL_QUEST_ID)
              : busy === 'referral'
                ? t('quests.verifying')
                : t('quests.verify')}
          </Button>
        </div>

        {/* Quest 2 — invite-converts: someone you invited opened a profile + got vouched for */}
        <div className="mt-4 border-t border-border/60 pt-4">
          <label htmlFor="quest-invite" className="eyebrow-mono text-muted-foreground">
            {t('quests.inviteLabel')}
            {tag(INVITE_QUEST_ID)}
          </label>
          <Input
            id="quest-invite"
            value={invite}
            onChange={(e) => setInvite(e.target.value)}
            placeholder={t('quests.addressPlaceholder')}
            className="mt-1.5 font-mono text-xs"
            aria-describedby="quest-invite-hint"
          />
          {!isStellarAddress(inviteTrim) && inviteTrim.length > 0 && (
            <div className="mt-1 flex items-center text-xs text-muted-foreground">
              {resolvingInvite ? (
                t('quests.lookingUp')
              ) : resolvedInvite ? (
                <span className="flex items-center text-secondary">
                  → <Avatar address={resolvedInvite} size={16} ring={false} className="mx-1.5" />
                  {shortAddr(resolvedInvite, 6, 6)}
                </span>
              ) : (
                <span className="text-destructive">{t('quests.noWallet')}</span>
              )}
            </div>
          )}
          <p id="quest-invite-hint" className="mt-1 text-2xs text-muted-foreground">
            {resolvedInvite && resolvedInvite === address
              ? t('quests.inviteSelf')
              : inviteTrim && !resolvingInvite && !validInvite
                ? t('quests.inviteInvalid')
                : t('quests.inviteHint')}
          </p>
          <Button
            variant={completed[INVITE_QUEST_ID] ? 'secondary' : 'onchain'}
            onClick={() => run('invite', INVITE_QUEST_ID, { type: 'invite_converts', ref: resolvedInvite! })}
            disabled={busy !== null || completed[INVITE_QUEST_ID] || !validInvite || resolvingInvite}
            className="mt-2 w-full"
          >
            {completed[INVITE_QUEST_ID]
              ? doneLabel(INVITE_QUEST_ID)
              : busy === 'invite'
                ? t('quests.verifying')
                : t('quests.claimInvite')}
          </Button>
        </div>

        {/* Quest 3 — vouch-back: you've vouched for ≥N people */}
        <div className="mt-4 border-t border-border/60 pt-4">
          <span className="eyebrow-mono text-muted-foreground">
            {t('quests.vouchBackLabel')}
            {tag(VOUCHBACK_QUEST_ID)}
          </span>
          <p className="mt-1 text-2xs text-muted-foreground">
            {t('quests.vouchBackHint', { min: String(VOUCH_BACK_MIN) })}
          </p>
          <Button
            variant={completed[VOUCHBACK_QUEST_ID] ? 'secondary' : 'onchain'}
            onClick={() => run('vouchback', VOUCHBACK_QUEST_ID, { type: 'vouch_back', ref: '' })}
            disabled={busy !== null || completed[VOUCHBACK_QUEST_ID]}
            className="mt-2 w-full"
          >
            {completed[VOUCHBACK_QUEST_ID]
              ? doneLabel(VOUCHBACK_QUEST_ID)
              : busy === 'vouchback'
                ? t('quests.verifying')
                : t('quests.claimVouchBack', { min: String(VOUCH_BACK_MIN) })}
          </Button>
        </div>

        {done && (
          <div className="mt-3 flex flex-col items-center">
            <StateArt kind="quest-complete" size={120} className="motion-safe:animate-ignite" />
            <p className="mt-1 text-center text-xs text-secondary">{t('quests.done')}</p>
          </div>
        )}
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </div>
    </Frame>
  );
}
