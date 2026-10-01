import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { SkipLink } from './skip-link';
import { I18nProvider } from '@/lib/i18n';

describe('SkipLink', () => {
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
  });

  it('renders a skip-to-content link with translation', async () => {
    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <SkipLink />
        </I18nProvider>,
      );
    });

    const link = container.querySelector('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('#main-content');
    expect(link?.textContent).toBe('Skip to content');
    expect(link?.className).toContain('sr-only');
  });

  it('renders Turkish translation when locale is tr', async () => {
    await act(async () => {
      root.render(
        <I18nProvider initialLocale="tr">
          <SkipLink />
        </I18nProvider>,
      );
    });

    const link = container.querySelector('a');
    expect(link?.textContent).toBe('İçeriğe atla');
  });
});
