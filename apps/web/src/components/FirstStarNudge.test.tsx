import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../messages/en.json';
import tr from '../../messages/tr.json';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { getMyVouchesMock } = vi.hoisted(() => ({ getMyVouchesMock: vi.fn() }));

vi.mock('@/lib/myvouches', () => ({ getMyVouches: getMyVouchesMock }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { FirstStarNudge } from './FirstStarNudge';

describe('FirstStarNudge (#475)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    getMyVouchesMock.mockReturnValue([]);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  async function render() {
    await act(async () => {
      root.render(<FirstStarNudge />);
    });
  }

  it('makes the call to action a focusable link to the vouch form', async () => {
    await render();
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/app/vouch');
    expect(link?.textContent).toBe('light your first star');
    link!.focus();
    expect(document.activeElement).toBe(link);
  });

  it('no longer points "below" (the vouch form is on another page), in either locale', async () => {
    await render();
    expect(container.textContent).toContain(en['firstStarNudge.body']);
    expect(container.textContent).not.toMatch(/below/i);
    expect(en['firstStarNudge.body']).not.toMatch(/below/i);
    expect(tr['firstStarNudge.body']).not.toMatch(/aşağı/i);
  });

  it('stays hidden once you have vouched, and after dismiss', async () => {
    getMyVouchesMock.mockReturnValue([{ id: 1, note: '', created: 1 }]);
    await render();
    expect(container.innerHTML).toBe('');

    getMyVouchesMock.mockReturnValue([]);
    act(() => root.unmount());
    root = createRoot(container);
    await render();
    const dismiss = [...container.querySelectorAll('button')].find((b) => b.textContent === 'dismiss');
    await act(async () => dismiss!.click());
    expect(container.innerHTML).toBe('');
  });
});
