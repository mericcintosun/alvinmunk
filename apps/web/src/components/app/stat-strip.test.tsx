import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getScoresMock, getPeopleCountsMock } = vi.hoisted(() => ({
  getScoresMock: vi.fn(),
  getPeopleCountsMock: vi.fn(),
}));

vi.mock('@/lib/reputation', () => ({ getScores: getScoresMock }));
vi.mock('@/lib/constellation', () => ({ getPeopleCounts: getPeopleCountsMock }));

import { StatStrip } from './stat-strip';

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
});
