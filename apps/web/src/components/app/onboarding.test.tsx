import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Wallet } from '@/lib/wallet';
import type { Profile } from '@/lib/profile';

// Next's automatic JSX runtime is compiled to `React.createElement` here, so provide a global.
(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const {
  connectMock,
  setProfileMock,
  restoreProfileMock,
  claimHandleMock,
  handleAvailabilityMock,
  recordGenesisMock,
  trackErrorMock,
  toastMock,
} = vi.hoisted(() => ({
  connectMock: vi.fn(),
  setProfileMock: vi.fn(),
  restoreProfileMock: vi.fn(),
  claimHandleMock: vi.fn(),
  handleAvailabilityMock: vi.fn(),
  recordGenesisMock: vi.fn(),
  trackErrorMock: vi.fn(),
  toastMock: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock('@/components/wallet/wallet-provider', () => ({
  useWallet: () => ({ connect: connectMock, setProfile: setProfileMock, restoreProfile: restoreProfileMock }),
}));
vi.mock('@/lib/wallet', () => ({
  AccountNotFoundError: class AccountNotFoundError extends Error {},
}));
vi.mock('@/lib/genesis', () => ({ recordGenesis: recordGenesisMock }));
vi.mock('@/lib/registry', () => ({
  claimHandle: claimHandleMock,
  handleAvailability: handleAvailabilityMock,
}));
vi.mock('@/lib/track', () => ({ track: vi.fn(), identify: vi.fn(), trackError: trackErrorMock }));
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('@/components/brand/crest', () => ({ Crest: () => null }));
vi.mock('@/components/AvatarPicker', () => ({ AvatarPicker: () => null }));
vi.mock('@/lib/assets', () => ({ asset: (f: string) => f }));

import { Onboarding } from './onboarding';
import { AccountNotFoundError } from '@/lib/wallet';

const WALLET = { kind: 'passkey', address: 'CACCOUNT' } as unknown as Wallet;
const HELD: Profile = { handle: 'alvin', address: 'CACCOUNT', createdAt: 1 };

describe('Onboarding — returning users (#278)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    for (const m of [connectMock, setProfileMock, restoreProfileMock, trackErrorMock, toastMock, toastMock.success, toastMock.error]) {
      m.mockReset();
    }
    connectMock.mockResolvedValue(WALLET);
    restoreProfileMock.mockResolvedValue(null);
    claimHandleMock.mockReset().mockResolvedValue(undefined);
    handleAvailabilityMock.mockReset().mockResolvedValue({ status: 'free' });
    recordGenesisMock.mockReset().mockResolvedValue('TX');
    vi.spyOn(console, 'error').mockImplementation(() => {}); // the component logs each failure
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.mocked(console.error).mockRestore();
  });

  async function flush() {
    await act(async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
  }

  async function mount(initialHandle?: string) {
    await act(async () => root.render(<Onboarding initialHandle={initialHandle} />));
    await flush();
  }

  const buttonWith = (text: string) =>
    [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!;

  async function click(el: HTMLElement) {
    await act(async () => el.click());
    await flush();
  }

  async function typeHandle(value: string) {
    const input = container.querySelector<HTMLInputElement>('[aria-label="Handle"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flush();
  }

  async function submit() {
    const form = container.querySelector('[aria-label="Handle"]')!.closest('form')!;
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await flush();
  }

  const restore = async () => click(buttonWith('I already have an account'));

  describe('"I already have an account"', () => {
    it('connects in recover mode and adopts the handle the account holds', async () => {
      restoreProfileMock.mockResolvedValue(HELD);
      await mount();

      await restore();

      expect(connectMock).toHaveBeenCalledWith('recover');
      expect(restoreProfileMock).toHaveBeenCalledWith(WALLET);
      expect(toastMock.success).toHaveBeenCalledWith('Welcome back — @alvin restored.');
      expect(claimHandleMock).not.toHaveBeenCalled();
    });

    it('says so when no account exists for the passkey', async () => {
      connectMock.mockRejectedValue(new AccountNotFoundError());
      await mount();

      await restore();

      expect(toastMock.error).toHaveBeenCalledWith(
        'No account found for that passkey — create a new one, or use the device where you first signed up.',
      );
      expect(restoreProfileMock).not.toHaveBeenCalled();
      expect(trackErrorMock).not.toHaveBeenCalled(); // an answer, not a failure
    });

    it('points at the form when the account never claimed a handle', async () => {
      await mount();

      await restore();

      expect(toastMock).toHaveBeenCalledWith('Found your account — it has no handle yet. Pick one above to finish.');
      expect(toastMock.error).not.toHaveBeenCalled();
      expect(claimHandleMock).not.toHaveBeenCalled();
    });

    it('reports a network failure as one, not as "no account"', async () => {
      connectMock.mockRejectedValue(new Error("Couldn't reach the network to check your wallet — try again in a moment."));
      await mount();

      await restore();

      expect(toastMock.error).toHaveBeenCalledWith(
        "Couldn't reach the network to check your wallet — try again in a moment.",
      );
      expect(trackErrorMock).toHaveBeenCalledWith(expect.any(Error), { flow: 'restore_account', from: 'app' });
    });
  });

  describe('create my profile', () => {
    it('never claims a handle for an address that already holds one', async () => {
      restoreProfileMock.mockResolvedValue(HELD);
      await mount();

      await typeHandle('bob');
      await submit();

      expect(connectMock).toHaveBeenCalledWith(); // create mode
      expect(claimHandleMock).not.toHaveBeenCalled();
      expect(recordGenesisMock).not.toHaveBeenCalled();
      expect(setProfileMock).not.toHaveBeenCalled();
      expect(toastMock.success).toHaveBeenCalledWith('Welcome back — @alvin restored.');
    });

    it('does not claim when it cannot tell whether the address holds a handle', async () => {
      restoreProfileMock.mockRejectedValue(new Error("Couldn't look up your handle — try again in a moment."));
      await mount();

      await typeHandle('bob');
      await submit();

      expect(claimHandleMock).not.toHaveBeenCalled();
      expect(toastMock.error).toHaveBeenCalledWith("Couldn't look up your handle — try again in a moment.");
    });

    it('claims a fresh handle when the address holds none', async () => {
      await mount();

      await typeHandle('bob');
      await submit();

      expect(claimHandleMock).toHaveBeenCalledWith(WALLET, 'bob');
      expect(setProfileMock).toHaveBeenCalledWith(expect.objectContaining({ handle: 'bob', address: 'CACCOUNT' }));
      expect(toastMock.success).toHaveBeenCalledWith('Your profile is live — @bob stamped on-chain.');
    });

    it('claims the handle a "Claim @x" link prefilled, without retyping it (#485)', async () => {
      await mount('bob');

      await submit();

      expect(claimHandleMock).toHaveBeenCalledWith(WALLET, 'bob');
    });

    it('labels the submit button while the profile is being created', async () => {
      let finish!: () => void;
      claimHandleMock.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
      await mount();

      await typeHandle('bob');
      await submit();

      const busy = buttonWith('Creating your profile…');
      expect(busy).toBeDefined();
      expect(busy.disabled).toBe(true);
      expect(container.textContent).not.toMatch(/onboard\./);

      await act(async () => finish());
      await flush();
      expect(buttonWith('Create my profile').disabled).toBe(false);
    });
  });

  describe('handle status', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const status = () => {
      const input = container.querySelector('[aria-label="Handle"]')!;
      // Described by its status line first, then the handle rules.
      return document.getElementById(input.getAttribute('aria-describedby')!.split(' ')[0])!;
    };

    it('announces availability in a live region tied to the input', async () => {
      await mount();
      await typeHandle('bob');
      expect(status().getAttribute('aria-live')).toBe('polite');
      expect(status().textContent).toBe('Checking…');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      expect(status().textContent).toBe('✓ @bob is free');
    });

    it('prefills a normalized initial handle and checks it without any typing (#485)', async () => {
      await mount('@Beko!');
      const input = container.querySelector<HTMLInputElement>('[aria-label="Handle"]')!;
      expect(input.value).toBe('beko');
      expect(status().textContent).toBe('Checking…');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      expect(handleAvailabilityMock).toHaveBeenCalledWith('beko', undefined);
      expect(status().textContent).toBe('✓ @beko is free');
    });

    it('starts empty and idle without an initial handle', async () => {
      await mount();
      expect(container.querySelector<HTMLInputElement>('[aria-label="Handle"]')!.value).toBe('');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      expect(handleAvailabilityMock).not.toHaveBeenCalled();
      expect(status().textContent).toBe('');
    });

    it('blocks submit for a taken handle', async () => {
      handleAvailabilityMock.mockResolvedValue({ status: 'taken' });
      await mount();
      await typeHandle('bob');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });

      expect(status().textContent).toBe('@bob is taken — try another');
      expect(buttonWith('Create my profile').disabled).toBe(true);
    });

    // #479: the rules are stated up front, dropped characters are named, and the status
    // line grows instead of overlapping the submit button when a message wraps.
    const input = () => container.querySelector<HTMLInputElement>('[aria-label="Handle"]')!;
    const rules = () => document.getElementById(input().getAttribute('aria-describedby')!.split(' ')[1])!;

    it('shows the handle rules before submitting, and caps the field at 20', async () => {
      await mount();
      expect(input().maxLength).toBe(20);
      expect(rules().id).toBe('handle-rules');
      expect(rules().textContent).toBe('3–20 characters: a–z, 0–9 or _');
    });

    it('says which characters disappeared, while the availability check runs on what is left', async () => {
      await mount();
      await typeHandle('Ayşe K');
      expect(rules().textContent).toBe('Removed “ş”, space — use 3–20 characters: a–z, 0–9 or _');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      expect(handleAvailabilityMock).toHaveBeenCalledWith('ayek', undefined);
      expect(status().textContent).toBe('✓ @ayek is free');
      expect(rules().textContent).toContain('Removed “ş”, space');
    });

    it('lets a long reserved message wrap above the submit button', async () => {
      handleAvailabilityMock.mockResolvedValue({ status: 'reserved', until: new Date('2026-10-29T12:00:00Z') });
      await mount();
      await typeHandle('bob');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      expect(status().textContent).toMatch(/^@bob is reserved until .+ — try another$/);
      const classes = status().className.split(' ');
      expect(classes).toContain('min-h-4');
      expect(classes).not.toContain('h-4');
      expect(rules().className.split(' ')).not.toContain('h-4');
    });
  });
});
