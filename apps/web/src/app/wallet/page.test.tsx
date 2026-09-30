import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { connectViaKitMock, getXlmBalanceMock, sendXlmMock } = vi.hoisted(() => ({
  connectViaKitMock: vi.fn(),
  getXlmBalanceMock: vi.fn(),
  sendXlmMock: vi.fn(),
}));

vi.mock('@/lib/wallet-kit', () => ({ connectViaKit: connectViaKitMock }));
vi.mock('@/lib/stellar', () => ({
  getXlmBalance: getXlmBalanceMock,
  txExplorerUrl: (h: string) => `https://explorer/tx/${h}`,
}));
vi.mock('@/lib/payments', () => ({ sendXlm: sendXlmMock }));
// The handle-move card has its own tests; here it only marks where the Send card ends.
vi.mock('@/components/HandleTransfer', () => ({
  HandleTransfer: () => <section data-testid="handle-transfer" />,
}));

import WalletPage from './page';

const ADDRESS = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const DEST = 'GAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSW2IVM4S5DP42RBW3K6BTODB4A';

describe('/wallet', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    connectViaKitMock.mockResolvedValue({ kind: 'kit', address: ADDRESS });
    getXlmBalanceMock.mockResolvedValue('100');
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    localStorage.clear();
    vi.clearAllMocks();
  });

  async function render(ui = <WalletPage />) {
    await act(async () => {
      root.render(ui);
    });
  }

  const buttonNamed = (text: string) =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === text) as
      | HTMLButtonElement
      | undefined;
  const alert = () => container.querySelector('[role="alert"]');
  const toInput = () => container.querySelector<HTMLInputElement>('input[placeholder^="Destination"]')!;
  const amountInput = () => container.querySelector<HTMLInputElement>('input[placeholder="Amount"]')!;

  async function click(button: HTMLButtonElement | undefined) {
    expect(button).toBeDefined();
    await act(async () => {
      button!.click();
    });
  }

  async function type(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      input.focus();
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  async function leave(input: HTMLInputElement) {
    await act(async () => {
      input.focus();
      input.blur();
    });
  }

  async function connected() {
    await render();
    await click(buttonNamed('Connect a wallet'));
    expect(buttonNamed('Send')).toBeDefined();
  }

  it('speaks to users: no belt wording, a wallet-agnostic header, sentence case', async () => {
    await render();
    const text = container.textContent ?? '';
    expect(container.querySelector('h1')?.textContent).toBe('Wallet');
    expect(text).not.toMatch(/Level \d|Classic wallet|Freighter/);
    expect(buttonNamed('Connect a wallet')).toBeDefined();

    await click(buttonNamed('Connect a wallet'));
    const copy = [
      ...[...container.querySelectorAll('h1, h2, p, button')].map((el) => el.textContent ?? ''),
      ...[...container.querySelectorAll('input')].map((i) => i.placeholder),
    ].filter((s) => /[a-z]/i.test(s));
    expect(copy.length).toBeGreaterThan(5);
    for (const s of copy) {
      // Addresses (G…) and amounts are data; every other line starts with a capital.
      if (/^G[A-Z0-9]/.test(s) || /^[\d.]/.test(s)) continue;
      expect(s, s).toMatch(/^[^a-z]/);
    }
  });

  it('shows a connect error right under the Connect button', async () => {
    connectViaKitMock.mockRejectedValue(new Error('User closed the wallet picker'));
    await render();
    const connect = buttonNamed('Connect a wallet')!;
    await click(connect);
    expect(alert()?.textContent).toBe('User closed the wallet picker');
    expect(connect.nextElementSibling).toBe(alert());
  });

  it('shows a payment error directly below Send, inside the Send card', async () => {
    sendXlmMock.mockRejectedValue(new Error('op_underfunded'));
    await connected();
    await type(toInput(), DEST);
    const send = buttonNamed('Send')!;
    expect(send.disabled).toBe(false);
    await click(send);

    expect(sendXlmMock).toHaveBeenCalledWith(expect.objectContaining({ address: ADDRESS }), DEST, '1');
    expect(alert()?.textContent).toBe('op_underfunded');
    expect(send.nextElementSibling).toBe(alert());
    // Not after the handle-move card, where it used to land off-screen on phones.
    const handleCard = container.querySelector('[data-testid="handle-transfer"]')!;
    expect(alert()!.compareDocumentPosition(handleCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('does not carry a payment error back to the Connect screen after Disconnect', async () => {
    sendXlmMock.mockRejectedValue(new Error('op_underfunded'));
    await connected();
    await type(toInput(), DEST);
    await click(buttonNamed('Send'));
    expect(alert()).not.toBeNull();
    await click(buttonNamed('Disconnect'));
    expect(buttonNamed('Connect a wallet')).toBeDefined();
    expect(alert()).toBeNull();
  });

  it('explains an invalid address once the field is left, and ties it to the disabled Send', async () => {
    await connected();
    const send = buttonNamed('Send')!;
    expect(send.disabled).toBe(true);
    // Nothing nags before the user has been in the field.
    expect(container.textContent).not.toContain('Enter a G… address');

    await type(toInput(), 'not-an-address');
    await leave(toInput());
    const hint = container.querySelector('#wallet-to-error');
    expect(hint?.textContent).toBe('Enter a G… address');
    expect(toInput().getAttribute('aria-invalid')).toBe('true');
    expect(toInput().getAttribute('aria-describedby')).toBe('wallet-to-error');
    expect(send.disabled).toBe(true);
    expect(send.getAttribute('aria-describedby')).toBe('wallet-to-error');

    await type(toInput(), DEST);
    expect(container.querySelector('#wallet-to-error')).toBeNull();
    expect(toInput().hasAttribute('aria-invalid')).toBe(false);
    expect(send.disabled).toBe(false);
    expect(send.hasAttribute('aria-describedby')).toBe(false);
  });

  it('explains an amount that is not above 0', async () => {
    await connected();
    await type(toInput(), DEST);
    for (const bad of ['0', '-2', 'abc', '']) {
      await type(amountInput(), bad);
      await leave(amountInput());
      expect(container.querySelector('#wallet-amount-error')?.textContent, bad).toBe(
        'Amount must be greater than 0',
      );
      expect(amountInput().getAttribute('aria-invalid')).toBe('true');
      expect(buttonNamed('Send')!.disabled).toBe(true);
    }
    await type(amountInput(), '2.5');
    expect(container.querySelector('#wallet-amount-error')).toBeNull();
    expect(buttonNamed('Send')!.disabled).toBe(false);
  });

  it('names both problems on Send when both fields are invalid', async () => {
    await connected();
    await leave(toInput());
    await type(amountInput(), '0');
    await leave(amountInput());
    expect(buttonNamed('Send')!.getAttribute('aria-describedby')).toBe(
      'wallet-to-error wallet-amount-error',
    );
  });

  it('is translated', async () => {
    localStorage.setItem('alvinmunk_locale', 'tr');
    await render(
      <I18nProvider>
        <WalletPage />
      </I18nProvider>,
    );
    expect(container.querySelector('h1')?.textContent).toBe('Cüzdan');
    await click(buttonNamed('Cüzdan bağla'));
    expect(buttonNamed('Gönder')).toBeDefined();
    await leave(container.querySelector<HTMLInputElement>('input[placeholder^="Alıcı"]')!);
    expect(container.querySelector('#wallet-to-error')?.textContent).toBe('G… ile başlayan bir adres gir');
  });
});
