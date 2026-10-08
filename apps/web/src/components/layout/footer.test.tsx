import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/components/brand/logo', () => ({ Logo: () => null }));
vi.mock('@/components/layout/network-badge', () => ({ NetworkBadge: () => null }));
vi.mock('@/components/LanguageSwitcher', () => ({ LanguageSwitcher: () => null }));

import { Footer } from './footer';

describe('Footer feedback link (#287)', () => {
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
    vi.unstubAllEnvs();
  });

  const feedbackLink = () =>
    [...container.querySelectorAll('a')].find((a) => a.textContent === 'Feedback');

  it('links to the feedback form when one is configured, with no placeholder left in it', () => {
    vi.stubEnv(
      'NEXT_PUBLIC_FEEDBACK_FORM_URL',
      'https://docs.google.com/forms/d/e/FORM/viewform?usp=pp_url&entry.1={handle}',
    );
    act(() => root.render(<Footer />));
    expect(feedbackLink()?.getAttribute('href')).toBe(
      'https://docs.google.com/forms/d/e/FORM/viewform?usp=pp_url',
    );
  });

  it('has no feedback link when the env var is unset', () => {
    vi.stubEnv('NEXT_PUBLIC_FEEDBACK_FORM_URL', '');
    act(() => root.render(<Footer />));
    expect(feedbackLink()).toBeUndefined();
    expect(container.textContent).toContain('GitHub'); // the rest of the column is intact
  });
});

describe('Footer link hygiene and heading outline (#511)', () => {
  const REPO = 'https://github.com/mericcintosun/alvinmunk';
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_FEEDBACK_FORM_URL', 'https://forms.gle/xyz');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllEnvs();
  });

  const render = () => act(() => root.render(<Footer />));
  const anchors = () => [...container.querySelectorAll<HTMLAnchorElement>('a')];
  /** The raw attribute — `a.href` would resolve `/stats` to an absolute URL. */
  const href = (a: HTMLAnchorElement) => a.getAttribute('href') ?? '';
  /** The anchor whose visible label is `label` (the external-link icon adds no text). */
  const link = (label: string) => anchors().find((a) => a.textContent === label);

  it('has no placeholder social link: the bare https://x.com entry is gone', () => {
    render();
    expect(anchors().filter((a) => href(a).startsWith('https://x.com'))).toEqual([]);
    expect(container.textContent).not.toContain('X / Twitter');
  });

  it('marks every outbound link as external: new tab, rel and an icon', () => {
    render();
    const external = anchors().filter((a) => href(a).startsWith('http'));
    // GitHub, docs, CONTRIBUTING, SECURITY and the configured feedback form.
    expect(external).toHaveLength(5);
    for (const a of external) {
      expect(a.getAttribute('rel'), href(a)).toBe('noopener noreferrer');
      expect(a.getAttribute('target'), href(a)).toBe('_blank');
      expect(a.getAttribute('aria-label'), href(a)).toContain('opens in a new tab');
      expect(a.querySelector('svg'), href(a)).not.toBeNull(); // the lucide ExternalLink mark
    }
    // Same-origin links stay in the tab and keep the plain label.
    expect(href(link('Leaderboard')!)).toBe('/leaderboard');
    expect(link('Leaderboard')?.hasAttribute('rel')).toBe(false);
    expect(link('Leaderboard')?.querySelector('svg')).toBeNull();
  });

  it('links the repo files people look for: docs, contribute and security', () => {
    render();
    expect(href(link('Docs')!)).toBe(`${REPO}/tree/main/docs`);
    expect(href(link('GitHub')!)).toBe(REPO);
    expect(href(link('Contribute')!)).toBe(`${REPO}/blob/main/CONTRIBUTING.md`);
    expect(href(link('Security')!)).toBe(`${REPO}/blob/main/SECURITY.md`);
  });

  it('links the live stats page', () => {
    render();
    expect(href(link('Stats')!)).toBe('/stats');
  });

  it('titles the columns with h2, so no heading level is skipped', () => {
    render();
    expect([...container.querySelectorAll('h1, h3, h4, h5, h6')]).toEqual([]);
    expect([...container.querySelectorAll('h2')].map((h) => h.textContent)).toEqual([
      'Product',
      'Learn',
      'Community',
    ]);
  });
});
