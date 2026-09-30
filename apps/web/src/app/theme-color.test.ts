import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import manifest from './manifest';
import { applyTheme, rootViewport, THEME_COLOR, THEME_INIT, THEME_KEY } from '@/lib/theme';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const globalsCss = read('./globals.css');

/** `--background` of the first `selector { … }` block, as hex. */
function backgroundHex(selector: ':root' | ':root.light'): string {
  const escaped = selector.replace('.', '\\.');
  const body = new RegExp(`(^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(globalsCss)?.[2] ?? '';
  const m = /--background:\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/.exec(body);
  if (!m) throw new Error(`no --background in ${selector}`);
  const [h, s, l] = [Number(m[1]), Number(m[2]) / 100, Number(m[3]) / 100];
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return `#${[f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')}`;
}

describe('browser-chrome colours', () => {
  it('are the --background token of each theme', () => {
    expect(THEME_COLOR.dark).toBe(backgroundHex(':root'));
    expect(THEME_COLOR.light).toBe(backgroundHex(':root.light'));
  });

  it('the viewport exports a theme-color per colour scheme', () => {
    expect(rootViewport.themeColor).toEqual([
      { media: '(prefers-color-scheme: light)', color: THEME_COLOR.light },
      { media: '(prefers-color-scheme: dark)', color: THEME_COLOR.dark },
    ]);
    expect(rootViewport.colorScheme).toBe('dark light');
  });

  it('the PWA manifest uses the dark background token, not a stray violet', () => {
    const m = manifest();
    expect(m.background_color).toBe(THEME_COLOR.dark);
    expect(m.theme_color).toBe(THEME_COLOR.dark);
  });
});

describe('pre-paint theme script', () => {
  let osLight = false;
  const metas = () => [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute('content'));
  function addMetas() {
    for (const [media, color] of [
      ['(prefers-color-scheme: light)', THEME_COLOR.light],
      ['(prefers-color-scheme: dark)', THEME_COLOR.dark],
    ]) {
      const meta = document.createElement('meta');
      meta.name = 'theme-color';
      meta.media = media;
      meta.content = color;
      document.head.appendChild(meta);
    }
  }
  const run = () => new Function(THEME_INIT)();

  beforeEach(() => {
    osLight = false;
    localStorage.clear();
    document.documentElement.className = 'dark';
    document.head.innerHTML = '';
    window.matchMedia = vi.fn().mockImplementation(() => ({ matches: osLight }));
  });
  afterEach(() => {
    document.head.innerHTML = '';
    document.documentElement.className = '';
    document.documentElement.style.colorScheme = '';
  });

  it('an explicit choice beats the OS and pins every theme-color meta to it', () => {
    addMetas();
    localStorage.setItem(THEME_KEY, 'light');
    run();
    expect(document.documentElement.className).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(metas()).toEqual([THEME_COLOR.light, THEME_COLOR.light]);
  });

  it('without a choice it follows the OS', () => {
    addMetas();
    osLight = true;
    run();
    expect(document.documentElement.className).toBe('light');
    expect(metas()).toEqual([THEME_COLOR.light, THEME_COLOR.light]);
  });

  it('syncs theme-color metas parsed after the script once the document is loaded', () => {
    localStorage.setItem(THEME_KEY, 'dark');
    osLight = true;
    run();
    addMetas();
    document.dispatchEvent(new Event('DOMContentLoaded'));
    expect(metas()).toEqual([THEME_COLOR.dark, THEME_COLOR.dark]);
  });

  it('applyTheme moves the class and every theme-color meta together', () => {
    addMetas();
    applyTheme('light');
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(metas()).toEqual([THEME_COLOR.light, THEME_COLOR.light]);
    applyTheme('dark');
    expect(metas()).toEqual([THEME_COLOR.dark, THEME_COLOR.dark]);
  });
});
