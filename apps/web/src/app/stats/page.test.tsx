import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}));

globalThis.fetch = fetchMock;

import StatsPage from './page';

describe('StatsPage', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    fetchMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('shows empty dashes when API returns 500', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
    });

    await act(async () => {
      root.render(<StatsPage />);
      await Promise.resolve();
    });

    // It should render — instead of 0
    expect(container.textContent).toContain('—');
    expect(container.textContent).not.toContain('0 / 50');
    // The "0 / 50" gets rendered as "— / 50"
    expect(container.textContent).toContain('— / 50');
    expect(container.textContent).toContain('stale');
  });

  it('switches to stale when API poll fails', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        network: 'testnet',
        configured: true,
        users: 12,
        target: 50,
        addresses: ['G123'],
      }),
    });

    await act(async () => {
      root.render(<StatsPage />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain('12 / 50');
    expect(container.textContent).toContain('live');

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    await act(async () => {
      vi.advanceTimersByTime(10000);
      await Promise.resolve();
    });

    // The user count should remain on the screen, but state switches to stale
    expect(container.textContent).toContain('12 / 50');
    expect(container.textContent).toContain('stale');
  });
});

/** Issue #216: a wallet row opens its in-app score page, with stellar.expert one tap away. */
describe('StatsPage — wallet rows (issue #216)', () => {
  let root: Root;
  let container: HTMLDivElement;

  const G = 'GABCDEFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUVWXYZ';
  const C = 'CABCDEFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUVWXYZ';

  const stats = (network: string) => ({
    ok: true,
    json: async () => ({ network, configured: true, users: 2, target: 50, addresses: [G, C] }),
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    fetchMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  const linksTo = (prefix: string) =>
    Array.from(container.querySelectorAll('a')).filter((a) =>
      a.getAttribute('href')?.startsWith(prefix),
    );

  it('links each testnet wallet to /score/<address> and keeps stellar.expert as a new-tab icon', async () => {
    fetchMock.mockResolvedValue(stats('testnet'));
    await act(async () => {
      root.render(<StatsPage />);
      await Promise.resolve();
    });

    const score = linksTo('/score/');
    expect(score.map((a) => a.getAttribute('href'))).toEqual([`/score/${G}`, `/score/${C}`]);
    expect(score[0].getAttribute('aria-label')).toBe('Score for GABCDE…UVWXYZ');
    expect(score[0].getAttribute('target')).toBeNull();

    const out = linksTo('https://stellar.expert/');
    expect(out.map((a) => a.getAttribute('href'))).toEqual([
      `https://stellar.expert/explorer/testnet/account/${G}`,
      `https://stellar.expert/explorer/testnet/contract/${C}`,
    ]);
    expect(out[0].getAttribute('target')).toBe('_blank');
    expect(out[0].getAttribute('aria-label')).toBe(
      'GABCDE…UVWXYZ on stellar.expert (opens in a new tab)',
    );
  });

  it('keeps mainnet wallets on stellar.expert: /score reads the app’s own contracts', async () => {
    fetchMock.mockResolvedValue(stats('mainnet'));
    await act(async () => {
      root.render(<StatsPage />);
      await Promise.resolve();
    });
    const mainnetTab = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Mainnet',
    );
    await act(async () => {
      mainnetTab?.click();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenLastCalledWith('/api/stats?network=mainnet', { cache: 'no-store' });
    expect(linksTo('/score/')).toHaveLength(0);
    const out = linksTo('https://stellar.expert/explorer/public/');
    expect(out.map((a) => a.getAttribute('href'))).toEqual([
      `https://stellar.expert/explorer/public/account/${G}`,
      `https://stellar.expert/explorer/public/contract/${C}`,
    ]);
  });
});
