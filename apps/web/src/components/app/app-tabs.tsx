'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Star, Target, Coins, Activity, Users, Bell } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FOCUS_MODE } from '@/lib/focus';
import { useTranslations } from '@/lib/i18n';
import { useWallet } from '@/components/wallet/wallet-provider';
import { INBOX_READ_EVENT, loadInbox } from '@/lib/inbox';
import { usePoll } from '@/lib/use-poll';

/**
 * In-app sub-navigation. The dashboard is split across focused routes instead of one long
 * scroll; this sticky bar moves between them. Desktop = a pill row; mobile = a horizontally
 * scrollable strip. Each tab owns exactly one job.
 *
 * `cashable` tabs (Quests / Rewards) are the Earned-XP + USDC surface — hidden under FOCUS_MODE
 * until the core vouch loop is proven (belts/08).
 *
 * The Inbox tab carries a dot while the inbox holds items not seen yet (lib/inbox, #279).
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

/** How often the dot re-checks the inbox; the reads ride the shared event windows. */
const UNREAD_POLL_MS = 60_000;

/** Unread inbox items for the signed-in wallet; 0 the moment the inbox is marked read. */
function useInboxUnread(): number {
  const me = useWallet().profile?.address;
  const [unread, setUnread] = useState(0);
  usePoll(
    async (signal) => {
      if (!me) return setUnread(0);
      const inbox = await loadInbox(me);
      if (!signal.aborted) setUnread(inbox.unread.size);
    },
    UNREAD_POLL_MS,
    me,
  );
  useEffect(() => {
    const cleared = () => setUnread(0);
    window.addEventListener(INBOX_READ_EVENT, cleared);
    return () => window.removeEventListener(INBOX_READ_EVENT, cleared);
  }, []);
  return unread;
}

export function AppTabs() {
  const t = useTranslations();
  const pathname = usePathname();
  const tabs = TABS.filter((tab) => !tab.cashable || !FOCUS_MODE);
  const unread = useInboxUnread();

  return (
    <nav className="sticky top-16 z-30 -mx-4 border-b border-border/50 bg-background/70 px-4 py-2 backdrop-blur-xl">
      <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab) => {
          const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
          const Icon = tab.icon;
          const dot = tab.href === '/app/inbox' && unread > 0 && !active;
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
              {dot && (
                <span data-testid="inbox-dot" className="absolute right-2 top-2 size-2 rounded-full bg-primary">
                  <span className="sr-only">{t('appTabs.inboxUnread')}</span>
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
