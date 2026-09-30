import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { trackMock } = vi.hoisted(() => ({ trackMock: vi.fn() }));
vi.mock('@/lib/track', () => ({ track: trackMock }));

import { FeedbackPrompt, feedbackSeenKey } from './FeedbackPrompt';

const FORM = 'https://docs.google.com/forms/d/e/FORM/viewform';
const G = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';

describe('FeedbackPrompt (#287)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    trackMock.mockReset();
    vi.stubEnv('NEXT_PUBLIC_FEEDBACK_FORM_URL', `${FORM}?usp=pp_url&entry.1={handle}&entry.2={address}`);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllEnvs();
  });

  async function mount(action: 'claim' | 'vouch' = 'claim') {
    await act(async () => root.render(<FeedbackPrompt action={action} handle="bob" address={G} />));
  }
  const prompt = () => container.querySelector('section');
  const more = () => container.querySelector<HTMLAnchorElement>('a');
  const button = (text: string) =>
    [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(text));

  it('renders nothing, and remembers nothing, when no form is configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_FEEDBACK_FORM_URL', '');
    await mount();
    expect(container.innerHTML).toBe('');
    expect(localStorage.getItem(feedbackSeenKey('claim'))).toBeNull();
  });

  it('asks with thumbs and a "Tell us more" link to the form, handle and address prefilled', async () => {
    await mount();
    expect(prompt()?.getAttribute('aria-label')).toBe('Quick feedback');
    expect(container.textContent).toContain('How was that?');
    expect(button('Loved it')).toBeDefined();
    expect(button('Not great')).toBeDefined();
    const link = more()!;
    expect(link.textContent).toBe('Tell us more →');
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
    const url = new URL(link.href);
    expect(`${url.origin}${url.pathname}`).toBe(FORM);
    expect(Object.fromEntries(url.searchParams)).toEqual({ usp: 'pp_url', 'entry.1': '@bob', 'entry.2': G });
  });

  it('shows once per action: the next time it stays hidden', async () => {
    await mount('vouch');
    expect(prompt()).not.toBeNull();
    expect(localStorage.getItem(feedbackSeenKey('vouch'))).not.toBeNull();

    act(() => root.unmount());
    root = createRoot(container);
    await mount('vouch');
    expect(prompt()).toBeNull();

    // A different action still asks.
    act(() => root.unmount());
    root = createRoot(container);
    await mount('claim');
    expect(prompt()).not.toBeNull();
  });

  it('dismisses, and stays dismissed', async () => {
    await mount();
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]')!.click());
    expect(prompt()).toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    await mount();
    expect(prompt()).toBeNull();
  });

  it('records a thumb, thanks the user and keeps the form link', async () => {
    await mount('vouch');
    await act(async () => button('Not great')!.click());
    expect(trackMock).toHaveBeenCalledWith('feedback_rated', { action: 'vouch', rating: 'down' });
    expect(container.textContent).toContain('Thanks — that helps.');
    expect(button('Loved it')).toBeUndefined();
    expect(more()).not.toBeNull();
  });

  it('renders nothing on the server (storage is client-only)', () => {
    expect(renderToString(<FeedbackPrompt action="claim" handle="bob" address={G} />)).toBe('');
  });
});
