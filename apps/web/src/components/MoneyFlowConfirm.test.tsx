import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  network: 'mainnet',
  getWallet: vi.fn(),
  tip: vi.fn(),
  claimReward: vi.fn(),
  resolveHandle: vi.fn(),
  getRewardsFor: vi.fn(),
}));

// The deployment's network is the only switch: mainnet confirms, testnet doesn't.
vi.mock('@/lib/stellar', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/stellar')>();
  return { ...orig, config: Object.defineProperty({ ...orig.config }, 'network', { get: () => m.network }) };
});
vi.mock('@/lib/wallet', () => ({ getWallet: m.getWallet }));
vi.mock('@/lib/registry', () => ({ resolveHandle: m.resolveHandle }));
vi.mock('@/lib/rewards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rewards')>()),
  tip: m.tip,
  claimReward: m.claimReward,
  getRewardsFor: m.getRewardsFor,
  getUsdcBalance: vi.fn().mockResolvedValue(50_000_000n),
  hasUsdcTrustline: vi.fn().mockResolvedValue(true),
  enableUsdc: vi.fn(),
  requestTestUsdc: vi.fn(),
}));
vi.mock('@/lib/reputation', () => ({ getEarnedScore: vi.fn().mockResolvedValue(50) }));
vi.mock('@/lib/quests', () => ({ getStreak: vi.fn().mockResolvedValue({ weeks: 2, best: 3, lastWeek: 100 }) }));
vi.mock('@/lib/anchor', () => ({ getAnchorConfig: () => null }));
vi.mock('@/components/ui/toaster', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/fx/number-ticker', () => ({
  NumberTicker: ({ value }: { value: number }) => <span>{value}</span>,
}));

import { Tip } from './Tip';
import { Rewards } from './Rewards';
import { UNDO_MS } from './MoneyFlowConfirm';

(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ME = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const OTHER = 'GDIS5BDXSI2DDJNTKRZPI6MNB5XCLMN4Z6PPRPM4RQLZ3PSQ2YTERLFA';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  m.network = 'mainnet';
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  m.getWallet.mockResolvedValue({ address: ME, sign: vi.fn() });
  m.tip.mockResolvedValue(undefined);
  m.claimReward.mockResolvedValue(undefined);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.clearAllMocks();
});

const dialog = () => container.querySelector<HTMLElement>('[role="dialog"]');
const buttonIn = (scope: ParentNode, text: RegExp) =>
  [...scope.querySelectorAll('button')].find((b) => text.test(b.textContent ?? ''))!;
const click = async (el: HTMLElement) => act(async () => el.click());

describe('mainnet tips (#291)', () => {
  const type = (el: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const input = (label: string) => container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;

  async function fill(to: string, amount: string) {
    await act(async () => root.render(<Tip address={ME} />));
    await act(async () => type(input('Tip recipient: handle or address'), to));
    await act(async () => type(input('Tip amount in USDC'), amount));
  }
  const send = () => click(buttonIn(container, /Send tip/));

  it('asks first: the resolved address, the amount, and nothing signed yet', async () => {
    await fill(OTHER, '2.5');
    await send();
    expect(dialog()).not.toBeNull();
    expect(container.querySelector('[data-testid="money-confirm-address"]')?.textContent).toBe(OTHER);
    expect(dialog()!.textContent).toContain('2.5 USDC');
    expect(dialog()!.textContent).toContain("can't be reversed");
    expect(m.getWallet).not.toHaveBeenCalled();
    expect(m.tip).not.toHaveBeenCalled();
  });

  it('shows the address a typed @handle resolved to, not only the handle', async () => {
    m.resolveHandle.mockResolvedValue(OTHER);
    await fill('@Beko', '1');
    await act(async () => new Promise((r) => setTimeout(r, 450))); // the lookup's debounce
    await send();
    expect(m.resolveHandle).toHaveBeenCalledWith('beko');
    expect(dialog()!.textContent).toContain('@beko');
    expect(container.querySelector('[data-testid="money-confirm-address"]')?.textContent).toBe(OTHER);
  });

  it('needs the checkbox for the first tip on the device, then waits out the undo window before the wallet', async () => {
    await fill(OTHER, '2.5');
    await send();
    const confirm = buttonIn(dialog()!, /Confirm tip/);
    expect(confirm.disabled).toBe(true);
    await click(dialog()!.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    expect(confirm.disabled).toBe(false);

    vi.useFakeTimers();
    await click(confirm);
    expect(dialog()!.textContent).toContain('Sending in 5s');
    await act(async () => vi.advanceTimersByTime(UNDO_MS - 100));
    expect(m.getWallet).not.toHaveBeenCalled();
    expect(m.tip).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTime(100));
    vi.useRealTimers();
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(m.tip).toHaveBeenCalledWith(expect.objectContaining({ address: ME }), OTHER, 25_000_000n);
    expect(dialog()).toBeNull();
    expect(localStorage.getItem('alvinmunk.mainnet.tipped')).toBe('1');
  });

  it('Undo cancels without ever touching the wallet', async () => {
    await fill(OTHER, '1');
    await send();
    await click(dialog()!.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    vi.useFakeTimers();
    await click(buttonIn(dialog()!, /Confirm tip/));
    await act(async () => vi.advanceTimersByTime(2_000));
    await click(buttonIn(dialog()!, /Undo/));
    await act(async () => vi.advanceTimersByTime(UNDO_MS * 2));
    expect(dialog()).toBeNull();
    expect(m.getWallet).not.toHaveBeenCalled();
    expect(m.tip).not.toHaveBeenCalled();
  });

  it('Escape cancels, and a later tip on the device needs no checkbox', async () => {
    localStorage.setItem('alvinmunk.mainnet.tipped', '1');
    await fill(OTHER, '1');
    await send();
    expect(dialog()!.querySelector('input[type="checkbox"]')).toBeNull();
    expect(buttonIn(dialog()!, /Confirm tip/).disabled).toBe(false);
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(dialog()).toBeNull();
    expect(m.tip).not.toHaveBeenCalled();
  });

  it('never sends once the form is gone mid-window', async () => {
    localStorage.setItem('alvinmunk.mainnet.tipped', '1');
    await fill(OTHER, '1');
    await send();
    vi.useFakeTimers();
    await click(buttonIn(dialog()!, /Confirm tip/));
    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => vi.advanceTimersByTime(UNDO_MS * 2));
    expect(m.getWallet).not.toHaveBeenCalled();
  });

  it('refuses a tip to your own wallet without asking to confirm it', async () => {
    await fill(ME, '1');
    await send();
    expect(dialog()).toBeNull();
    expect(container.textContent).toContain('your own wallet');
  });

  it('keeps testnet one click: no dialog, straight to the wallet', async () => {
    m.network = 'testnet';
    await fill(OTHER, '2.5');
    await send();
    expect(dialog()).toBeNull();
    expect(m.tip).toHaveBeenCalledWith(expect.objectContaining({ address: ME }), OTHER, 25_000_000n);
  });
});

describe('mainnet reward claims (#291)', () => {
  const entry = { id: 3, threshold: 30n, amount: 5_000_000n, active: true, max_claims: 0, claims: 0 };

  async function mount() {
    m.getRewardsFor.mockResolvedValue({ rows: [{ entry, claimed: false, eligible: true, reason: 0 }], remainingToday: null });
    await act(async () => root.render(<Rewards address={ME} />));
  }
  const claim = () => click(buttonIn(container, /^Claim$/));

  it('confirms the amount and the receiving wallet, then claims with no undo window', async () => {
    await mount();
    await claim();
    expect(dialog()!.textContent).toContain('0.5 USDC');
    expect(container.querySelector('[data-testid="money-confirm-address"]')?.textContent).toBe(ME);
    expect(dialog()!.querySelector('input[type="checkbox"]')).toBeNull();
    expect(m.claimReward).not.toHaveBeenCalled();

    await click(buttonIn(dialog()!, /Confirm claim/));
    expect(m.claimReward).toHaveBeenCalledWith(expect.objectContaining({ address: ME }), 3);
    expect(dialog()).toBeNull();
  });

  it('Cancel claims nothing', async () => {
    await mount();
    await claim();
    await click(buttonIn(dialog()!, /Cancel/));
    expect(dialog()).toBeNull();
    expect(m.claimReward).not.toHaveBeenCalled();
  });

  it('keeps testnet claims one click', async () => {
    m.network = 'testnet';
    await mount();
    await claim();
    expect(dialog()).toBeNull();
    expect(m.claimReward).toHaveBeenCalledWith(expect.objectContaining({ address: ME }), 3);
  });
});
