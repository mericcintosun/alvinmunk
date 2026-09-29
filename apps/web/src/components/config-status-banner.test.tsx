import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigStatusBanner } from './config-status-banner';

// Next's automatic JSX runtime is compiled to `React.createElement` here, so provide a global.
(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Let the mocked fetch promise chain settle inside act. */
const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

function mockHealth(reply: Promise<unknown>) {
  const fetchMock = vi.fn().mockReturnValue(reply);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
const healthSays = (body: unknown) => mockHealth(Promise.resolve({ json: async () => body }));

describe('ConfigStatusBanner', () => {
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
    vi.unstubAllGlobals();
  });

  async function mount() {
    await act(async () => root.render(<ConfigStatusBanner />));
    await flush();
  }

  const banner = () => container.querySelector('[data-testid="config-status-banner"]');

  it('asks /api/health once, uncached', async () => {
    const fetchMock = healthSays({ ok: true, configErrors: [] });
    await mount();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/health', { cache: 'no-store' });
  });

  it('renders nothing when the config is consistent', async () => {
    healthSays({ ok: true, configErrors: [] });
    await mount();
    expect(banner()).toBeNull();
  });

  it('renders nothing when the health reply is only about the RPC', async () => {
    // A 503 for a stalled RPC is not a misconfiguration: the app must not be taken over.
    healthSays({ ok: false, rpc: 'stalled', configErrors: [] });
    await mount();
    expect(banner()).toBeNull();
  });

  it('lists every config problem under a clear alert', async () => {
    healthSays({ ok: false, configErrors: ['bad passphrase', 'testnet rpc on mainnet'] });
    await mount();

    expect(banner()?.getAttribute('role')).toBe('alert');
    expect(banner()?.textContent).toContain(
      'This deployment is misconfigured — nothing can be sent until it is fixed.',
    );
    expect([...container.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'bad passphrase',
      'testnet rpc on mainnet',
    ]);
  });

  it('stays quiet when the probe fails or answers something unexpected', async () => {
    mockHealth(Promise.reject(new Error('offline')));
    await mount();
    expect(banner()).toBeNull();

    healthSays({ configErrors: 'not a list' });
    await act(async () => root.render(<ConfigStatusBanner key="again" />));
    await flush();
    expect(banner()).toBeNull();
  });
});
