import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { resolveHandleMock } = vi.hoisted(() => ({ resolveHandleMock: vi.fn() }));

vi.mock('@/lib/registry', () => ({
  resolveHandle: resolveHandleMock,
  getMeta: () => Promise.resolve(null),
}));
vi.mock('@/lib/constellation', () => ({
  getPeopleCounts: () => Promise.resolve({ vouchedBy: 0, backed: 0 }),
}));
vi.mock('@/components/wallet/wallet-provider', () => ({ useWallet: () => ({ profile: null }) }));

import InvitePage from './page';

const KEY = 'alvinmunk.ref';
const BOB = 'GBOBBOBBOBBOBBOBBOBBOBBOBBOBBOBBOBBOBBOBBOBBOBBOBBOBBOB';

describe('/v/[handle] invite ref', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    sessionStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  async function visit(handle: string) {
    await act(async () => {
      root.render(<InvitePage params={{ handle }} />);
    });
  }

  it('stores a claimed handle, normalized, once it resolves', async () => {
    resolveHandleMock.mockResolvedValue(BOB);
    await visit('Bob');
    expect(resolveHandleMock).toHaveBeenCalledWith('bob');
    expect(sessionStorage.getItem(KEY)).toBe('bob');
  });

  it('never stores an unclaimed handle', async () => {
    resolveHandleMock.mockResolvedValue(null);
    await visit('nobody');
    expect(resolveHandleMock).toHaveBeenCalledWith('nobody');
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('does not store the handle while it is still resolving, or when the lookup fails', async () => {
    let fail!: (e: Error) => void;
    resolveHandleMock.mockReturnValue(new Promise((_, reject) => (fail = reject)));
    await visit('bob');
    expect(sessionStorage.getItem(KEY)).toBeNull();
    await act(async () => fail(new Error('rpc down')));
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('keeps a 32-character @handle inside a phone screen (#477)', async () => {
    const long = 'w'.repeat(32);
    resolveHandleMock.mockResolvedValue(BOB);
    await visit(long);

    // The headline wraps anywhere and steps down a size below sm; desktop keeps text-4xl.
    const h1 = container.querySelector('h1')!;
    expect(h1.textContent).toContain(`@${long}`);
    expect(h1.classList).toContain('[overflow-wrap:anywhere]');
    expect(h1.classList).toContain('text-3xl');
    expect(h1.classList).toContain('sm:text-4xl');
    // The card's name line truncates inside its min-w-0 column.
    const name = [...container.querySelectorAll('div')].find((el) => el.textContent === `@${long}`)!;
    expect(name.classList).toContain('truncate');
    expect(name.parentElement?.classList).toContain('min-w-0');
    // The frame header label wraps rather than pushing its index out.
    const label = [...container.querySelectorAll('span')].find((el) => el.textContent === `invite // @${long}`)!;
    expect(label.classList).toContain('[overflow-wrap:anywhere]');
    expect(label.classList).toContain('min-w-0');
  });

  it('keeps an earlier inviter when the new link is unclaimed', async () => {
    sessionStorage.setItem(KEY, 'carol');
    resolveHandleMock.mockResolvedValue(null);
    await visit('nobody');
    expect(sessionStorage.getItem(KEY)).toBe('carol');
  });
});
