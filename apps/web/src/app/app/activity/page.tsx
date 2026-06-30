'use client';

import Link from 'next/link';
import { Trophy, ArrowRight } from 'lucide-react';
import { ActivityFeed } from '@/components/ActivityFeed';

/**
 * Activity — the moving sky. Recent vouch claims across the network, read straight from
 * chain events, plus a jump to the full leaderboard.
 */
export default function ActivityPage() {
  return (
    <div className="grid gap-6">
      <header>
        <h1 className="font-display text-2xl font-semibold">The sky is moving</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground text-balance">
          Every claimed vouch lights a star somewhere. This feed reads live from on-chain
          events — no backend in between.
        </p>
      </header>

      <ActivityFeed />

      <Link
        href="/leaderboard"
        className="group glass spotlight flex items-center justify-between gap-4 rounded-2xl p-5 transition-transform hover:-translate-y-0.5"
      >
        <div className="flex items-center gap-3">
          <Trophy className="size-6 text-accent" />
          <div>
            <p className="font-semibold">See the leaderboard</p>
            <p className="text-sm text-muted-foreground">The most-connected constellations, ranked.</p>
          </div>
        </div>
        <ArrowRight className="size-5 -translate-x-1 text-muted-foreground transition-all group-hover:translate-x-0 group-hover:text-foreground" />
      </Link>
    </div>
  );
}
