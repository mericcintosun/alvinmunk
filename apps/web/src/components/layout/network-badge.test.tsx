import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// The vitest setup compiles JSX to `React.createElement`; give the component a
// global React to resolve, as the other layout tests do.
(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A plain anchor that forwards every prop, so href/aria reach the DOM (jsdom
// cannot navigate; the badge only needs its attributes rendered).
import { vi } from 'vitest';
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { NetworkBadge, resolveNetwork } from './network-badge';

describe('resolveNetwork', () => {
  it('defaults to testnet when unset', () => {
    expect(resolveNetwork(undefined)).toBe('testnet');
  });

  it('is mainnet only for an exact (trimmed, case-insensitive) "mainnet"', () => {
    expect(resolveNetwork('mainnet')).toBe('mainnet');
    expect(resolveNetwork(' Mainnet ')).toBe('mainnet');
    expect(resolveNetwork('MAINNET')).toBe('mainnet');
  });

  it('treats anything else as testnet', () => {
    expect(resolveNetwork('testnet')).toBe('testnet');
    expect(resolveNetwork('mainnet-ish')).toBe('testnet');
    expect(resolveNetwork('')).toBe('testnet');
  });
});

describe('NetworkBadge', () => {
  let container: HTMLDivElement;
  let root: Root;
  const original = process.env.NEXT_PUBLIC_STELLAR_NETWORK;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    if (original === undefined) delete process.env.NEXT_PUBLIC_STELLAR_NETWORK;
    else process.env.NEXT_PUBLIC_STELLAR_NETWORK = original;
  });

  function render() {
    act(() => root.render(<NetworkBadge />));
    return container.querySelector('a')!;
  }

  it('renders a testnet pill that links to /api/health', () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = 'testnet';
    const link = render();
    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toBe('/api/health');
    expect(link.getAttribute('data-network')).toBe('testnet');
    expect(link.textContent).toContain('Testnet');
    expect(link.textContent).toContain('test funds');
    expect(link.getAttribute('aria-label')).toContain('Testnet');
    // Colour is the warning token for testnet.
    expect(link.className).toContain('text-warning');
    expect(link.className).not.toContain('secondary');
  });

  it('renders a distinct green mainnet pill', () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = 'mainnet';
    const link = render();
    expect(link.getAttribute('href')).toBe('/api/health');
    expect(link.getAttribute('data-network')).toBe('mainnet');
    expect(link.textContent).toContain('Mainnet');
    expect(link.textContent).not.toContain('test funds');
    expect(link.getAttribute('aria-label')).toContain('Mainnet');
    // Colour is the secondary (green) token for mainnet — distinct from testnet's warning.
    expect(link.className).toContain('text-secondary');
    expect(link.className).not.toContain('warning');
  });

  it('conveys the network in text, not colour alone (testnet vs mainnet differ in words)', () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = 'testnet';
    const testnetText = render().textContent;
    act(() => root.unmount());
    root = createRoot(container);
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = 'mainnet';
    const mainnetText = render().textContent;
    expect(testnetText).not.toBe(mainnetText);
  });
});
