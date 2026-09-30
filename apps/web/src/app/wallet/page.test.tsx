import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const m = vi.hoisted(() => ({ connectViaKit: vi.fn(), getXlmBalance: vi.fn() }));

vi.mock('@/lib/wallet-kit', () => ({ connectViaKit: m.connectViaKit }));
vi.mock('@/lib/stellar', () => ({ getXlmBalance: m.getXlmBalance, txExplorerUrl: (h: string) => h }));
vi.mock('@/lib/payments', () => ({ sendXlm: vi.fn() }));
vi.mock('@/components/HandleTransfer', () => ({ HandleTransfer: () => null }));

import WalletPage from './page';
import { I18nProvider } from '@/lib/i18n';

describe('/wallet balance (#493)', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    m.connectViaKit.mockReset().mockResolvedValue({ kind: 'kit', address: 'G'.padEnd(56, 'W') });
    m.getXlmBalance.mockReset().mockResolvedValue('12345.6789');
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    localStorage.clear();
  });

  async function connect() {
    await act(async () =>
      root.render(
        <I18nProvider>
          <WalletPage />
        </I18nProvider>,
      ),
    );
    const button = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Connect a Wallet'),
    )!;
    await act(async () => {
      button.click();
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
  }

  it('shows two decimals with the English grouping', async () => {
    await connect();
    expect(container.textContent).toContain('12,345.68 XLM');
  });

  it('shows two decimals with the Turkish grouping', async () => {
    localStorage.setItem('alvinmunk_locale', 'tr');
    await connect();
    expect(container.textContent).toContain('12.345,68 XLM');
  });
});
