import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { useWalletMock } = vi.hoisted(() => ({ useWalletMock: vi.fn() }));

// The layouts rely on Next's automatic JSX runtime and never import React; vitest compiles
// JSX to React.createElement, so hand them the global.
vi.stubGlobal('React', React);

vi.mock('@/components/wallet/wallet-provider', () => ({ useWallet: useWalletMock }));
vi.mock('@/components/app/onboarding', () => ({
  Onboarding: () => <div data-testid="onboarding" />,
}));
vi.mock('@/components/app/app-shell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="shell">{children}</div>,
}));

// The server /app layout, so the whole segment chain is exercised, not just the gate.
import AppLayout from '@/app/app/layout';

describe('/app layout gate', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  function render() {
    act(() => {
      root.render(
        <AppLayout>
          <p data-testid="tab">tab</p>
        </AppLayout>,
      );
    });
  }

  it('shows onboarding, and not the tab, until there is a profile', () => {
    useWalletMock.mockReturnValue({ profile: null });
    render();
    expect(container.querySelector('[data-testid="onboarding"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="shell"]')).toBeNull();
    expect(container.querySelector('[data-testid="tab"]')).toBeNull();
  });

  it('renders the tab inside the dashboard shell once a profile exists', () => {
    useWalletMock.mockReturnValue({ profile: { handle: 'alice', address: 'GA', createdAt: 0 } });
    render();
    expect(container.querySelector('[data-testid="onboarding"]')).toBeNull();
    expect(container.querySelector('[data-testid="shell"] [data-testid="tab"]')).not.toBeNull();
  });
});
