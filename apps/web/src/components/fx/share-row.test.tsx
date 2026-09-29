import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareRow } from './share-row';

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
    vi.clearAllMocks();
  });

  it('renders tweet and copy buttons without hydration mismatch', async () => {
    await act(async () => {
      root.render(<ShareRow path="/leaderboard" text="Test leaderboard" />);
    });

    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).toContain('tweet');
    expect(buttons[1].textContent).toContain('copy_link');
  });

  it('opens absolute Twitter intent URL on tweet click', async () => {
    const openMock = vi.spyOn(window, 'open').mockImplementation(() => null);

    await act(async () => {
      root.render(<ShareRow path="/leaderboard" text="Test leaderboard" />);
    });

    const tweetButton = container.querySelector('button');
    expect(tweetButton).not.toBeNull();

    await act(async () => {
      tweetButton!.click();
    });

    expect(openMock).toHaveBeenCalledOnce();
    const calledUrl = openMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('https://twitter.com/intent/tweet');
    expect(calledUrl).toContain('text=Test%20leaderboard');
    expect(calledUrl).toContain('url=');
    const urlParam = calledUrl.split('url=')[1];
    expect(urlParam).toMatch(/^https?:\/\/.+\/leaderboard/);
  });

  it('copies absolute URL to clipboard on copy click', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText: writeTextMock } });

    await act(async () => {
      root.render(<ShareRow path="/leaderboard" text="Test leaderboard" />);
    });

    const buttons = container.querySelectorAll('button');
    const copyButton = buttons[1];

    await act(async () => {
      copyButton.click();
    });

    expect(writeTextMock).toHaveBeenCalledOnce();
    const copiedUrl = writeTextMock.mock.calls[0][0] as string;
    expect(copiedUrl).toMatch(/^https?:\/\/.+\/leaderboard/);
  });

  it('shows copied state temporarily', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText: writeTextMock } });

    await act(async () => {
      root.render(<ShareRow path="/leaderboard" text="Test leaderboard" />);
    });

    const buttons = container.querySelectorAll('button');
    const copyButton = buttons[1];

    expect(copyButton.textContent).toContain('copy_link');

    await act(async () => {
      copyButton.click();
    });

    expect(copyButton.textContent).toContain('copied');

    await act(async () => {
      await new Promise((r) => setTimeout(r, 1600));
    });

    expect(copyButton.textContent).toContain('copy_link');
  });
});