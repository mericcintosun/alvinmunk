'use client';

import { useEffect, useState } from 'react';
import { Flame } from 'lucide-react';
import { getWallet } from '@/lib/wallet';
import { completeQuest, getStreak } from '@/lib/quests';
import { DEFAULT_QUEST_IDS } from '@/lib/attest';
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
import { cn, humanizeError, shortAddress } from '@/lib/utils';
import { toast } from '@/components/ui/toaster';

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

type Evidence =
  | { type: 'referral_tx'; ref: string }
  | { type: 'invite_converts'; ref: string }
  | { type: 'vouch_back'; ref: string };

const RAW_ADDR = /^[GC][A-Z2-7]{55}$/;
const RAW_G_ADDR = /^G[A-Z2-7]{55}$/;

/**
 * Verified quests (Earned XP — the cashable track). The wallet owner proves ownership,
 * the attester verifies proof + on-chain activity, then grants Earned XP. Earned ≠ Social.
 * Three auto-verifiable quests: refer an active wallet, invite-converts (someone you invited
 * got vouched for), and vouch-back (you've vouched for ≥N people) — all feed the viral loop.
 */
export function Quests({ address }: { address: string }) {
  const [earned, setEarned] = useState<number | null>(null);
  const [streak, setStreak] = useState<{ weeks: number; best: number } | null>(null);
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
  const validRef = resolvedRef && RAW_G_ADDR.test(resolvedRef) && resolvedRef !== address;
  const validInvite = resolvedInvite && RAW_ADDR.test(resolvedInvite) && resolvedInvite !== address;

  useEffect(() => {
    if (RAW_ADDR.test(refTrim)) {
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
    const t = setTimeout(() => {
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
      clearTimeout(t);
    };
  }, [refTrim]);

  useEffect(() => {
    if (RAW_ADDR.test(inviteTrim)) {
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
    const t = setTimeout(() => {
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
      clearTimeout(t);
    };
  }, [inviteTrim]);

  useEffect(() => {
    getEarnedScore(address, address).then(setEarned).catch(() => setEarned(0));
    getStreak(address, address)
      .then((s) => setStreak({ weeks: s.weeks, best: s.best }))
      .catch(() => setStreak({ weeks: 0, best: 0 }));
  }, [address]);

  // A run can lapse when the week rolls over, so the countdown re-reads the streak then.
  function reloadStreak() {
    getStreak(address, address)
      .then((s) => setStreak({ weeks: s.weeks, best: s.best }))
      .catch(() => {
        /* keep the last streak */
      });
  }

  async function run(kind: 'referral' | 'invite' | 'vouchback', questId: number, evidence: Evidence) {
    setBusy(kind);
    setError(null);
    setDone(false);
    try {
      const wallet = await getWallet();
      const r = await completeQuest(wallet, questId, evidence);
      if (!r.ok) throw new Error(r.error);
      setDone(true);
      toast.success('Quest verified — Earned XP added 🎉');
      setEarned(await getEarnedScore(address, address));
      const s = await getStreak(address, address);
      setStreak({ weeks: s.weeks, best: s.best });
    } catch (e) {
      const msg = humanizeError(e);
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Frame label="quests // earn" index="02" accent="secondary" tape="bl">
      <div className="relative p-5">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            Verified quests
            <Sticker name="social-plus1" size={28} className="h-6 w-auto" />
          </h2>
          <Badge variant="onchain">
            Earned XP: {earned === null ? '…' : <NumberTicker value={earned} className="ml-0.5" />}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Verified actions earn Earned XP — the only kind that unlocks USDC. Vouches don&apos;t.
        </p>
        {streak && streak.weeks > 0 && (
          <StateArt kind="streak-fire" size={64} className="absolute right-4 top-4 motion-safe:animate-float" />
        )}
        {streak && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              weekly stamp
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
            <span className="flex items-center gap-1 font-mono text-[10px] text-secondary">
              <Flame className="size-3.5" />
              {streak.weeks}
              {streak.best > streak.weeks && (
                <span className="text-muted-foreground/60"> · best {streak.best}</span>
              )}
            </span>
            <WeekReset address={address} onRollover={reloadStreak} className="ml-auto" />
          </div>
        )}
        {/* Quest 1 — refer an active wallet */}
        <div className="mt-4">
          <label htmlFor="quest-ref" className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            refer a friend&apos;s wallet
          </label>
          <Input
            id="quest-ref"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder="@handle or address (G…)"
            className="mt-1.5 font-mono text-xs"
            aria-describedby="quest-ref-hint"
          />
          {!RAW_ADDR.test(refTrim) && refTrim.length > 0 && (
            <div className="mt-1 flex items-center text-xs text-muted-foreground">
              {resolvingRef ? (
                'Looking up handle…'
              ) : resolvedRef ? (
                <span className="flex items-center text-secondary">
                  → <Avatar address={resolvedRef} size={16} ring={false} className="mx-1.5" />
                  {shortAddress(resolvedRef, 6, 6)}
                </span>
              ) : (
                <span className="text-destructive">No wallet found for that handle</span>
              )}
            </div>
          )}
          <p id="quest-ref-hint" className="mt-1 text-[11px] text-muted-foreground">
            {resolvedRef && resolvedRef === address
              ? 'You can’t refer yourself — paste a different wallet.'
              : refTrim && !resolvingRef && !validRef
                ? 'That doesn’t look like a Stellar address (G…) or handle.'
                : 'A friend who’s already active on Stellar. Earns Earned XP (cashable).'}
          </p>
          <Button
            variant="onchain"
            onClick={() => run('referral', REFERRAL_QUEST_ID, { type: 'referral_tx', ref: resolvedRef! })}
            disabled={busy !== null || !validRef || resolvingRef}
            className="mt-2 w-full"
          >
            {busy === 'referral' ? 'Verifying…' : 'Verify a quest'}
          </Button>
        </div>

        {/* Quest 2 — invite-converts: someone you invited opened a profile + got vouched for */}
        <div className="mt-4 border-t border-border/60 pt-4">
          <label htmlFor="quest-invite" className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            invite who converted
          </label>
          <Input
            id="quest-invite"
            value={invite}
            onChange={(e) => setInvite(e.target.value)}
            placeholder="@handle or address (G… or C…)"
            className="mt-1.5 font-mono text-xs"
            aria-describedby="quest-invite-hint"
          />
          {!RAW_ADDR.test(inviteTrim) && inviteTrim.length > 0 && (
            <div className="mt-1 flex items-center text-xs text-muted-foreground">
              {resolvingInvite ? (
                'Looking up handle…'
              ) : resolvedInvite ? (
                <span className="flex items-center text-secondary">
                  → <Avatar address={resolvedInvite} size={16} ring={false} className="mx-1.5" />
                  {shortAddress(resolvedInvite, 6, 6)}
                </span>
              ) : (
                <span className="text-destructive">No wallet found for that handle</span>
              )}
            </div>
          )}
          <p id="quest-invite-hint" className="mt-1 text-[11px] text-muted-foreground">
            {resolvedInvite && resolvedInvite === address
              ? 'You can’t invite yourself.'
              : inviteTrim && !resolvingInvite && !validInvite
                ? 'That doesn’t look like a Stellar address or handle.'
                : 'Someone you brought in — earns once they’ve been vouched for. The growth loop.'}
          </p>
          <Button
            variant="onchain"
            onClick={() => run('invite', INVITE_QUEST_ID, { type: 'invite_converts', ref: resolvedInvite! })}
            disabled={busy !== null || !validInvite || resolvingInvite}
            className="mt-2 w-full"
          >
            {busy === 'invite' ? 'Verifying…' : 'Claim invite reward'}
          </Button>
        </div>

        {/* Quest 3 — vouch-back: you've vouched for ≥N people */}
        <div className="mt-4 border-t border-border/60 pt-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            vouch-back streak
          </span>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Vouch for {VOUCH_BACK_MIN} people, then claim — rewards backing others, not just being backed.
          </p>
          <Button
            variant="onchain"
            onClick={() => run('vouchback', VOUCHBACK_QUEST_ID, { type: 'vouch_back', ref: '' })}
            disabled={busy !== null}
            className="mt-2 w-full"
          >
            {busy === 'vouchback' ? 'Verifying…' : `Claim vouch-back (${VOUCH_BACK_MIN}+ vouches)`}
          </Button>
        </div>

        {done && (
          <div className="mt-3 flex flex-col items-center">
            <StateArt kind="quest-complete" size={120} className="motion-safe:animate-ignite" />
            <p className="mt-1 text-center text-xs text-secondary">verified on-chain → Earned XP added</p>
          </div>
        )}
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </div>
    </Frame>
  );
}
