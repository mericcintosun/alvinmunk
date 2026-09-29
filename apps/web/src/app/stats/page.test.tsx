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
