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

const { store, getMetaMock, setMetaMock, availabilityMock, claimHandleMock, toastMock } =
  vi.hoisted(() => ({
    store: { initial: null as Profile | null, saved: [] as Profile[] },
    getMetaMock: vi.fn(),
    setMetaMock: vi.fn(),
    availabilityMock: vi.fn(),
    claimHandleMock: vi.fn(),
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
  handleAvailability: availabilityMock,
  claimHandle: claimHandleMock,
}));
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('next/link', () => ({ default: (p: { children: React.ReactNode }) => p.children }));
vi.mock('@/components/Avatar', () => ({ Avatar: () => null }));
vi.mock('@/components/AvatarRemix', () => ({ AvatarRemix: () => null }));
vi.mock('@/components/fx/share-row', () => ({ ShareRow: () => null }));

import { IdentityBar } from './IdentityBar';
import { defaultAvatarId } from '@/lib/avatar';
import { buttonVariants } from '@/components/ui/button';

// jsdom has no layout, so the hit area is asserted through the classes that size it:
// `h-N w-N` is N × 4px, and hover / focus-visible must be the ghost icon button's own.
const GHOST_STATES = buttonVariants({ variant: 'ghost', size: 'icon' })
  .split(' ')
  .filter((c) => c.startsWith('hover:') || c.startsWith('focus-visible:'));
function expectInlineIconButton(el: HTMLElement | null) {
  expect(el?.tagName).toBe('BUTTON');
  expect(el?.getAttribute('type')).toBe('button');
  const cls = el!.className.split(/\s+/);
  const px = (axis: 'h' | 'w') =>
    Number(cls.find((c) => new RegExp(`^${axis}-\\d+$`).test(c))?.slice(2)) * 4;
  expect(px('h')).toBeGreaterThanOrEqual(32);
  expect(px('w')).toBeGreaterThanOrEqual(32);
  // the negative margin keeps the row's layout (and 375px wrapping) as it was with a bare glyph
  expect(cls).toEqual(expect.arrayContaining(['rounded-full', '-m-2', ...GHOST_STATES]));
}

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

  it('gives every inline edit and cancel control a 32px ghost icon hit area', async () => {
    await mount();
    expectInlineIconButton(byLabel('Edit handle'));
    expectInlineIconButton(byLabel('Edit bio'));
    await click(byLabel('Edit handle'));
    expectInlineIconButton(byLabel('Cancel'));
    await click(byLabel('Edit bio'));
    expectInlineIconButton(byLabel('Cancel bio edit'));
    // the controls still work
    await click(byLabel('Cancel'));
    await click(byLabel('Cancel bio edit'));
    expect(container.querySelector('[aria-label="New handle"]')).toBeNull();
    expect(container.querySelector('[aria-label="Bio"]')).toBeNull();
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

describe('IdentityBar rename', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    store.initial = { ...ME };
    store.saved = [];
    getMetaMock.mockReset().mockResolvedValue(null);
    availabilityMock.mockReset();
    claimHandleMock.mockReset().mockResolvedValue(undefined);
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
  async function rename(to: string) {
    await act(async () => root.render(<IdentityBar />));
    await flush();
    await act(async () =>
      container.querySelector<HTMLElement>('[aria-label="Edit handle"]')!.click(),
    );
    const input = container.querySelector<HTMLInputElement>('[aria-label="New handle"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(input, to);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () =>
      input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    await flush();
  }

  it('explains a handle cooling down for its previous owner and signs nothing', async () => {
    availabilityMock.mockResolvedValue({ status: 'reserved', until: new Date('2026-10-29T12:00:00Z') });
    await rename('alice');
    expect(availabilityMock).toHaveBeenCalledWith('alice', 'GME');
    expect(toastMock.error).toHaveBeenCalledWith(
      `@alice was just freed and is held for its previous owner until ${new Date(
        '2026-10-29T12:00:00Z',
      ).toLocaleDateString('en', { dateStyle: 'medium' })} — pick another.`,
    );
    expect(claimHandleMock).not.toHaveBeenCalled();
  });

  it('renames onto a handle this wallet freed, which is free for it', async () => {
    availabilityMock.mockResolvedValue({ status: 'free' });
    await rename('old_me');
    expect(availabilityMock).toHaveBeenCalledWith('old_me', 'GME');
    expect(claimHandleMock).toHaveBeenCalledWith(WALLET, 'old_me');
    expect(store.saved.at(-1)).toMatchObject({ handle: 'old_me' });
  });

  it('still refuses a handle someone holds', async () => {
    availabilityMock.mockResolvedValue({ status: 'taken' });
    await rename('taken');
    expect(toastMock.error).toHaveBeenCalledWith('@taken is taken — pick another.');
    expect(claimHandleMock).not.toHaveBeenCalled();
  });
});
