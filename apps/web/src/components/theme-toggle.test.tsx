import React from 'react';
import { act } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_COLOR } from '@/lib/theme';

(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { THEME_KEY, ThemeToggle } from './theme-toggle';

describe('ThemeToggle', () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let osLight: boolean;
  let listeners: (() => void)[];

  const html = document.documentElement;
  const button = () => container.querySelector('button')!;
  const label = () => button().getAttribute('aria-label');
  const metas = () => [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute('content'));
  function addMeta(media: string, color: string) {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.media = media;
    meta.content = color;
    document.head.appendChild(meta);
  }
  async function osChangesTo(light: boolean) {
    osLight = light;
    await act(async () => listeners.forEach((l) => l()));
  }
  async function mount() {
    root = createRoot(container);
    await act(async () => root!.render(<ThemeToggle />));
  }
  async function click() {
    await act(async () => button().click());
  }

  beforeEach(() => {
    osLight = false;
    listeners = [];
    localStorage.clear();
    html.className = 'dark';
    document.head.innerHTML = '';
    addMeta('(prefers-color-scheme: light)', THEME_COLOR.light);
    addMeta('(prefers-color-scheme: dark)', THEME_COLOR.dark);
    window.matchMedia = vi.fn().mockImplementation(() => ({
      get matches() {
        return osLight;
      },
      addEventListener: (_: string, l: () => void) => listeners.push(l),
      removeEventListener: (_: string, l: () => void) => (listeners = listeners.filter((x) => x !== l)),
    }));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = null;
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container.remove();
    document.head.innerHTML = '';
  });

  it('server-renders an empty icon slot and a neutral label, so nothing flips on load', async () => {
    // A light-mode user: the pre-paint script already applied their saved choice.
    localStorage.setItem(THEME_KEY, 'light');
    html.className = 'light';
    const markup = renderToString(<ThemeToggle />);
    expect(markup).not.toContain('<svg');
    expect(markup).toContain('aria-label="Theme"');

    container.innerHTML = markup;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => {
      root = hydrateRoot(container, <ThemeToggle />);
    });
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
    // Once mounted the icon appears — once, and already the right one for a light user.
    expect(label()).toBe('Switch to dark theme');
    expect(button().querySelectorAll('svg')).toHaveLength(1);
    expect(button().querySelector('svg')!.getAttribute('class')).toContain('lucide-moon');
    // The slot has a fixed size, so the icon appearing doesn't move anything.
    expect(button().querySelector('span')!.className).toContain('size-5');
  });

  it('cycles Light → Dark → System, and System clears the saved choice', async () => {
    await mount();
    expect(label()).toBe('Switch to light theme');

    await click();
    expect(html.className).toBe('light');
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
    expect(metas()).toEqual([THEME_COLOR.light, THEME_COLOR.light]);
    expect(label()).toBe('Switch to dark theme');

    await click();
    expect(html.className).toBe('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    expect(metas()).toEqual([THEME_COLOR.dark, THEME_COLOR.dark]);
    expect(label()).toBe('Use the system theme');

    osLight = true;
    await click();
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
    expect(html.className).toBe('light'); // the OS's theme, straight away
    expect(metas()).toEqual([THEME_COLOR.light, THEME_COLOR.light]);
    expect(label()).toBe('Switch to light theme');
  });

  it('System follows OS changes again; an explicit choice ignores them', async () => {
    localStorage.setItem(THEME_KEY, 'dark');
    await mount();
    await osChangesTo(true);
    expect(html.className).toBe('dark');
    expect(metas()).toEqual([THEME_COLOR.dark, THEME_COLOR.dark]);

    await click(); // dark → system
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
    expect(html.className).toBe('light');
    await osChangesTo(false);
    expect(html.className).toBe('dark');
    expect(metas()).toEqual([THEME_COLOR.dark, THEME_COLOR.dark]);
    await osChangesTo(true);
    expect(html.className).toBe('light');
    expect(metas()).toEqual([THEME_COLOR.light, THEME_COLOR.light]);
  });

  it('pins theme-color metas Next renders later (on navigation) to the shown theme', async () => {
    localStorage.setItem(THEME_KEY, 'light');
    html.className = 'light';
    await mount();
    expect(metas()).toEqual([THEME_COLOR.light, THEME_COLOR.light]);
    await act(async () => {
      document.head.innerHTML = '';
      addMeta('(prefers-color-scheme: dark)', THEME_COLOR.dark);
      await Promise.resolve(); // MutationObserver callbacks are microtasks
    });
    expect(metas()).toEqual([THEME_COLOR.light]);
  });
});
