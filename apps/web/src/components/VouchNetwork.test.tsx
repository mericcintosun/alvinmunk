import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ME = 'G'.padEnd(56, 'M');
const THEY = 'G'.padEnd(56, 'T');
const A = 'G'.padEnd(56, 'A');
const B = 'G'.padEnd(56, 'B');

const m = vi.hoisted(() => ({
  vouchers: vi.fn(),
  backed: vi.fn(),
  events: vi.fn(),
  reverseHandles: vi.fn(),
}));

vi.mock('@/lib/constellation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/constellation')>()), // mutualNeighbours, timeAgo
  fetchVouchersOf: m.vouchers,
  fetchBackedBy: m.backed,
}));
vi.mock('@/lib/events', () => ({ fetchReputationEvents: m.events }));
vi.mock('@/lib/registry', () => ({ reverseHandles: m.reverseHandles }));
vi.mock('@/components/Avatar', () => ({ Avatar: () => <span data-testid="face" /> }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { VouchNetwork } from './VouchNetwork';
import { testnetNetwork } from '@/lib/read-network';

const claimed = (id: number, from: string, claimer: string) => ({
  topics: ['vouch', 'claimed'],
  data: [id, from, claimer],
  ledger: id,
});

describe('VouchNetwork (#277)', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    m.vouchers.mockReset().mockResolvedValue([{ from: A, vouchId: 1, note: 'unblocked me', created: 0 }]);
    m.backed.mockReset().mockResolvedValue([{ from: B, vouchId: 2, note: '', created: 0 }]);
    // THEY vouched A and B; ME vouched A → the viewer and THEY share only A.
    m.events.mockReset().mockResolvedValue([claimed(1, A, THEY), claimed(2, THEY, B), claimed(3, ME, A)]);
    m.reverseHandles.mockReset().mockResolvedValue({ [A]: 'alice', [B]: null });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (props: Partial<React.ComponentProps<typeof VouchNetwork>> = {}) =>
    act(async () =>
      root.render(<VouchNetwork address={THEY} handle="they" net={null} isMe={false} vouchedByCount={9} backedCount={1} {...props} />),
    );
  const hrefs = () => [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));

  it('lists who vouched and whom they backed, with handles and faces linking to each profile', async () => {
    await render();
    expect(m.vouchers).toHaveBeenCalledWith(THEY, 14, null);
    expect(m.backed).toHaveBeenCalledWith(THEY, 14, null);
    const text = container.textContent ?? '';
    expect(text).toContain('Vouched by');
    expect(text).toContain('9'); // the durable count, not the window's
    expect(text).toContain('@alice — “unblocked me”');
    expect(text).toContain('@they backed');
    // No handle: the short address, never "@G…", and the face opens the score page.
    expect(text).toContain('GBBB…BBBB');
    expect(text).not.toContain('@GBBB');
    expect(hrefs()).toEqual(expect.arrayContaining(['/u/alice', `/score/${B}`]));
    expect(text).toContain('Showing recent on-chain vouches');
  });

  it('shows who the signed-in viewer and the profile both know', async () => {
    await render({ viewer: ME });
    const mutual = container.querySelector('[data-testid="vouch-network-mutual"]');
    expect(mutual?.textContent).toContain('You both know');
    expect(mutual?.textContent).toContain('@alice');
    expect(mutual?.textContent).not.toContain('GBBB');
  });

  it('shows no mutual row signed out, on your own profile, or when nothing is shared', async () => {
    await render();
    expect(container.querySelector('[data-testid="vouch-network-mutual"]')).toBeNull();
    await render({ viewer: THEY, isMe: true });
    expect(container.querySelector('[data-testid="vouch-network-mutual"]')).toBeNull();
    m.events.mockResolvedValue([claimed(1, A, THEY)]);
    await render({ viewer: B });
    expect(container.querySelector('[data-testid="vouch-network-mutual"]')).toBeNull();
  });

  it('on a ?network= override reads that network, keeps it on every link, and has no mutual row', async () => {
    const net = testnetNetwork();
    await render({ viewer: ME, net });
    expect(m.vouchers).toHaveBeenCalledWith(THEY, 14, net);
    expect(m.backed).toHaveBeenCalledWith(THEY, 14, net);
    expect(m.reverseHandles).toHaveBeenCalledWith(expect.any(Array), net);
    expect(hrefs()).toEqual(expect.arrayContaining(['/u/alice?network=testnet', `/score/${B}?network=testnet`]));
    expect(m.events).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="vouch-network-mutual"]')).toBeNull();
  });

  it('lets a row label carrying a long @handle wrap beside its count (#477)', async () => {
    const long = 'w'.repeat(32);
    await render({ handle: long });
    const label = [...container.querySelectorAll('p')].find((p) => p.textContent === `@${long} backed`)!;
    expect(label.classList).toContain('min-w-0');
    expect(label.classList).toContain('[overflow-wrap:anywhere]');
  });

  it('says nobody only once the read is done — a skeleton while it runs', async () => {
    let resolve!: (v: unknown[]) => void;
    m.vouchers.mockReturnValue(new Promise((r) => (resolve = r)));
    m.backed.mockResolvedValue([]);
    await render();
    const empties = () => (container.textContent?.match(/Nobody yet/g) ?? []).length;
    expect(empties()).toBe(1); // backed is done and empty; vouched-by still reading
    await act(async () => resolve([]));
    expect(empties()).toBe(2);
  });
});
