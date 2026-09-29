import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getWalletMock,
  mintVouchMock,
  addMyVouchMock,
  subscribeMock,
  trackMock,
  trackErrorMock,
  toastMock,
} = vi.hoisted(() => ({
  getWalletMock: vi.fn(),
  mintVouchMock: vi.fn(),
  addMyVouchMock: vi.fn(),
  subscribeMock: vi.fn(),
  trackMock: vi.fn(),
  trackErrorMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/i18n')>();
  return { ...actual, useTranslations: () => actual.getTranslations('en') };
});
vi.mock('@/lib/wallet', () => ({ getWallet: getWalletMock }));
vi.mock('@/lib/reputation', () => ({ mintVouch: mintVouchMock }));
vi.mock('@/lib/myvouches', () => ({
  addMyVouch: addMyVouchMock,
  subscribeToVouchPush: subscribeMock,
}));
vi.mock('@/lib/track', () => ({ track: trackMock, trackError: trackErrorMock }));
vi.mock('@/components/ui/toaster', () => ({ toast: toastMock }));
vi.mock('@alvinmunk/shared', () => ({
  buildClaimUrl: (origin: string, id: string) => `${origin}/claim/${id}`,
}));
// Decorative chrome + the QR component are stubbed so this test is about the
// reveal behaviour and the exact value handed to the QR encoder.
vi.mock('@/components/fx/frame', () => ({
  Frame: ({ children }: { children?: React.ReactNode }) => children,
}));
vi.mock('@/components/fx/border-beam', () => ({ BorderBeam: () => null }));
vi.mock('@/components/ui/state-art', () => ({ StateArt: () => null }));
vi.mock('@/components/ui/sticker', () => ({ Sticker: () => null }));
vi.mock('@/components/fx/qr-code', () => ({
  QrCode: ({ value, label }: { value: string; label: string }) => (
    <div data-testid="qr" data-value={value} aria-label={label} />
  ),
}));

import { VouchCompose } from './VouchCompose';

describe('VouchCompose claim QR (#215)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    getWalletMock.mockResolvedValue({ address: 'GADDRESS', kind: 'freighter' });
    mintVouchMock.mockResolvedValue({ id: '42', secret: 'sekret' });
    subscribeMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  async function render(ui: React.ReactElement) {
    await act(async () => {
      root.render(ui);
      await Promise.resolve();
    });
  }

  async function click(el: Element) {
    await act(async () => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
  }

  it('keeps the claim QR hidden until the user reveals it, then encodes the claim link with the secret', async () => {
    await render(<VouchCompose />);

    const mint = [...container.querySelectorAll('button')].find((b) =>
      /light their star/i.test(b.textContent ?? ''),
    );
    expect(mint, 'expected the mint button').toBeTruthy();
    await click(mint!);

    // Success state is shown, but the QR is not part of the DOM.
    expect(container.textContent).toMatch(/their star is lit/i);
    expect(container.querySelector('[data-testid="qr"]')).toBeNull();

    const toggle = container.querySelector(
      'button[aria-controls="vouch-claim-qr"]',
    ) as HTMLButtonElement;
    expect(toggle, 'expected the QR reveal toggle').not.toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    await click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const qr = container.querySelector('[data-testid="qr"]') as HTMLElement;
    expect(qr).not.toBeNull();
    // The QR encodes the full claim link, including the bearer secret (#s=).
    expect(qr.getAttribute('data-value')).toContain('/claim/42#s=sekret');
    // And the warning about it being a bearer secret is shown.
    expect(container.textContent).toMatch(/bearer secret/i);

    // Toggling back hides it again.
    await click(toggle);
    expect(container.querySelector('[data-testid="qr"]')).toBeNull();
  });
});
