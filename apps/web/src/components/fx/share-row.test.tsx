import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The component leans on Next's automatic JSX runtime; this vitest setup compiles JSX to
// `React.createElement`, so give it a global React to resolve.
(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { ShareRow } from './share-row';

const tweetUrl = (html: string) => new URL(new DOMParser().parseFromString(html, 'text/html').querySelector('a')!.href);

describe('ShareRow', () => {
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
    vi.restoreAllMocks();
  });

  it('renders the same markup on the server whether or not window exists (no hydration mismatch)', () => {
    // jsdom has a window, so a render-time `window.location` read would show up here.
    const html = renderToString(<ShareRow path="/leaderboard" text="Top of the sky" />);
    expect(tweetUrl(html).searchParams.get('url')).toBe('/leaderboard');
  });

  it('points the tweet intent at the absolute URL once mounted', async () => {
    await act(async () => root.render(<ShareRow path="/leaderboard" text="Top of the sky" />));

    const href = new URL(container.querySelector('a')!.href);
    expect(href.origin).toBe('https://twitter.com');
    expect(href.searchParams.get('text')).toBe('Top of the sky');
    expect(href.searchParams.get('url')).toBe(`${window.location.origin}/leaderboard`);
  });

  it('copies the absolute URL', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    await act(async () => root.render(<ShareRow path="/u/alice" text="me" />));

    await act(async () => container.querySelector('button')!.click());
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/u/alice`);
    expect(container.querySelector('button')!.textContent).toContain('copied');
    vi.unstubAllGlobals();
  });
});
