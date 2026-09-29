import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigStatusBanner } from './config-status-banner';

// React 18 only considers `act()` "configured" when this flag is set; without it every
// state update logs "The current testing environment is not configured to support act".
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Let the mocked fetch promise chain settle inside act. */
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function mockHealth(body: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => body }));
}

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

  it('renders nothing when the config is healthy', async () => {
    mockHealth({ ok: true, configErrors: [] });
    await act(async () => root.render(<ConfigStatusBanner />));
    await flush();
    expect(container.querySelector('[data-testid="config-status-banner"]')).toBeNull();
  });

  it('shows every config error in a blocking alert', async () => {
    mockHealth({ ok: false, configErrors: ['bad passphrase', 'testnet rpc on mainnet'] });
    await act(async () => root.render(<ConfigStatusBanner />));
    await flush();
    const banner = container.querySelector('[data-testid="config-status-banner"]');
    expect(banner).not.toBeNull();
    expect(banner?.getAttribute('role')).toBe('alert');
    expect(container.textContent).toContain('bad passphrase');
    expect(container.textContent).toContain('testnet rpc on mainnet');
  });
});
