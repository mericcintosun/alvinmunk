'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Star, Target, Coins, ArrowRight } from 'lucide-react';
import { useWallet } from '@/components/wallet/wallet-provider';
import { FOCUS_MODE } from '@/lib/focus';
import { asset, BRAND } from '@/lib/assets';
import { FirstStarNudge } from '@/components/FirstStarNudge';
import { InviteNudge } from '@/components/InviteNudge';
import { PendingHalfCards } from '@/components/PendingHalfCards';
import { ActivityFeed } from '@/components/ActivityFeed';

// three.js stays out of SSR + the marketing bundle — lazy, client-only.
const ConstellationHero3D = dynamic(() => import('@/components/brand/constellation-3d'), {
  ssr: false,
  loading: () => (
    <div className="aurora flex h-[44vh] max-h-[440px] min-h-[320px] w-full items-center justify-center rounded-3xl border border-border/60">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={asset(BRAND['logo-mark'].file)}
        alt=""
        width={48}
        height={68}
        className="select-none opacity-80 motion-safe:animate-breathe"
      />
    </div>
  ),
});

const SHORTCUTS = [
  {
    href: '/app/vouch',
    icon: Star,
    title: 'Light a star',
    body: 'Vouch for someone — even before they join. Your card becomes their invite.',
    tint: 'text-accent',
    cashable: false,
  },
  {
    href: '/app/quests',
    icon: Target,
    title: 'Earn verified XP',
    body: 'Complete attester-checked quests. Earned XP is the only track that unlocks USDC.',
    tint: 'text-secondary',
    cashable: true,
  },
  {
    href: '/app/rewards',
    icon: Coins,
    title: 'Tip & cash out',
    body: 'Send USDC tips and claim rank rewards once your Earned XP clears the bar.',
    tint: 'text-tertiary',
    cashable: true,
  },
];

export default function AppHome() {
  const { profile } = useWallet();
  if (!profile) return null;

  const shortcuts = SHORTCUTS.filter((s) => !s.cashable || !FOCUS_MODE);

  return (
    <div className="grid gap-6">
      {/* HERO — your living 3D constellation */}
      <ConstellationHero3D address={profile.address} handle={profile.handle} />

      {/* First-run + invite nudges (self-hiding) */}
      <FirstStarNudge />
      <InviteNudge />

      {/* Time-sensitive: unclaimed half-cards you minted (stake at risk) — self-hides when empty */}
      <PendingHalfCards />

      {/* Quick actions — the three focused routes, one job each */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          What now
        </h2>
        <div className={`grid gap-3 ${shortcuts.length > 1 ? 'sm:grid-cols-3' : ''}`}>
          {shortcuts.map((s) => {
            const Icon = s.icon;
            return (
              <Link
                key={s.href}
                href={s.href}
                className="group glass spotlight flex flex-col gap-3 rounded-2xl p-5 transition-transform hover:-translate-y-0.5"
              >
                <Icon className={`size-6 ${s.tint}`} />
                <div>
                  <p className="flex items-center gap-1 font-semibold">
                    {s.title}
                    <ArrowRight className="size-4 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground text-balance">{s.body}</p>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Recent activity preview */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Recent activity
          </h2>
          <Link href="/app/activity" className="text-sm text-primary hover:underline">
            View all
          </Link>
        </div>
        <ActivityFeed />
      </section>
    </div>
  );
}
