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
