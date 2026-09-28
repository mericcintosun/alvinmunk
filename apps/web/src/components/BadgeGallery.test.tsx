import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../messages/en.json';
import tr from '../../messages/tr.json';

const { getBadgesMock, focus, locale } = vi.hoisted(() => ({
  getBadgesMock: vi.fn(),
  focus: { on: false },
  locale: { current: 'en' as 'en' | 'tr' },
}));

vi.mock('@/lib/badges', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/badges')>()),
  getBadges: getBadgesMock,
}));
// Stubs keep this test about the badge row (both also rely on the automatic JSX runtime,
// which this vitest setup does not use).
vi.mock('@/components/Avatar', () => ({ Avatar: () => null }));
vi.mock('@/components/ui/skeleton', () => ({ Skeleton: () => null }));
// The real message tables, with the locale switchable per test.
vi.mock('@/lib/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/i18n')>();
  return { ...actual, useTranslations: () => actual.getTranslations(locale.current) };
});
vi.mock('@/lib/focus', () => ({
  get FOCUS_MODE() {
    return focus.on;
  },
}));

import { BadgeGallery } from './BadgeGallery';
import { computeBadges, type BadgeInput } from '@/lib/badges';

const EMPTY: BadgeInput = { vouchedBy: 0, vouchedFor: 0, verified: false, streakBest: 0, tipped: false };
const ALICE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

describe('BadgeGallery', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    focus.on = false;
    locale.current = 'en';
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  async function render(ui: React.ReactElement) {
    await act(async () => {
      root.render(ui);
      await Promise.resolve();
    });
  }
  const tile = (id: string) => container.querySelector(`[data-badge="${id}"]`)!;

  it('reads badges for the address it is given and shows earned vs locked with the next step', async () => {
    getBadgesMock.mockResolvedValue(
      computeBadges({ ...EMPTY, vouchedBy: 1, vouchedFor: 3, firstVoucher: { address: ALICE, handle: 'alice' } }),
    );
    await render(<BadgeGallery address="GOWNER" />);

    expect(getBadgesMock).toHaveBeenCalledWith('GOWNER');
    expect(container.querySelector('h2')?.textContent).toBe('Milestone badges');
    expect(container.textContent).toContain('1/6');

    // Earned + person-tied: names the person, linked to their profile.
    expect(tile('firstStar').getAttribute('data-earned')).toBe('true');
    expect(tile('firstStar').textContent).toContain('lit by @alice');
    expect(tile('firstStar').querySelector('a')?.getAttribute('href')).toBe('/u/alice');

    // Locked: greyed out WITH the remaining step, and announced as locked.
    expect(tile('connector').getAttribute('data-earned')).toBe('false');
    expect(tile('connector').textContent).toContain('2 more people to back');
    expect(tile('connector').textContent).toContain('locked');
    expect(tile('connector').querySelector('img')?.className).toContain('grayscale');
    expect(tile('constellation').textContent).toContain('9 more vouchers to go');
    expect(tile('generous').textContent).toContain('No tip sent yet');
  });

  it('shows a busy skeleton row while loading', async () => {
    getBadgesMock.mockReturnValue(new Promise(() => {}));
    await render(<BadgeGallery address="GOWNER" />);
    expect(container.querySelector('ul')?.getAttribute('aria-busy')).toBe('true');
    expect(container.textContent).toContain('Loading badges…');
    expect(container.querySelector('[data-badge]')).toBeNull();
  });

  it('falls back to a short address for a person without a handle', async () => {
    getBadgesMock.mockResolvedValue(
      computeBadges({ ...EMPTY, tipped: true, firstTipTo: { address: ALICE, handle: null } }),
    );
    await render(<BadgeGallery address="GOWNER" />);
    expect(tile('generous').textContent).toContain('first tip to GAAA…AWHF');
    expect(tile('generous').querySelector('a')).toBeNull();
  });

  it('uses the singular step and the milestone copy at the edges', async () => {
    getBadgesMock.mockResolvedValue(computeBadges({ ...EMPTY, vouchedFor: 5, streakBest: 3 }));
    await render(<BadgeGallery address="GOWNER" />);
    expect(tile('connector').textContent).toContain('Vouched for 5 people');
    expect(tile('fourWeeks').textContent).toContain('1 more week to go');
  });

  it('renders in Turkish, with the name placed by the locale template', async () => {
    locale.current = 'tr';
    getBadgesMock.mockResolvedValue(
      computeBadges({ ...EMPTY, vouchedBy: 1, firstVoucher: { address: ALICE, handle: 'alice' } }),
    );
    await render(<BadgeGallery address="GOWNER" />);
    expect(container.querySelector('h2')?.textContent).toBe('Kilometre taşı rozetleri');
    expect(tile('firstStar').textContent).toContain('@alice yaktı');
    expect(tile('connector').textContent).toContain('Desteklenecek 5 kişi daha');
  });

  it('hides locked dead-end badges under FOCUS_MODE', async () => {
    focus.on = true;
    getBadgesMock.mockResolvedValue(computeBadges(EMPTY));
    await render(<BadgeGallery address="GOWNER" />);
    expect(container.querySelectorAll('[data-badge]')).toHaveLength(3);
    expect(tile('generous')).toBeNull();
  });

  it('shows an error with a retry instead of fake zeros when the read fails', async () => {
    getBadgesMock.mockRejectedValueOnce(new Error('rpc down'));
    await render(<BadgeGallery address="GOWNER" />);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Couldn't read badges");
    expect(container.querySelector('[data-badge]')).toBeNull();

    getBadgesMock.mockResolvedValueOnce(computeBadges(EMPTY));
    await act(async () => {
      container.querySelector('button')!.click();
      await Promise.resolve();
    });
    expect(getBadgesMock).toHaveBeenCalledTimes(2);
    expect(container.querySelectorAll('[data-badge]')).toHaveLength(6);
  });

  it('has every badge string in both locales', () => {
    const ids = computeBadges(EMPTY).map((b) => b.id);
    const keys = ['frame', 'heading', 'loading', 'earned', 'locked', 'error', 'retry'].map((k) => `badges.${k}`);
    for (const id of ids) keys.push(`badges.${id}.name`, `badges.${id}.desc`);
    for (const b of computeBadges(EMPTY)) {
      if (b.remaining === undefined) keys.push(`badges.${b.id}.next`);
      else keys.push(`badges.${b.id}.next.one`, `badges.${b.id}.next.other`);
    }
    keys.push('badges.firstStar.by', 'badges.generous.by');
    const enKeys = en as Record<string, string>;
    const trKeys = tr as Record<string, string>;
    for (const k of keys) {
      expect(enKeys[k], `en ${k}`).toBeTruthy();
      expect(trKeys[k], `tr ${k}`).toBeTruthy();
    }
    expect(Object.keys(enKeys).filter((k) => k.startsWith('badges.')).sort()).toEqual(
      Object.keys(trKeys).filter((k) => k.startsWith('badges.')).sort(),
    );
  });
});
