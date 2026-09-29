import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { wallet } = vi.hoisted(() => ({
  wallet: { profile: null as null | { handle: string; address: string } },
}));

vi.mock('@/components/wallet/wallet-provider', () => ({ useWallet: () => wallet }));

import { InviteNudge } from './InviteNudge';

const KEY = 'alvinmunk.ref';

describe('InviteNudge', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    sessionStorage.clear();
    wallet.profile = { handle: 'alice', address: 'GALICE' };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render() {
    await act(async () => {
      root.render(<InviteNudge />);
    });
  }

  it('nudges a vouch-back to an inviter who is someone else', async () => {
    sessionStorage.setItem(KEY, 'bob');
    await render();
    expect(container.textContent).toContain('@bob');
    expect(container.textContent).toContain('invited you');
    expect(sessionStorage.getItem(KEY)).toBe('bob');
  });

  it('shows nothing for your own link and clears the ref', async () => {
    sessionStorage.setItem(KEY, 'alice');
    await render();
    expect(container.innerHTML).toBe('');
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('matches your own handle regardless of case and a leading @', async () => {
    wallet.profile = { handle: 'Alice', address: 'GALICE' };
    sessionStorage.setItem(KEY, '@ALICE');
    await render();
    expect(container.innerHTML).toBe('');
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('shows the normalized inviter handle', async () => {
    sessionStorage.setItem(KEY, '@Bob');
    await render();
    expect(container.textContent).toContain('@bob invited you');
  });

  it('shows nothing without a stored ref', async () => {
    await render();
    expect(container.innerHTML).toBe('');
  });

  it('waits for a profile before showing anything', async () => {
    wallet.profile = null;
    sessionStorage.setItem(KEY, 'alice');
    await render();
    expect(container.innerHTML).toBe('');
    // The profile arrives and turns out to be the inviter: still no nudge.
    wallet.profile = { handle: 'alice', address: 'GALICE' };
    await render();
    expect(container.innerHTML).toBe('');
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('dismissing hides the nudge and clears the ref', async () => {
    sessionStorage.setItem(KEY, 'bob');
    await render();
    await act(async () => {
      container.querySelector('button')!.click();
    });
    expect(container.innerHTML).toBe('');
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });
});
