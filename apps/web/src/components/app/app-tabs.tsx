'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Star, Target, Coins, Activity, Users, Bell } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FOCUS_MODE } from '@/lib/focus';
import { useTranslations } from '@/lib/i18n';
import { useEffect, useState } from 'react';
import { useWallet } from '@/components/wallet/wallet-provider';
import { getInboxItems, countUnread } from '@/lib/inbox';

/**
 * In-app sub-navigation. The dashboard is split across focused routes instead of one long
 * scroll; this sticky bar moves between them. Desktop = a pill row; mobile = a horizontally
 * scrollable strip. Each tab owns exactly one job.
 *
 * `cashable` tabs (Quests / Rewards) are the Earned-XP + USDC surface — hidden under FOCUS_MODE
 * until the core vouch loop is proven (belts/08).
 *
 * The Inbox tab shows an unread dot when items have arrived since the last time the user
 * opened the inbox. The count is derived from the localStorage last-read timestamp so it
 * survives a page refresh without an extra RPC call.
 */
const TABS = [
  { href: '/app', key: 'appTabs.home', icon: Home, exact: true, cashable: false },
  { href: '/app/vouch', key: 'appTabs.vouch', icon: Star, exact: false, cashable: false },
  { href: '/app/quests', key: 'appTabs.quests', icon: Target, exact: false, cashable: true },
  { href: '/app/rewards', key: 'appTabs.rewards', icon: Coins, exact: false, cashable: true },
  { href: '/app/activity', key: 'appTabs.activity', icon: Activity, exact: false, cashable: false },
  { href: '/app/people', key: 'appTabs.people', icon: Users, exact: false, cashable: false },
  { href: '/app/inbox', key: 'appTabs.inbox', icon: Bell, exact: false, cashable: false },
];

export function AppTabs() {
  const t = useTranslations();
  const pathname = usePathname();
  const { profile } = useWallet();
  const tabs = TABS.filter((tab) => !tab.cashable || !FOCUS_MODE);

  // Unread count — loaded in the background after mount so it never blocks the render.
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!profile?.address) return;
    // Clear the dot immediately when the user is on the inbox route.
    if (pathname.startsWith('/app/inbox')) {
      setUnreadCount(0);
      return;
    }
    let cancelled = false;
    getInboxItems(profile.address, 0)
      .then((items) => {
        if (!cancelled) setUnreadCount(countUnread(items));
      })
      .catch(() => {/* degrade silently */});
    return () => { cancelled = true; };
  }, [profile?.address, pathname]);

  return (
    <nav className="sticky top-16 z-30 -mx-4 border-b border-border/50 bg-background/70 px-4 py-2 backdrop-blur-xl">
      <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab) => {
          const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
          const Icon = tab.icon;
          const showDot = tab.href === '/app/inbox' && unreadCount > 0 && !active;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-primary/15 text-foreground ring-1 ring-inset ring-primary/30'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon className={cn('size-4', active ? 'text-primary' : '')} />
              {t(tab.key)}
              {showDot && (
                <span
                  aria-label={`${unreadCount} unread`}
                  className="absolute right-2 top-2 size-2 rounded-full bg-primary"
                />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
