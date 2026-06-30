'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Star, Target, Coins, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FOCUS_MODE } from '@/lib/focus';

/**
 * In-app sub-navigation. The dashboard is split across focused routes instead of one long
 * scroll; this sticky bar moves between them. Desktop = a pill row; mobile = a horizontally
 * scrollable strip. Each tab owns exactly one job.
 *
 * `cashable` tabs (Quests / Rewards) are the Earned-XP + USDC surface — hidden under FOCUS_MODE
 * until the core vouch loop is proven (belts/08).
 */
const TABS = [
  { href: '/app', label: 'Home', icon: Home, exact: true, cashable: false },
  { href: '/app/vouch', label: 'Vouch', icon: Star, exact: false, cashable: false },
  { href: '/app/quests', label: 'Quests', icon: Target, exact: false, cashable: true },
  { href: '/app/rewards', label: 'Rewards', icon: Coins, exact: false, cashable: true },
  { href: '/app/activity', label: 'Activity', icon: Activity, exact: false, cashable: false },
];

export function AppTabs() {
  const pathname = usePathname();
  const tabs = TABS.filter((t) => !t.cashable || !FOCUS_MODE);

  return (
    <nav className="sticky top-16 z-30 -mx-4 border-b border-border/50 bg-background/70 px-4 py-2 backdrop-blur-xl">
      <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((t) => {
          const active = t.exact ? pathname === t.href : pathname.startsWith(t.href);
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                'inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-primary/15 text-foreground ring-1 ring-inset ring-primary/30'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon className={cn('size-4', active ? 'text-primary' : '')} />
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
