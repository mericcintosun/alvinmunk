import type { Viewport } from 'next';

/** localStorage key for an explicit theme choice. No key means "System": follow the OS. */
export const THEME_KEY = 'alvinmunk.theme';

export type ResolvedTheme = 'light' | 'dark';
export type ThemeChoice = ResolvedTheme | 'system';

/**
 * Browser-chrome colour of each theme: its `--background` token (globals.css) as hex, because
 * `theme-color` and the web manifest take no CSS variables. theme-color.test.ts keeps them equal.
 */
export const THEME_COLOR: Record<ResolvedTheme, string> = {
  dark: '#0a0611', // --background: 264 52% 4.5%
  light: '#f4effa', // --background: 264 52% 96%
};

/**
 * Without JS the OS preference picks the toolbar colour; once a theme is applied every
 * `theme-color` meta is pinned to it (see `syncThemeColor`). The server renders `dark`.
 */
export const rootViewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: THEME_COLOR.light },
    { media: '(prefers-color-scheme: dark)', color: THEME_COLOR.dark },
  ],
  colorScheme: 'dark light',
};

/** The theme the page shows right now (the class the pre-paint script or `applyTheme` set). */
export function currentTheme(): ResolvedTheme {
  return document.documentElement.classList.contains('light') ? 'light' : 'dark';
}

export function systemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/**
 * Point every `theme-color` meta at the shown theme. Next renders one per colour scheme, and
 * a browser reads whichever matches the OS, so all of them must follow an explicit choice.
 */
export function syncThemeColor() {
  const color = THEME_COLOR[currentTheme()];
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute('content', color);
  }
}

export function applyTheme(theme: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(theme);
  root.style.colorScheme = theme;
  syncThemeColor();
}

/**
 * Runs before first paint so the page never flashes the wrong theme: an explicit choice wins,
 * else the OS preference. The same steps as `applyTheme`, inlined; the theme-color metas are
 * synced again once parsed, in case Next emits them after this script.
 */
export const THEME_INIT = `(function(){try{var d=document,r=d.documentElement,c=${JSON.stringify(
  THEME_COLOR,
)},t=localStorage.getItem(${JSON.stringify(
  THEME_KEY,
)});if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}r.classList.remove('light','dark');r.classList.add(t);r.style.colorScheme=t;var s=function(){var m=d.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<m.length;i++){m[i].setAttribute('content',c[r.classList.contains('light')?'light':'dark'])}};s();d.addEventListener('DOMContentLoaded',s)}catch(e){}})();`;
