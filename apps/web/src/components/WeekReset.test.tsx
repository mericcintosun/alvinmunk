import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../messages/en.json';
import tr from '../../messages/tr.json';

const { getWeekBoundsMock, locale } = vi.hoisted(() => ({
  getWeekBoundsMock: vi.fn(),
  locale: { current: 'en' as 'en' | 'tr' },
}));

vi.mock('@/lib/quests', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/quests')>()),
  getWeekBounds: getWeekBoundsMock,
}));
// The real message tables, with the locale switchable per test.
vi.mock('@/lib/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/i18n')>();
  return {
    ...actual,
    useTranslations: () => actual.getTranslations(locale.current),
    useLocale: () => ({ locale: locale.current, setLocale: () => {} }),
  };
});

import { WeekReset } from './WeekReset';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WEEK = 604_800;
// Thursday 2026-10-01 00:00:00 UTC through Wednesday 2026-10-07 23:59:59 UTC.
const START = 1_790_812_800;
const THIS_WEEK = { start: START, end: START + WEEK - 1 };
const NEXT_WEEK = { start: START + WEEK, end: START + 2 * WEEK - 1 };
const ME = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

describe('WeekReset', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    locale.current = 'en';
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  /** Seconds before the reset at the end of THIS_WEEK. */
  const before = (secs: number) => (THIS_WEEK.end + 1 - secs) * 1000;

  async function render(onRollover?: () => void) {
    await act(async () => {
      root.render(<WeekReset address={ME} onRollover={onRollover} />);
    });
  }

  async function advance(ms: number) {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
  }

  it('counts down to the reset from the chain week bounds', async () => {
    getWeekBoundsMock.mockResolvedValue(THIS_WEEK);
    vi.setSystemTime(before(2 * 86_400 + 3 * 3_600 + 30));
    await render();
    expect(getWeekBoundsMock).toHaveBeenCalledWith(ME);
    expect(container.textContent).toBe('resets in 2d 3h');
    expect(container.querySelector('span')!.title).toMatch(/^The streak week resets \S/);
  });

  it('switches to hours and minutes, then minutes, as the reset nears', async () => {
    getWeekBoundsMock.mockResolvedValue(THIS_WEEK);
    vi.setSystemTime(before(5 * 3_600 + 30 * 60));
    await render();
    expect(container.textContent).toBe('resets in 5h 30m');

    vi.setSystemTime(before(10 * 60 + 30));
    await advance(30_000);
    expect(container.textContent).toBe('resets in 10m');
  });

  it('renders nothing when the deployed contract has no get_week_bounds', async () => {
    getWeekBoundsMock.mockResolvedValue(null);
    vi.setSystemTime(before(3_600));
    await render();
    expect(container.innerHTML).toBe('');
    await advance(60_000);
    expect(container.innerHTML).toBe('');
    expect(getWeekBoundsMock).toHaveBeenCalledOnce();
  });

  it('re-reads the bounds and reports the rollover once the week is over', async () => {
    const onRollover = vi.fn();
    getWeekBoundsMock.mockResolvedValueOnce(THIS_WEEK).mockResolvedValueOnce(NEXT_WEEK);
    vi.setSystemTime(before(10));
    await render(onRollover);
    expect(container.textContent).toBe('resets in 1m');

    // The next tick is past the reset: re-read once, tell the parent, show the new week.
    await advance(30_000);
    expect(getWeekBoundsMock).toHaveBeenCalledTimes(2);
    expect(onRollover).toHaveBeenCalledOnce();
    expect(container.textContent).toBe('resets in 7d 0h');

    // A tick inside the new week reads nothing more.
    await advance(30_000);
    expect(getWeekBoundsMock).toHaveBeenCalledTimes(2);
    expect(onRollover).toHaveBeenCalledOnce();
  });

  it('keeps showing the reset while the ledger still reports the old week', async () => {
    const onRollover = vi.fn();
    getWeekBoundsMock.mockResolvedValue(THIS_WEEK);
    vi.setSystemTime(before(-5));
    await render(onRollover);
    expect(container.textContent).toBe('resetting now…');

    // One re-read per tick, not a tight loop.
    await advance(30_000);
    expect(getWeekBoundsMock).toHaveBeenCalledTimes(2);
    await advance(30_000);
    expect(getWeekBoundsMock).toHaveBeenCalledTimes(3);
    expect(onRollover).toHaveBeenCalledTimes(2);
  });

  it('speaks Turkish', async () => {
    locale.current = 'tr';
    getWeekBoundsMock.mockResolvedValue(THIS_WEEK);
    vi.setSystemTime(before(2 * 86_400 + 3 * 3_600 + 30));
    await render();
    expect(container.textContent).toBe('2g 3sa sonra yenilenir');
    expect(container.querySelector('span')!.title).toMatch(/^Seri haftasının yenilenmesi: \S/);
  });

  it('has every countdown string in both locales', () => {
    const pick = (m: Record<string, string>) =>
      Object.keys(m)
        .filter((k) => k.startsWith('quests.week.'))
        .sort();
    expect(pick(en).length).toBe(5);
    expect(pick(tr)).toEqual(pick(en));
    for (const k of pick(en)) expect((tr as Record<string, string>)[k], k).toBeTruthy();
  });
});
