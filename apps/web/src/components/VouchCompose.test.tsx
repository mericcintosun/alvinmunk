import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// VouchCompose and its children rely on Next's automatic JSX runtime; this vitest setup
// compiles JSX to `React.createElement`, so give them a global React to resolve.
(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { mintVouchMock, mintVouchesMock, addMyVouchMock, toastMock } = vi.hoisted(() => ({
  mintVouchMock: vi.fn(),
  mintVouchesMock: vi.fn(),
  addMyVouchMock: vi.fn(),
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
  mintVouches: mintVouchesMock,
}));
vi.mock('@/lib/myvouches', () => ({
  addMyVouch: addMyVouchMock,
  subscribeToVouchPush: vi.fn(async () => {}),
}));
vi.mock('@/lib/track', () => ({ track: vi.fn(), trackError: vi.fn() }));
vi.mock('@/components/wallet/wallet-provider', () => ({
  useWallet: () => ({ profile: { handle: 'me', address: WALLET.address, createdAt: 0 } }),
}));
vi.mock('@/components/ui/toaster', () => ({ toast: toastMock }));
vi.mock('@/components/fx/frame', () => ({
  Frame: (p: { children: React.ReactNode }) => p.children,
}));
vi.mock('@/components/fx/border-beam', () => ({ BorderBeam: () => null }));
vi.mock('@/components/ui/state-art', () => ({ StateArt: () => null }));
vi.mock('@/components/ui/sticker', () => ({ Sticker: () => null }));
// The QR encoder is stubbed: these tests are about the reveal and the value it encodes.
vi.mock('@/components/fx/qr-code', () => ({
  QrCode: ({ value, label }: { value: string; label: string }) => (
    <div data-testid="qr" data-value={value} aria-label={label} />
  ),
}));

import { VouchCompose } from './VouchCompose';

describe('VouchCompose note', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mintVouchMock.mockReset().mockResolvedValue({ id: 7, seed: 'ab' });
    addMyVouchMock.mockReset();
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

  it('shares the claim key in the link fragment and keeps it only in this browser', async () => {
    await mount();
    await typeNote('gm');
    await mint();
    const link = `${window.location.origin}/claim/7#k=ab`;
    expect(container.querySelector('code')?.textContent).toBe(link);
    expect(addMyVouchMock).toHaveBeenCalledWith(expect.objectContaining({ id: 7, seed: 'ab' }));
    expect(addMyVouchMock.mock.calls[0][0]).not.toHaveProperty('secret');
  });

  it('explains a note the contract rejects as too long (#12)', async () => {
    mintVouchMock.mockRejectedValue(new Error('HostError: Error(Contract, #12)'));
    await mount();
    await typeNote('gm');
    await mint();
    expect(toastMock.error).toHaveBeenCalledWith('Keep the note to 60 characters or fewer.');
    expect(container.textContent).toContain('Keep the note to 60 characters or fewer.');
  });

  it('keeps the claim QR hidden until revealed, then encodes the claim link with its key (#215)', async () => {
    await mount();
    await typeNote('gm');
    await mint();

    // Minted, but no QR in the DOM until the user asks for it.
    expect(container.querySelector('[data-testid="qr"]')).toBeNull();
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-controls="vouch-claim-qr"]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    await act(async () => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const qr = container.querySelector('[data-testid="qr"]')!;
    expect(qr.getAttribute('data-value')).toBe(`${window.location.origin}/claim/7#k=ab`);
    expect(container.textContent).toMatch(/secret/i);

    await act(async () => toggle.click());
    expect(container.querySelector('[data-testid="qr"]')).toBeNull();
  });

  // #492: the note field is named, counts as you type, and says when the cap cut text.
  const counter = () => document.getElementById(textarea().getAttribute('aria-describedby')!)!;
  const status = () => container.querySelector('[role="status"]')!;

  it('has a visible label as its accessible name', async () => {
    await mount();
    const label = container.querySelector(`label[for="${textarea().id}"]`);
    expect(textarea().id).not.toBe('');
    expect(label?.textContent).toBe('Your note');
  });

  it('counts characters, not UTF-16 units, as you type', async () => {
    await mount();
    expect(counter().querySelector('[aria-hidden="true"]')?.textContent).toBe('0/60');
    await typeNote('gm');
    expect(counter().querySelector('[aria-hidden="true"]')?.textContent).toBe('2/60');
    expect(counter().querySelector('.sr-only')?.textContent).toBe('2 of 60 characters');
    await typeNote('💧💧ş');
    expect(counter().querySelector('[aria-hidden="true"]')?.textContent).toBe('3/60');
  });

  it('only announces the count once the note nears the cap', async () => {
    await mount();
    await typeNote('a'.repeat(49));
    expect(counter().getAttribute('aria-live')).toBe('off');
    await typeNote('a'.repeat(50));
    expect(counter().getAttribute('aria-live')).toBe('polite');
  });

  it('announces when a paste was cut to the cap, and clears it on the next fitting edit', async () => {
    await mount();
    // The live region is mounted up front, so its message is announced when it appears.
    expect(status().textContent).toBe('');
    await typeNote('💧'.repeat(75));
    expect(textarea().value).toBe('💧'.repeat(60));
    expect(status().textContent).toBe('Notes are limited to 60 characters — the extra text was cut.');
    expect(counter().querySelector('[aria-hidden="true"]')?.textContent).toBe('60/60');
    await typeNote('💧'.repeat(59));
    expect(status().textContent).toBe('');
  });
});

describe('VouchCompose for several people (#271)', () => {
  let container: HTMLDivElement;
  let root: Root;
  const writeText = vi.fn(async (_text: string) => {});

  beforeEach(() => {
    mintVouchesMock
      .mockReset()
      .mockImplementation(async (_w: unknown, notes: string[]) =>
        notes.map((_, i) => ({ id: 20 + i, seed: `${i}`.repeat(64) })),
      );
    addMyVouchMock.mockReset();
    toastMock.success.mockReset();
    toastMock.error.mockReset();
    writeText.mockClear();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const button = (text: string | RegExp) =>
    [...container.querySelectorAll('button')].find((b) =>
      typeof text === 'string' ? b.textContent === text : text.test(b.textContent ?? ''),
    )!;
  const rows = () => [...container.querySelectorAll<HTMLInputElement>('input')];
  async function click(el: HTMLElement) {
    await act(async () => el.click());
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
  }
  async function type(el: HTMLInputElement, text: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  async function openBatch() {
    await act(async () => root.render(<VouchCompose />));
    await click(button('Several people'));
  }

  it('mints every row in one call and lists a labelled link for each card', async () => {
    await openBatch();
    expect(rows()).toHaveLength(2);
    await click(button('Add a person'));
    await type(rows()[0], 'ada');
    await type(rows()[1], '💧'.repeat(70));
    await click(button('Light 3 stars'));

    // One signature for all three; an empty row gets the default note.
    expect(mintVouchesMock).toHaveBeenCalledTimes(1);
    expect(mintVouchesMock).toHaveBeenCalledWith(WALLET, ['ada', '💧'.repeat(60), 'vouched for you']);
    const links = [...container.querySelectorAll('li code')].map((c) => c.textContent);
    const origin = window.location.origin;
    expect(links).toEqual([0, 1, 2].map((i) => `${origin}/claim/${20 + i}#k=${`${i}`.repeat(64)}`));
    expect(container.textContent).toContain('Card 1 — ada');
    expect(container.textContent).toContain('Card 3 — vouched for you');
    expect(container.textContent).toContain('3 stars are lit');
    // Each card is kept on this device with its own seed, never a legacy secret.
    expect(addMyVouchMock.mock.calls.map(([v]) => [v.id, v.seed])).toEqual(
      [0, 1, 2].map((i) => [20 + i, `${i}`.repeat(64)]),
    );
    for (const [v] of addMyVouchMock.mock.calls) expect(v).not.toHaveProperty('secret');
  });

  it('copies one card’s link, or every card with its label', async () => {
    await openBatch();
    await type(rows()[0], 'ada');
    await type(rows()[1], 'grace');
    await click(button('Light 2 stars'));
    const origin = window.location.origin;

    await click(container.querySelector<HTMLButtonElement>('[aria-label="Copy link for card 2"]')!);
    expect(writeText).toHaveBeenLastCalledWith(`${origin}/claim/21#k=${'1'.repeat(64)}`);

    await click(button(/Copy all/));
    expect(writeText).toHaveBeenLastCalledWith(
      `Card 1 — ada\n${origin}/claim/20#k=${'0'.repeat(64)}\n\n` +
        `Card 2 — grace\n${origin}/claim/21#k=${'1'.repeat(64)}`,
    );
  });

  it('stops adding rows at the contract’s batch cap and removes the row asked for', async () => {
    await openBatch();
    // two rows cannot be removed: fewer is the one-person form
    expect(container.querySelector('[aria-label="Remove card 1"]')).toBeNull();
    for (let i = 2; i < 10; i++) await click(button('Add a person'));
    expect(rows()).toHaveLength(10);
    expect(button('Add a person').disabled).toBe(true);

    await type(rows()[0], 'ada');
    await type(rows()[1], 'grace');
    await click(container.querySelector<HTMLButtonElement>('[aria-label="Remove card 1"]')!);
    expect(rows()).toHaveLength(9);
    expect(rows()[0].value).toBe('grace');
    expect(button('Add a person').disabled).toBe(false);
  });

  it('shows why a batch reverted and lists no links (#9)', async () => {
    mintVouchesMock.mockRejectedValue(new Error('HostError: Error(Contract, #9)'));
    await openBatch();
    await click(button('Light 2 stars'));
    expect(toastMock.error).toHaveBeenCalledWith("You've hit today's vouch limit — try again tomorrow.");
    expect(container.querySelectorAll('li code')).toHaveLength(0);
    expect(addMyVouchMock).not.toHaveBeenCalled();
  });

  it('gives every row its own counter and says which row the cap cut (#492)', async () => {
    await openBatch();
    const counterOf = (row: HTMLInputElement) =>
      document.getElementById(row.getAttribute('aria-describedby')!)!;
    const shown = (row: HTMLInputElement) =>
      counterOf(row).querySelector('[aria-hidden="true"]')?.textContent;
    const statusOf = (row: HTMLInputElement) => row.closest('li')!.querySelector('[role="status"]')!;

    const [a, b] = rows();
    expect(a.getAttribute('aria-describedby')).not.toBe(b.getAttribute('aria-describedby'));
    await type(a, 'ada');
    expect(shown(a)).toBe('3/60');
    expect(shown(b)).toBe('0/60');

    await type(b, 'x'.repeat(64));
    expect(rows()[1].value).toBe('x'.repeat(60));
    expect(shown(b)).toBe('60/60');
    expect(counterOf(b).getAttribute('aria-live')).toBe('polite');
    expect(statusOf(b).textContent).toBe('Notes are limited to 60 characters — the extra text was cut.');
    expect(statusOf(a).textContent).toBe('');

    // Editing another row that fits moves the notice off the cut one.
    await type(a, 'ada lovelace');
    expect(statusOf(b).textContent).toBe('');
  });
});

describe('VouchCompose feedback prompt (#287)', () => {
  const FORM = 'https://docs.google.com/forms/d/e/FORM/viewform';
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    vi.stubEnv('NEXT_PUBLIC_FEEDBACK_FORM_URL', `${FORM}?entry.1={handle}&entry.2={address}`);
    mintVouchMock.mockReset().mockResolvedValue({ id: 7, seed: 'ab' });
    mintVouchesMock
      .mockReset()
      .mockImplementation(async (_w: unknown, notes: string[]) => notes.map((_, i) => ({ id: 20 + i, seed: `${i}` })));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllEnvs();
  });

  const button = (text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent === text)!;
  const prompt = () => container.querySelector('section[aria-label="Quick feedback"]');
  async function click(el: HTMLElement) {
    await act(async () => el.click());
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
  }
  async function remount() {
    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(<VouchCompose />));
  }

  it('asks after the first vouch, with the handle and address prefilled, then never again', async () => {
    await act(async () => root.render(<VouchCompose />));
    expect(prompt()).toBeNull(); // nothing to react to before a vouch
    await click(button('Light their star'));
    expect(prompt()).not.toBeNull();
    const href = new URL(prompt()!.querySelector('a')!.href);
    expect(Object.fromEntries(href.searchParams)).toEqual({ 'entry.1': '@me', 'entry.2': WALLET.address });

    await remount();
    await click(button('Light their star'));
    expect(container.querySelector('code')?.textContent).toContain('/claim/7');
    expect(prompt()).toBeNull();
  });

  it('asks after a first cohort vouch too', async () => {
    await act(async () => root.render(<VouchCompose />));
    await click(button('Several people'));
    await click(button('Light 2 stars'));
    expect(container.textContent).toContain('2 stars are lit');
    expect(prompt()).not.toBeNull();
  });

  it('stays out of the way when no form is configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_FEEDBACK_FORM_URL', '');
    await act(async () => root.render(<VouchCompose />));
    await click(button('Light their star'));
    expect(container.querySelector('code')?.textContent).toContain('/claim/7');
    expect(prompt()).toBeNull();
  });
});
