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
