import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentAdmins } from '@/lib/admin';
import type { RewardEntry } from '@/lib/rewards';

// This vitest setup compiles JSX to `React.createElement`; give the page a global React.
(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ADMIN = 'GDIS5BDXSI2DDJNTKRZPI6MNB5XCLMN4Z6PPRPM4RQLZ3PSQ2YTERLFA';
const OTHER = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

const m = vi.hoisted(() => ({
  admins: null as ContentAdmins | null,
  connect: vi.fn(),
  getAllRewards: vi.fn(),
  getDailyCap: vi.fn(),
  addReward: vi.fn(),
  setRewardActive: vi.fn(),
  setRewardSupply: vi.fn(),
  readGates: vi.fn(),
}));

vi.mock('@/lib/wallet-kit', () => ({ connectViaKit: m.connect }));
vi.mock('@/lib/focus', () => ({ FOCUS_MODE: true }));
vi.mock('@/lib/admin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin')>()),
  readContentAdmins: async () => m.admins,
}));
vi.mock('@/lib/rewards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rewards')>()),
  getAllRewards: m.getAllRewards,
  getDailyCap: m.getDailyCap,
  addReward: m.addReward,
  setRewardActive: m.setRewardActive,
  setRewardSupply: m.setRewardSupply,
}));
vi.mock('@/lib/gate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/gate')>()),
  readGates: m.readGates,
  createGate: vi.fn(),
  setGateActive: vi.fn(),
}));

import AdminPage from './page';

const wallet = (address: string) => ({ kind: 'kit', address, sign: vi.fn(), signMessage: vi.fn() });
const REWARD: RewardEntry = {
  id: 1,
  threshold: 30n,
  amount: 5_000_000n,
  active: true,
  max_claims: 0,
  claims: 0,
};

describe('/admin', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    m.admins = { rewards: ADMIN, gates: ADMIN, quests: ADMIN };
    for (const f of [m.connect, m.getAllRewards, m.getDailyCap, m.addReward, m.setRewardActive, m.readGates]) {
      f.mockReset();
    }
    m.getAllRewards.mockResolvedValue([REWARD]);
    m.getDailyCap.mockResolvedValue(50_000_000n);
    m.readGates.mockResolvedValue([]);
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
  const button = (text: string) =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === text);
  async function click(text: string) {
    const b = button(text);
    if (!b) throw new Error(`no "${text}" button`);
    await act(async () => b.click());
    await flush();
  }
  async function type(label: string, value: string) {
    const input = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  async function connectAs(address: string) {
    m.connect.mockResolvedValue(wallet(address));
    await act(async () => root.render(<AdminPage />));
    await flush();
    await click('Connect wallet');
  }

  it('shows only a connect prompt before a wallet is connected', async () => {
    await act(async () => root.render(<AdminPage />));
    await flush();
    expect(button('Connect wallet')).toBeTruthy();
    expect(container.textContent).not.toContain('Rewards');
    expect(m.getAllRewards).not.toHaveBeenCalled();
  });

  it('shows a non-admin wallet no controls', async () => {
    await connectAs(OTHER);
    expect(container.textContent).toContain('is not the on-chain admin');
    expect(button('Review reward')).toBeUndefined();
    expect(button('Disable')).toBeUndefined();
    expect(m.getAllRewards).not.toHaveBeenCalled();
  });

  it('fails closed when the on-chain admin cannot be read', async () => {
    m.admins = { rewards: null, gates: null, quests: null };
    await connectAs(ADMIN);
    expect(container.textContent).toContain('Couldn’t read the admin');
    expect(button('Review reward')).toBeUndefined();
  });

  it('shows only the sections whose contract admin is the wallet', async () => {
    m.admins = { rewards: OTHER, gates: ADMIN, quests: null };
    await connectAs(ADMIN);
    expect(button('Rewards')).toBeUndefined();
    expect(button('Quests')).toBeUndefined();
    expect(button('Gates')).toBeTruthy();
    expect(button('Review gate')).toBeTruthy();
    expect(m.getAllRewards).not.toHaveBeenCalled();
  });

  it('states the consequence, signs only on confirm, then links the transaction', async () => {
    m.addReward.mockResolvedValue('f00dcafe'.repeat(8));
    await connectAs(ADMIN);
    expect(container.textContent).toContain('Focus mode is on');
    expect(container.textContent).toContain('#1 · ≥ 30 Earned XP → 0.5 USDC');

    await type('Reward ID', '3');
    await type('Earned XP threshold', '100');
    await type('USDC amount', '2');
    await click('Review reward');
    expect(container.textContent).toContain(
      'Reward 3 will pay 2 USDC to any wallet with ≥ 100 Earned XP.',
    );
    expect(m.addReward).not.toHaveBeenCalled();

    await click('Confirm and sign');
    expect(m.addReward).toHaveBeenCalledWith(
      expect.objectContaining({ address: ADMIN }),
      3,
      100n,
      20_000_000n,
    );
    expect(container.textContent).toContain('Confirmed on-chain.');
    const link = container.querySelector<HTMLAnchorElement>('a[href*="/tx/"]')!;
    expect(link.href).toContain('f00dcafe'.repeat(8));
    expect(m.getAllRewards).toHaveBeenCalledTimes(2); // reloaded after the write
  });

  it('cancel discards the write without signing', async () => {
    await connectAs(ADMIN);
    await click('Disable');
    expect(container.textContent).toContain('Reward 1 (0.5 USDC at ≥ 30 Earned XP) will be disabled');
    await click('Cancel');
    expect(container.textContent).not.toContain('will be disabled');
    expect(m.setRewardActive).not.toHaveBeenCalled();
  });

  it('rejects invalid input before anything is signed', async () => {
    await connectAs(ADMIN);
    await type('Reward ID', '3');
    await type('Earned XP threshold', '0');
    await type('USDC amount', '2');
    await click('Review reward');
    expect(container.textContent).toContain('A 0 XP threshold would let every wallet claim');
    expect(button('Confirm and sign')).toBeUndefined();

    await type('Earned XP threshold', '10');
    await type('USDC amount', '6'); // daily cap is 5 USDC
    await click('Review reward');
    expect(container.textContent).toContain('above the daily cap of 5 USDC');
    expect(m.addReward).not.toHaveBeenCalled();
  });

  it('maps a contract error code to admin copy', async () => {
    m.setRewardActive.mockRejectedValue(new Error('HostError: Error(Contract, #16)'));
    await connectAs(ADMIN);
    await click('Disable');
    await click('Confirm and sign');
    expect(container.textContent).toContain('That payout is above the daily cap');
  });
});
