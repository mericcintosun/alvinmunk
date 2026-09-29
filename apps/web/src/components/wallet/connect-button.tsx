'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { User, Copy, LogOut, ChevronDown } from 'lucide-react';
import { useWallet } from './wallet-provider';
import { Crest } from '@/components/brand/crest';
import { buttonVariants } from '@/components/ui/button';
import { shortAddr } from '@alvinmunk/shared';
import { cn } from '@/lib/utils';
import { useLocale, useTranslations } from '@/lib/i18n';

/** Anything the account menu can hand focus to. */
type MenuItem = HTMLAnchorElement | HTMLButtonElement;

/** Keystrokes closer together than this extend one typeahead search instead of restarting it. */
const TYPEAHEAD_WINDOW_MS = 600;

/** The mounted menu items, in DOM order — which is also the navigation order. */
function itemsOf(refs: Array<MenuItem | null>): MenuItem[] {
  return refs.filter((el): el is MenuItem => el !== null);
}

/**
 * Roving focus: focus item `index`, wrapping at both ends so callers can pass -1 or
 * `length` to mean "last". The index is also written back to state so the roving
 * tabindex follows focus.
 */
function focusItemAt(items: MenuItem[], index: number, setActiveIndex: (i: number) => void) {
  if (items.length === 0) return;
  const next = ((index % items.length) + items.length) % items.length;
  setActiveIndex(next);
  items[next].focus();
}

/**
 * Typeahead: extend the search string while keystrokes arrive close together, then find the
 * next item after `from` whose label starts with it. Returns -1 when nothing matches, so
 * the character falls through to normal typing (and never traps focus).
 */
function typeaheadMatch(
  char: string,
  items: MenuItem[],
  from: number,
  search: { query: string; at: number },
): number {
  const now = Date.now();
  search.query = now - search.at <= TYPEAHEAD_WINDOW_MS ? search.query + char : char;
  search.at = now;
  const query = search.query.trim().toLowerCase();
  if (!query) return -1;
  for (let step = 0; step < items.length; step += 1) {
    const index = (from + 1 + step) % items.length;
    if ((items[index].textContent ?? '').trim().toLowerCase().startsWith(query)) return index;
  }
  return -1;
}

/**
 * Navbar identity. No profile → a primary "Open app" CTA (onboarding lives in /app).
 * Connected → a crest+handle chip that opens an account menu (View profile, Copy
 * address, Disconnect) — the disconnect path that was previously missing.
 *
 * The chip is a WAI-ARIA **menu button**, so it implements that pattern in full rather than
 * only declaring the role: focus moves into the menu on open, arrows / Home / End / typeahead
 * rove through the items, Enter or Space activates, Escape closes and hands focus back to
 * the button, and anything that moves focus out closes the menu.
 */
export function ConnectButton() {
  const t = useTranslations();
  const { locale } = useLocale();
  const { profile, balance, disconnect } = useWallet();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<MenuItem | null>>([]);
  const pendingFocus = useRef<number | null>(null);
  const typeahead = useRef({ query: '', at: 0 });
  const baseId = useId();
  const triggerId = `${baseId}-account-trigger`;
  const menuId = `${baseId}-account-menu`;

  /** Close the menu, optionally handing focus back to the button that owns it. */
  function closeMenu(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  const focusItem = (index: number) => focusItemAt(itemsOf(itemRefs.current), index, setActiveIndex);

  /** Open the menu and focus item `index`; -1 targets the last item. */
  function openMenu(index: number) {
    pendingFocus.current = index;
    setOpen(true);
  }

  // The items do not exist yet at openMenu() time, so the target index is applied here,
  // once they have mounted.
  useEffect(() => {
    const index = pendingFocus.current;
    if (!open || index === null) return;
    pendingFocus.current = null;
    focusItemAt(itemsOf(itemRefs.current), index, setActiveIndex);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!open) {
      // Menu button keys: Down/Up open the menu on its first/last item.
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        openMenu(e.key === 'ArrowDown' ? 0 : -1);
      }
      return;
    }

    const items = itemsOf(itemRefs.current);
    if (items.length === 0) return;
    const focused = items.indexOf(document.activeElement as MenuItem);
    const current = focused === -1 ? activeIndex : focused;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusItem(current + 1);
        return;
      case 'ArrowUp':
        e.preventDefault();
        focusItem(current - 1);
        return;
      case 'Home':
        e.preventDefault();
        focusItem(0);
        return;
      case 'End':
        e.preventDefault();
        focusItem(-1);
        return;
      case 'Escape':
        e.preventDefault();
        closeMenu(true);
        return;
      case 'Enter':
      case ' ':
      case 'Spacebar':
        // Click it ourselves and cancel the native activation, so an item (a link included)
        // runs its action exactly once instead of twice.
        e.preventDefault();
        items[current]?.click();
        return;
    }

    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const index = typeaheadMatch(e.key, items, current, typeahead.current);
      if (index !== -1) {
        e.preventDefault();
        focusItem(index);
      }
    }
  }

  /**
   * Tab, a click on a focusable element elsewhere, or focus leaving the document all close
   * the menu. Escape deliberately does *not* come through here: onKeyDown hands focus back
   * to the button first, so closing on blur can't steal it.
   */
  function onBlur(e: FocusEvent<HTMLDivElement>) {
    if (!open) return;
    const next = e.relatedTarget as Node | null;
    if (next && ref.current?.contains(next)) return;
    setOpen(false);
  }

  if (!profile) {
    return (
      <Link href="/app" className={cn(buttonVariants({ size: 'sm' }))}>
        {t('wallet.openApp')}
      </Link>
    );
  }

  const item =
    'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-muted [&_svg]:size-4';
  const itemProps = (index: number) => ({
    role: 'menuitem',
    tabIndex: index === activeIndex ? 0 : -1,
    ref: (el: MenuItem | null) => {
      itemRefs.current[index] = el;
    },
  });

  async function copyAddress() {
    await navigator.clipboard.writeText(profile!.address);
    toast.success(t('wallet.addressCopied'));
    closeMenu(true);
  }

  return (
    <div className="relative" ref={ref} onKeyDown={onKeyDown} onBlur={onBlur}>
      <button
        id={triggerId}
        ref={triggerRef}
        onClick={() => (open ? closeMenu(true) : openMenu(0))}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 py-1 pl-1 pr-2.5 transition-colors hover:bg-muted"
      >
        <Crest address={profile.address} handle={profile.handle} size={28} points={5} />
        <span className="text-sm font-medium">@{profile.handle}</span>
        <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-60 rounded-xl border border-border bg-popover p-1.5 shadow-card">
          <div className="px-3 py-2">
            <p className="font-mono text-xs text-muted-foreground">{shortAddr(profile.address)}</p>
            {balance != null && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {new Intl.NumberFormat(locale === 'tr' ? 'tr-TR' : 'en-US', {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                }).format(Number(balance))} XLM
              </p>
            )}
          </div>
          <div className="my-1 h-px bg-border" />
          <div id={menuId} role="menu" aria-labelledby={triggerId}>
            <Link
              href={`/u/${profile.handle}`}
              {...itemProps(0)}
              onClick={() => closeMenu(true)}
              className={item}
            >
              <User /> {t('wallet.viewProfile')}
            </Link>
            <button {...itemProps(1)} onClick={copyAddress} className={item}>
              <Copy /> {t('wallet.copyAddress')}
            </button>
            <div role="separator" className="my-1 h-px bg-border" />
            <button
              {...itemProps(2)}
              onClick={() => {
                disconnect();
                closeMenu(true);
                toast(t('wallet.disconnected'));
              }}
              className={cn(item, 'text-destructive hover:bg-destructive/10')}
            >
              <LogOut /> {t('wallet.disconnect')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
