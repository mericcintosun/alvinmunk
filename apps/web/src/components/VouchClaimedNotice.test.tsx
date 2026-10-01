import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const push = vi.hoisted(() => ({
  registerServiceWorker: vi.fn(async () => null),
  requestPermission: vi.fn(async () => 'granted' as NotificationPermission),
  getPermission: vi.fn(() => 'default' as NotificationPermission),
  getActivePushSubscription: vi.fn(async () => null),
  getPushAvailabilityHint: vi.fn(() => null),
  subscribeToPush: vi.fn(async () => null),
  syncPushSubscription: vi.fn(async () => undefined),
}));
const WALLET = 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA';

vi.mock('@/lib/push', () => push);
vi.mock('@/lib/myvouches', () => ({ pollNewlyClaimed: async () => [], getPendingVouchIds: () => [] }));
vi.mock('@/components/wallet/wallet-provider', () => ({
  useWallet: () => ({ profile: { handle: 'ada', address: WALLET, createdAt: 0 } }),
}));
vi.mock('@/components/ui/toaster', () => ({ toast: { success: vi.fn() } }));

import { VouchClaimedNotice } from './VouchClaimedNotice';

describe('VouchClaimedNotice push opt-in (#297)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'BPub');
    Object.defineProperty(navigator, 'serviceWorker', { value: {}, configurable: true });
    Object.assign(window, { PushManager: function PushManager() {}, Notification: { permission: 'default' } });
    for (const fn of Object.values(push)) fn.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
  });

  it('subscribes the wallet on Enable, with no vouch minted', async () => {
    await act(async () => root.render(<VouchClaimedNotice />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    const enable = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Enable')!;
    expect(enable).toBeDefined();

    await act(async () => enable.click());

    expect(push.requestPermission).toHaveBeenCalled();
    expect(push.subscribeToPush).toHaveBeenCalledWith(WALLET);
  });

  it('does not subscribe when permission is refused', async () => {
    push.requestPermission.mockResolvedValueOnce('denied');
    await act(async () => root.render(<VouchClaimedNotice />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    const enable = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Enable')!;
    await act(async () => enable.click());
    expect(push.subscribeToPush).not.toHaveBeenCalled();
  });
});
