import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// VouchCompose and its children rely on Next's automatic JSX runtime; this vitest setup
// compiles JSX to `React.createElement`, so give them a global React to resolve.
(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { mintVouchMock, toastMock } = vi.hoisted(() => ({
  mintVouchMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}));
const WALLET = { kind: 'dev', address: 'GME' };

vi.mock('@/lib/wallet', () => ({ getWallet: async () => WALLET }));
vi.mock('@/lib/contracts', () => ({
  readPublic: vi.fn(),
  readContract: vi.fn(),
  invokeAndWait: vi.fn(),
  repId: () => 'CREP',
  questId: () => 'CQUEST',
  args: {},
}));
vi.mock('@/lib/reputation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/reputation')>()),
  mintVouch: mintVouchMock,
}));
vi.mock('@/lib/myvouches', () => ({
  addMyVouch: vi.fn(),
  subscribeToVouchPush: vi.fn(async () => {}),
}));
vi.mock('@/lib/track', () => ({ track: vi.fn(), trackError: vi.fn() }));
vi.mock('@/components/ui/toaster', () => ({ toast: toastMock }));
vi.mock('@/components/fx/frame', () => ({
  Frame: (p: { children: React.ReactNode }) => p.children,
}));
vi.mock('@/components/fx/border-beam', () => ({ BorderBeam: () => null }));
vi.mock('@/components/ui/state-art', () => ({ StateArt: () => null }));
vi.mock('@/components/ui/sticker', () => ({ Sticker: () => null }));

import { VouchCompose } from './VouchCompose';

describe('VouchCompose note', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mintVouchMock.mockReset().mockResolvedValue({ id: 7, secret: 'ab' });
    toastMock.success.mockReset();
    toastMock.error.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function mount() {
    await act(async () => root.render(<VouchCompose />));
  }
  const textarea = () => container.querySelector('textarea')!;
  async function typeNote(text: string) {
    const el = textarea();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  async function mint() {
    const button = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Light their star',
    )!;
    await act(async () => button.click());
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
  }

  it('caps the note at 60 characters, two- and four-byte ones included', async () => {
    await mount();
    await typeNote('ş'.repeat(70));
    expect(textarea().value).toBe('ş'.repeat(60));
    await typeNote('💧'.repeat(61));
    expect(textarea().value).toBe('💧'.repeat(60));
  });

  it('mints the capped note, which fits the contract’s 240 bytes', async () => {
    await mount();
    await typeNote('💧'.repeat(80));
    await mint();
    expect(mintVouchMock).toHaveBeenCalledWith(WALLET, '💧'.repeat(60));
  });

  it('explains a note the contract rejects as too long (#12)', async () => {
    mintVouchMock.mockRejectedValue(new Error('HostError: Error(Contract, #12)'));
    await mount();
    await typeNote('gm');
    await mint();
    expect(toastMock.error).toHaveBeenCalledWith('Keep the note to 60 characters or fewer.');
    expect(container.textContent).toContain('Keep the note to 60 characters or fewer.');
  });
});
