import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { sonnerTheme } = vi.hoisted(() => ({ sonnerTheme: [] as (string | undefined)[] }));
vi.mock('sonner', () => ({
  Toaster: ({ theme }: { theme?: string }) => {
    sonnerTheme.push(theme);
    return null;
  },
  toast: vi.fn(),
}));

import { Toaster } from './toaster';

describe('Toaster', () => {
  let container: HTMLDivElement;
  let root: Root;
  const html = document.documentElement;

  beforeEach(() => {
    sonnerTheme.length = 0;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    html.className = '';
  });

  it('follows the app theme, not the OS', async () => {
    // The OS says dark; the user picked light.
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    html.className = 'light';
    await act(async () => root.render(<Toaster />));
    expect(sonnerTheme.at(-1)).toBe('light');
    expect(sonnerTheme).not.toContain('system');
  });

  it('switches when the theme toggle changes the html class', async () => {
    html.className = 'dark';
    await act(async () => root.render(<Toaster />));
    expect(sonnerTheme.at(-1)).toBe('dark');
    await act(async () => {
      html.classList.replace('dark', 'light');
      await Promise.resolve(); // MutationObserver callbacks are microtasks
    });
    expect(sonnerTheme.at(-1)).toBe('light');
    await act(async () => {
      html.classList.replace('light', 'dark');
      await Promise.resolve();
    });
    expect(sonnerTheme.at(-1)).toBe('dark');
  });
});
