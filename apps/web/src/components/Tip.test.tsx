import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getWalletMock, tipMock, hasTrustlineMock } = vi.hoisted(() => ({
  getWalletMock: vi.fn(),
  tipMock: vi.fn(),
  hasTrustlineMock: vi.fn(),
}));

vi.mock('@/lib/registry', () => ({ resolveHandle: vi.fn() }));
vi.mock('@/lib/wallet', () => ({ getWallet: getWalletMock }));
vi.mock('@/lib/rewards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rewards')>()),
  tip: tipMock,
  getUsdcBalance: vi.fn().mockResolvedValue(50_000_000n),
  hasUsdcTrustline: hasTrustlineMock,
  enableUsdc: vi.fn(),
  requestTestUsdc: vi.fn(),
}));
vi.mock('@/components/ui/toaster', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// The count-up animation needs IntersectionObserver; the figure itself is what matters here.
vi.mock('@/components/fx/number-ticker', () => ({
  NumberTicker: ({ value }: { value: number }) => <span>{value}</span>,
}));

import { TIP_ERRORS, Tip } from './Tip';

// This vitest setup compiles JSX to `React.createElement`; give the component a global React.
(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ME = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const OTHER = 'GDIS5BDXSI2DDJNTKRZPI6MNB5XCLMN4Z6PPRPM4RQLZ3PSQ2YTERLFA';

describe('Tip', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    getWalletMock.mockResolvedValue({ address: ME, sign: vi.fn() });
    hasTrustlineMock.mockResolvedValue(true);
    tipMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  const recipient = () => screen('Tip recipient: handle or address');
  const amountField = () => screen('Tip amount in USDC');
  const sendButton = () => [...container.querySelectorAll('button')].find((b) => /Send tip/.test(b.textContent ?? ''))!;

  function screen(label: string) {
    return container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  }

  const type = (el: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  /** Fill the form with a receiver and an amount, then wait for the button to arm. */
  async function fill(to: string, amount: string) {
    await act(async () => {
      root.render(<Tip address={ME} />);
    });
    await act(async () => {
      type(recipient(), to);
    });
    await act(async () => {
      type(amountField(), amount);
    });
  }

  it('sends a real tip to somebody else', async () => {
    await fill(OTHER, '2.5');
    await act(async () => {
      sendButton().click();
    });
    expect(tipMock).toHaveBeenCalledWith(expect.objectContaining({ address: ME }), OTHER, 25_000_000n);
  });

  it('refuses a zero amount before signing — the chain would reject it (#144)', async () => {
    await fill(OTHER, '0');
    // The send button stays disabled for a zero amount (#334), so no signature is asked for.
    expect(sendButton().disabled).toBe(true);
    await act(async () => {
      sendButton().click();
    });
    expect(tipMock).not.toHaveBeenCalled();
  });

  it('refuses a tip to your own wallet before signing (#144)', async () => {
    await fill(ME, '1');
    await act(async () => {
      sendButton().click();
    });
    expect(tipMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain('your own wallet');
  });

  it('explains an InvalidAmount (#8) and a SelfTip (#20) revert from tip', async () => {
    await fill(OTHER, '1');
    tipMock.mockRejectedValue(new Error('HostError: Error(Contract, #8)'));
    await act(async () => {
      sendButton().click();
    });
    expect(container.textContent).toContain('above 0 USDC');

    tipMock.mockRejectedValue(new Error('HostError: Error(Contract, #20)'));
    await act(async () => {
      sendButton().click();
    });
    expect(container.textContent).toContain('can’t tip yourself');
  });
});

describe('TIP_ERRORS', () => {
  // Parse `Name = N,` out of the contract's `pub enum Error`, so a renumbered or renamed
  // variant breaks this test instead of showing a tipper the wrong message.
  function errorEnum(crate: string): Record<number, string> {
    const file = path.resolve(__dirname, `../../../../contracts/${crate}/src/lib.rs`);
    const src = readFileSync(file, 'utf8');
    const body = src.slice(src.indexOf('pub enum Error'), src.indexOf('}', src.indexOf('pub enum Error')));
    return Object.fromEntries([...body.matchAll(/(\w+)\s*=\s*(\d+)/g)].map((m) => [Number(m[2]), m[1]]));
  }

  it('maps exactly the rewards codes a tip can revert with, at the on-chain numbers', () => {
    const onChain = errorEnum('rewards');
    const names = {
      5: 'Paused',
      8: 'InvalidAmount',
      10: 'Frozen',
      20: 'SelfTip',
    } as const;
    expect(Object.keys(TIP_ERRORS).map(Number).sort()).toEqual(Object.keys(names).map(Number).sort());
    for (const [code, name] of Object.entries(names)) {
      expect(onChain[Number(code)], `code ${code}`).toBe(name);
      expect(TIP_ERRORS[Number(code)]).toBeTruthy();
    }
  });

  it('keeps the new codes outside the SAC 1–13 range so the two can never be confused', () => {
    // #144: the Stellar Asset Contract owns 1–13; a rewards code inside that window is a
    // coin flip between two contracts, which is how "insufficient balance" gets mistaken
    // for a rewards error.
    expect(TIP_ERRORS[20]).toBeDefined();
    expect(Object.keys(TIP_ERRORS).map(Number).filter((c) => c >= 14)).toContain(20);
  });
});
