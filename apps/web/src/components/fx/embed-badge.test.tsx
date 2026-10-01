import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { EmbedBadge, badgeSnippets } from './embed-badge';

describe('badgeSnippets (#283)', () => {
  it('points the badge image at the API and links it back to the profile', () => {
    const { markdown, html } = badgeSnippets('https://alvinmunk.com', 'alice');

    expect(markdown).toBe(
      '[![@alice on alvinmunk](https://alvinmunk.com/api/badge/alice)](https://alvinmunk.com/u/alice)',
    );
    expect(html).toBe(
      '<a href="https://alvinmunk.com/u/alice"><img src="https://alvinmunk.com/api/badge/alice" alt="@alice on alvinmunk" /></a>',
    );
  });
});

describe('EmbedBadge', () => {
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
    vi.unstubAllGlobals();
  });

  it('renders the same relative paths on the server (no hydration mismatch)', () => {
    const html = renderToString(<EmbedBadge handle="alice" />);

    expect(html).toContain('/api/badge/alice');
    expect(html).toContain('/u/alice');
    expect(html).not.toContain('undefined');
  });

  it('shows absolute Markdown and HTML snippets once mounted', async () => {
    await act(async () => root.render(<EmbedBadge handle="alice" />));

    const codes = [...container.querySelectorAll('code')].map((c) => c.textContent);
    expect(codes).toHaveLength(2);
    expect(codes[0]).toContain(`${window.location.origin}/api/badge/alice`);
    expect(codes[0]).toContain(`${window.location.origin}/u/alice`);
    expect(codes[1]).toContain(`<img src="${window.location.origin}/api/badge/alice"`);
  });

  it('copies the Markdown snippet', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    await act(async () => root.render(<EmbedBadge handle="alice" />));

    const [markdownCopy] = container.querySelectorAll('button');
    await act(async () => markdownCopy.click());

    expect(writeText).toHaveBeenCalledWith(
      `[![@alice on alvinmunk](${window.location.origin}/api/badge/alice)](${window.location.origin}/u/alice)`,
    );
  });
});
