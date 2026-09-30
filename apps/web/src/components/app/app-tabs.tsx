'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
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
 *
 * On phones the pills are wider than the strip (#473), so below `sm` they go icon-only (the
 * label stays for screen readers), the strip scrolls the active pill into view on every route
 * change (the strip only, never the page), edge fades show while more pills sit past an edge,
 * and the unread dot is mirrored onto Home, the first pill, so it can't be scrolled out of
 * sight. From `sm` up the row never overflows and looks as it always did.
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

/** The edge fades' width (`w-8`): a pill scrolled into view clears it. */
const FADE_PX = 32;

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

/** Whether the strip has more pills past its left / right edge right now. */
function useEdgeOverflow(scrollRef: RefObject<HTMLDivElement | null>) {
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, [scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    // Rotation or a resized window changes what fits.
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    resize?.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      resize?.disconnect();
    };
  }, [measure, scrollRef]);

  return { canScrollLeft, canScrollRight, measure };
}

/**
 * Scroll `strip` sideways just enough that `pill` is fully visible and clear of the edge
 * fades. Unlike scrollIntoView this never scrolls the page, which would jump to the tab bar
 * on a phone where it sits below the fold. Instant under reduced motion.
 */
function revealInStrip(strip: HTMLElement, pill: HTMLElement) {
  const s = strip.getBoundingClientRect();
  const p = pill.getBoundingClientRect();
  let delta = 0;
  if (p.left < s.left + FADE_PX) delta = p.left - s.left - FADE_PX;
  else if (p.right > s.right - FADE_PX) delta = p.right - s.right + FADE_PX;
  // Clamped to the scroll range: nothing to do for a pill already clear of the fades.
  const next = Math.max(0, Math.min(strip.scrollWidth - strip.clientWidth, strip.scrollLeft + delta));
  if (next === strip.scrollLeft) return;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  strip.scrollTo({ left: next, behavior: reduced ? 'auto' : 'smooth' });
}

export function AppTabs() {
  const t = useTranslations();
  const pathname = usePathname();
  const tabs = TABS.filter((tab) => !tab.cashable || !FOCUS_MODE);
  const unread = useInboxUnread();
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);
  const { canScrollLeft, canScrollRight, measure } = useEdgeOverflow(scrollRef);

  // A direct hit on /app/inbox or /app/people must not leave its own pill off-screen (#473).
  useEffect(() => {
    if (scrollRef.current && activeRef.current) revealInStrip(scrollRef.current, activeRef.current);
    measure();
  }, [pathname, measure]);

  const onInbox = pathname.startsWith('/app/inbox');

  return (
    <nav className="sticky top-16 z-30 -mx-4 border-b border-border/50 bg-background/70 px-4 py-2 backdrop-blur-xl">
      <div className="relative">
        <div
          ref={scrollRef}
          className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {tabs.map((tab) => {
            const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
            const Icon = tab.icon;
            const dot = tab.href === '/app/inbox' && unread > 0 && !active;
            // Phones only: Home is always on-screen, so it repeats the Inbox dot (the one
            // screen readers hear stays on Inbox).
            const mirror = tab.href === '/app' && unread > 0 && !onInbox;
            return (
              <Link
                key={tab.href}
                ref={active ? activeRef : undefined}
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition-colors sm:px-4',
                  active
                    ? 'bg-primary/15 text-foreground ring-1 ring-inset ring-primary/30'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className={cn('size-4', active ? 'text-primary' : '')} />
                <span className="sr-only sm:not-sr-only">{t(tab.key)}</span>
                {dot && (
                  <span data-testid="inbox-dot" className="absolute right-2 top-2 size-2 rounded-full bg-primary">
                    <span className="sr-only">{t('appTabs.inboxUnread')}</span>
                  </span>
                )}
                {mirror && (
                  <span
                    data-testid="inbox-dot-mirror"
                    aria-hidden
                    className="absolute right-1.5 top-1.5 size-2 rounded-full bg-primary sm:hidden"
                  />
                )}
              </Link>
            );
          })}
        </div>
        {/* Edge fades: only where the strip really scrolls, and never from sm up. */}
        <div
          aria-hidden
          data-testid="tabs-fade-left"
          className={cn(
            'pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-background to-transparent transition-opacity sm:hidden',
            canScrollLeft ? 'opacity-100' : 'opacity-0',
          )}
        />
        <div
          aria-hidden
          data-testid="tabs-fade-right"
          className={cn(
            'pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent transition-opacity sm:hidden',
            canScrollRight ? 'opacity-100' : 'opacity-0',
          )}
        />
      </div>
    </nav>
  );
}
