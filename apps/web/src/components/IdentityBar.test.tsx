import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile } from '@/lib/profile';
import type { OnChainMeta } from '@/lib/registry';

// IdentityBar and its children rely on Next's automatic JSX runtime; this vitest setup
// compiles JSX to `React.createElement`, so give them a global React to resolve.
(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { store, getMetaMock, setMetaMock, toastMock } = vi.hoisted(() => ({
  store: { initial: null as Profile | null, saved: [] as Profile[] },
  getMetaMock: vi.fn(),
  setMetaMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}));
const WALLET = { kind: 'dev', address: 'GME' };

vi.mock('@/components/wallet/wallet-provider', () => ({
  useWallet: () => {
    const [profile, set] = React.useState(store.initial);
    const setProfile = React.useCallback((p: Profile) => {
      store.saved.push(p);
      set(p);
    }, []);
    return { profile, connect: async () => WALLET, setProfile };
  },
}));
vi.mock('@/lib/contracts', () => ({
  readPublic: vi.fn(),
  invokeAndWait: vi.fn(),
  registryId: () => 'CREG',
  args: {},
}));
vi.mock('@/lib/registry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/registry')>()),
  getMeta: getMetaMock,
  setMeta: setMetaMock,
}));
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('next/link', () => ({ default: (p: { children: React.ReactNode }) => p.children }));
vi.mock('@/components/Avatar', () => ({ Avatar: () => null }));
vi.mock('@/components/AvatarRemix', () => ({ AvatarRemix: () => null }));
vi.mock('@/components/fx/share-row', () => ({ ShareRow: () => null }));

import { IdentityBar } from './IdentityBar';
import { defaultAvatarId } from '@/lib/avatar';

const ME: Profile = { handle: 'me', address: 'GME', createdAt: 1 };

describe('IdentityBar profile meta', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    store.initial = { ...ME };
    store.saved = [];
    getMetaMock.mockReset().mockResolvedValue(null);
    setMetaMock.mockReset().mockResolvedValue(undefined);
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

  async function flush() {
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
  }
  async function mount() {
    await act(async () => root.render(<IdentityBar />));
    await flush();
  }
  const byLabel = (label: string) =>
    container.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
  async function click(el: HTMLElement) {
    await act(async () => el.click());
    await flush();
  }
  async function typeBio(text: string) {
    const input = byLabel('Bio') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  async function submitBio() {
    const form = byLabel('Bio').closest('form')!;
    await act(async () =>
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    await flush();
  }

  it('adopts the face and bio published from another device', async () => {
    const meta: OnChainMeta = { avatar: { kind: 'face', id: 'face-05' }, bio: 'from my phone' };
    getMetaMock.mockResolvedValue(meta);
    await mount();
    expect(getMetaMock).toHaveBeenCalledWith('GME');
    expect(store.saved.at(-1)).toMatchObject({ avatar: meta.avatar, bio: 'from my phone' });
    expect(container.textContent).toContain('from my phone');
  });

  it('publishes a picked face with the bio already on-chain', async () => {
    getMetaMock.mockResolvedValue({ avatar: { kind: 'face', id: 'face-01' }, bio: 'keep me' });
    await mount();
    await click(byLabel('Change your face'));
    await click(byLabel('Face 04'));
    expect(setMetaMock).toHaveBeenCalledWith(WALLET, { kind: 'face', id: 'face-04' }, 'keep me');
    expect(toastMock.success).toHaveBeenCalledWith(
      'Saved on-chain — anyone opening your profile sees it.',
    );
  });

  it('a bio-only edit pins the default face everyone already sees', async () => {
    await mount();
    await click(byLabel('Edit bio'));
    await typeBio('  hello\tworld  ');
    await submitBio();
    expect(setMetaMock).toHaveBeenCalledWith(
      WALLET,
      { kind: 'face', id: defaultAvatarId('GME') },
      'hello world',
    );
    expect(store.saved.at(-1)?.bio).toBe('hello world');
  });

  it('caps the bio input at 80 UTF-8 bytes and counts bytes', async () => {
    await mount();
    await click(byLabel('Edit bio'));
    await typeBio('ş'.repeat(50));
    expect((byLabel('Bio') as HTMLInputElement).value).toBe('ş'.repeat(40));
    expect(container.textContent).toContain('80/80');
  });

  it('explains a missing handle in the user’s words', async () => {
    setMetaMock.mockRejectedValue(new Error('HostError: Error(Contract, #4)'));
    await mount();
    await click(byLabel('Change your face'));
    await click(byLabel('Face 02'));
    expect(toastMock.error).toHaveBeenCalledWith(
      'Claim your @handle on-chain first — then your face and bio can go public.',
    );
    // the pick is kept locally either way
    expect(store.saved.at(-1)?.avatar).toEqual({ kind: 'face', id: 'face-02' });
  });

  it('keeps the face local on a registry that predates set_meta', async () => {
    setMetaMock.mockRejectedValue(
      new Error(
        'HostError: Error(WasmVm, MissingValue) trying to invoke non-existent contract function',
      ),
    );
    await mount();
    await click(byLabel('Change your face'));
    await click(byLabel('Face 03'));
    expect(toastMock.error).toHaveBeenCalledWith(
      "Saved on this device. Public faces and bios aren't live on this network yet.",
    );
    expect(store.saved.at(-1)?.avatar).toEqual({ kind: 'face', id: 'face-03' });
  });
});
