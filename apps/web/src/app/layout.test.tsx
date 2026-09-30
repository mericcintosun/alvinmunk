import React, { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { cookieValue, stub, pass } = vi.hoisted(() => ({
  cookieValue: { current: undefined as string | undefined },
  stub: () => null,
  pass: ({ children }: { children: unknown }) => children,
}));

vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (name: string) =>
      name === 'alvinmunk_locale' && cookieValue.current !== undefined
        ? { name, value: cookieValue.current }
        : undefined,
  }),
}));
vi.mock('./globals.css', () => ({}));
vi.mock('@/lib/fonts', () => ({ fontVars: 'fonts' }));
vi.mock('@/components/brand/starfield', () => ({ Starfield: stub }));
vi.mock('@/components/smooth-scroll', () => ({ SmoothScroll: stub }));
vi.mock('@/components/layout/navbar', () => ({ Navbar: stub }));
vi.mock('@/components/layout/site-footer', () => ({ SiteFooter: stub }));
vi.mock('@/components/ui/toaster', () => ({ Toaster: stub }));
vi.mock('@/components/analytics', () => ({ AnalyticsProvider: stub }));
vi.mock('@/components/config-status-banner', () => ({ ConfigStatusBanner: stub }));
vi.mock('@/components/wallet/wallet-provider', () => ({ WalletProvider: pass }));
vi.mock('@/components/motion/motion-provider', () => ({ MotionProvider: pass }));

import RootLayout from './layout';
import { I18nProvider } from '@/lib/i18n';

/** The first element of `type` in a (not rendered) element tree. */
function find(node: ReactNode, type: unknown): ReactElement | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child, type);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (node.type === type) return node;
  return find((node.props as { children?: ReactNode }).children, type);
}

describe('root layout locale (#236)', () => {
  afterEach(() => {
    cookieValue.current = undefined;
  });

  function layout() {
    const html = RootLayout({ children: <p>page</p> });
    return { html, provider: find(html, I18nProvider) };
  }

  it('renders <html lang> and the provider in the saved Turkish', () => {
    cookieValue.current = 'tr';
    const { html, provider } = layout();
    expect(html.props.lang).toBe('tr');
    expect(provider?.props.initialLocale).toBe('tr');
  });

  it('passes a saved English choice through, so the browser language cannot override it', () => {
    cookieValue.current = 'en';
    const { html, provider } = layout();
    expect(html.props.lang).toBe('en');
    expect(provider?.props.initialLocale).toBe('en');
  });

  it('falls back to English, undecided, without a cookie or with a bad one', () => {
    for (const value of [undefined, 'de', '']) {
      cookieValue.current = value;
      const { html, provider } = layout();
      expect(html.props.lang).toBe('en');
      expect(provider).not.toBeNull();
      expect(provider?.props.initialLocale).toBeUndefined();
    }
  });
});
