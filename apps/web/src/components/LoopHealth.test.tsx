import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VouchFunnel } from '@/lib/vouch-funnel';
import { LoopHealth } from './LoopHealth';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const funnel = (over: Partial<VouchFunnel> = {}): VouchFunnel => ({
  minted: 10,
  claimed: 5,
  completionRate: 0.5,
  open: 2,
  expiredUnclaimed: 3,
  expiredRate: 0.3,
  distinctVouchers: 4,
  repeatPairShare: 0.2,
  unread: 0,
  weeklyCohorts: [
    { week: '2026-01-05', minted: 6, claimed: 3, completionRate: 0.5, open: 0, expiredUnclaimed: 3 },
    { week: '2026-01-12', minted: 4, claimed: 1, completionRate: 0.25, open: 2, expiredUnclaimed: 0 },
  ],
  ...over,
});

describe('LoopHealth', () => {
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
  });

  const render = (el: React.ReactElement) => act(() => root.render(el));
  const tile = (label: string) =>
    Array.from(container.querySelectorAll('div.glass')).find((d) => d.firstElementChild?.textContent === label)
      ?.textContent ?? '';

  it('shows a loading state before the first response', () => {
    render(<LoopHealth funnel={undefined} loading />);
    expect(container.textContent).toContain('Reading vouch state');
    expect(container.querySelector('table')).toBeNull();
  });

  it('shows the read error instead of empty numbers', () => {
    render(<LoopHealth funnel={null} loading={false} error="Vouch state could not be read from RPC right now." />);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('could not be read');
    expect(container.querySelector('table')).toBeNull();
  });

  it('renders the tiles, the gate verdict and one row per mint week', () => {
    render(<LoopHealth funnel={funnel()} loading={false} />);
    expect(tile('Completion')).toContain('50.0%');
    expect(tile('Minted')).toContain('2 still open');
    expect(tile('Expired unclaimed')).toContain('30.0%');
    expect(container.textContent).toContain('Gate reached');
    const rows = Array.from(container.querySelectorAll('tbody tr')).map((r) =>
      Array.from(r.querySelectorAll('td')).map((td) => td.textContent),
    );
    expect(rows).toEqual([
      ['2026-01-05', '6', '3', '0', '3', '50.0%'],
      ['2026-01-12', '4', '1', '2', '0', '25.0%'],
    ]);
  });

  it('flags a funnel under the 40% gate and reports unread half-cards', () => {
    render(<LoopHealth funnel={funnel({ completionRate: 0.39, unread: 3 })} loading={false} />);
    expect(container.textContent).toContain('Below gate');
    expect(container.textContent).toContain('Not counted: 3 half-cards');
  });

  it('shows an empty state and no gate verdict before the first vouch', () => {
    render(
      <LoopHealth
        funnel={funnel({ minted: 0, claimed: 0, completionRate: 0, open: 0, expiredUnclaimed: 0, weeklyCohorts: [] })}
        loading={false}
      />,
    );
    expect(container.textContent).toContain('No vouches yet.');
    expect(container.textContent).not.toMatch(/Gate reached|Below gate/);
  });
});
