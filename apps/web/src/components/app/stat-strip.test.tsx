import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// I18nProvider's JSX compiles against a global `React` (it has no local import of its
// own) — see app-tabs.test.tsx for the same pattern.
(globalThis as { React?: typeof React }).React = React;

const { getScoresMock, getPeopleCountsMock } = vi.hoisted(() => ({
  getScoresMock: vi.fn(),
  getPeopleCountsMock: vi.fn(),
}));

vi.mock('@/lib/reputation', () => ({ getScores: getScoresMock }));
vi.mock('@/lib/constellation', () => ({ getPeopleCounts: getPeopleCountsMock }));

import { StatStrip } from './stat-strip';
import { I18nProvider } from '@/lib/i18n';

describe('StatStrip', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  async function render() {
    await act(async () => {
      root.render(<StatStrip address="GB123" />);
      await Promise.resolve();
    });
  }

  function tile(label: string): string {
    const el = Array.from(container.querySelectorAll('span')).find((s) => s.textContent === label);
    return el?.closest('div.glass')?.textContent ?? '';
  }

  it('shows the people-who-vouched count, not a Social XP roll-up', async () => {
    // 20 starter XP alone used to read as "2 stars"; the tile must show the real count.
    getScoresMock.mockResolvedValue({ social: 20, earned: 0 });
    getPeopleCountsMock.mockResolvedValue({ vouchedBy: 0, backed: 0 });
    await render();
    expect(tile('Vouched by')).toContain('0');
    expect(tile('Vouched by')).not.toContain('2');
    expect(tile('Social XP')).toContain('20');
  });

  it('renders the durable count reported for the address', async () => {
    getScoresMock.mockResolvedValue({ social: 55, earned: 30 });
    getPeopleCountsMock.mockResolvedValue({ vouchedBy: 7, backed: 2 });
    await render();
    expect(getPeopleCountsMock).toHaveBeenCalledWith('GB123');
    expect(tile('Vouched by')).toContain('7');
    expect(tile('Earned XP')).toContain('30');
    expect(container.textContent).not.toContain('Your constellation is still quiet');
  });

  it('keeps the last numbers on screen while a refresh is in flight', async () => {
    vi.useFakeTimers();
    try {
      getScoresMock
        .mockResolvedValueOnce({ social: 55, earned: 30 })
        .mockReturnValueOnce(new Promise(() => {}));
      getPeopleCountsMock.mockResolvedValue({ vouchedBy: 7, backed: 2 });
      await render();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      expect(getScoresMock).toHaveBeenCalledTimes(2);
      expect(container.querySelectorAll('.animate-pulse')).toHaveLength(0);
      expect(tile('Social XP')).toContain('55');
      expect(tile('Earned XP')).toContain('30');
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops polling while the tab is hidden and refreshes once when it returns', async () => {
    vi.useFakeTimers();
    try {
      getScoresMock.mockResolvedValue({ social: 1, earned: 0 });
      getPeopleCountsMock.mockResolvedValue({ vouchedBy: 0, backed: 0 });
      await render();
      const scoresCalls = getScoresMock.mock.calls.length;
      const peopleCalls = getPeopleCountsMock.mock.calls.length;

      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(getScoresMock.mock.calls.length).toBe(scoresCalls);
      expect(getPeopleCountsMock.mock.calls.length).toBe(peopleCalls);

      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(getScoresMock.mock.calls.length).toBe(scoresCalls + 1);
      expect(getPeopleCountsMock.mock.calls.length).toBe(peopleCalls + 1);
    } finally {
      Reflect.deleteProperty(document, 'hidden');
      vi.useRealTimers();
    }
  });

  describe('compact, beside the handle on a phone (#474)', () => {
    const compactRow = () => container.querySelector('[data-testid="stat-strip-compact"]');

    it('shows the three numbers in one labelled row below sm, and the tiles from sm up', async () => {
      getScoresMock.mockResolvedValue({ social: 20, earned: 30 });
      getPeopleCountsMock.mockResolvedValue({ vouchedBy: 7, backed: 0 });
      await act(async () => {
        root.render(<StatStrip address="GB123" compact />);
        await Promise.resolve();
      });

      const row = compactRow()!;
      expect(row.classList).toContain('sm:hidden');
      const pairs = [...row.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]);
      expect(pairs).toEqual([
        ['Vouched by', '7'],
        ['Social XP', '20'],
        ['Earned XP', '30'],
      ]);
      // The tiles are still there for sm and up, hidden below it.
      const tiles = container.querySelector('div.glass')!.parentElement!.parentElement!;
      expect([...tiles.classList]).toEqual(expect.arrayContaining(['hidden', 'sm:block']));
      expect(tile('Earned XP')).toContain('30');
    });

    it('keeps a skeleton in the row until the first read lands, and polls once for both views', async () => {
      getScoresMock.mockReturnValue(new Promise(() => {}));
      getPeopleCountsMock.mockReturnValue(new Promise(() => {}));
      await act(async () => {
        root.render(<StatStrip address="GB123" compact />);
      });
      expect(compactRow()!.querySelectorAll('dd .animate-pulse')).toHaveLength(3);
      expect(getScoresMock).toHaveBeenCalledTimes(1);
      expect(getPeopleCountsMock).toHaveBeenCalledTimes(1);
    });

    it('renders no compact row without the prop', async () => {
      getScoresMock.mockResolvedValue({ social: 1, earned: 0 });
      getPeopleCountsMock.mockResolvedValue({ vouchedBy: 0, backed: 0 });
      await render();
      expect(compactRow()).toBeNull();
      expect(container.querySelector('div.glass')!.parentElement!.parentElement!.className).toBe('space-y-3');
    });
  });

  it('formats large counts with the active locale digit grouping, not a fixed en-US format', async () => {
    localStorage.setItem('alvinmunk_locale', 'tr');
    try {
      getScoresMock.mockResolvedValue({ social: 12_345, earned: 0 });
      getPeopleCountsMock.mockResolvedValue({ vouchedBy: 0, backed: 0 });
      await act(async () => {
        root.render(
          <I18nProvider>
            <StatStrip address="GB123" />
          </I18nProvider>,
        );
        await Promise.resolve();
      });
      // tr-TR groups thousands with '.', not en-US's ','.
      expect(tile('Sosyal XP')).toContain('12.345');
      expect(tile('Sosyal XP')).not.toContain('12,345');
    } finally {
      localStorage.removeItem('alvinmunk_locale');
    }
  });
});
