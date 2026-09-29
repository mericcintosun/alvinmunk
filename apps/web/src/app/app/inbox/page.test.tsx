import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BOB = 'GDIS5BDXSI2DDJNTKRZPI6MNB5XCLMN4Z6PPRPM4RQLZ3PSQ2YTERLFA';
const ALICE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const m = vi.hoisted(() => ({
  profile: { address: 'GME' } as { address: string } | null,
  loadInbox: vi.fn(),
  markInboxRead: vi.fn(),
  reverseHandles: vi.fn(),
}));

vi.mock('@/components/wallet/wallet-provider', () => ({ useWallet: () => ({ profile: m.profile }) }));
vi.mock('@/lib/inbox', () => ({ loadInbox: m.loadInbox, markInboxRead: m.markInboxRead }));
vi.mock('@/lib/registry', () => ({ reverseHandles: m.reverseHandles }));

import InboxPage from './page';

const ITEMS = [
  { id: 'streak:s', kind: 'streak', ledger: 130, weeks: 3 },
  { id: 'quest:q', kind: 'quest', ledger: 120, questId: 2 },
  { id: 'tip:t', kind: 'tip', ledger: 110, at: Math.floor(Date.now() / 1000), peer: BOB, amount: '25000000' },
  { id: 'claim:7', kind: 'claim', ledger: 0, peer: ALICE, vouchId: 7 },
];

describe('/app/inbox (#279)', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    m.profile = { address: 'GME' };
    m.loadInbox.mockReset().mockResolvedValue({ items: ITEMS, unread: new Set(['tip:t', 'claim:7']) });
    m.markInboxRead.mockReset();
    m.reverseHandles.mockReset().mockResolvedValue({ [BOB]: 'bob', [ALICE]: null });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = () => act(async () => root.render(<InboxPage />));
  const rows = () => [...container.querySelectorAll('li')];

  it('lists every kind newest first, with the other party by @handle (or address)', async () => {
    await render();
    expect(m.loadInbox).toHaveBeenCalledWith('GME');
    expect(rows().map((r) => r.getAttribute('data-kind'))).toEqual(['streak', 'quest', 'tip', 'claim']);
    const text = rows().map((r) => r.textContent);
    expect(text[0]).toContain('Your quest streak reached 3 weeks');
    expect(text[1]).toContain('Quest #2 verified');
    expect(text[2]).toContain('@bob tipped you 2.5 USDC');
    expect(text[3]).toContain('GAAA…AWHF claimed your half-card');
    expect(m.reverseHandles).toHaveBeenCalledWith([ALICE, BOB].sort());
  });

  it('marks the unread items read on opening, and still highlights them for this visit', async () => {
    await render();
    expect(m.markInboxRead).toHaveBeenCalledWith('GME', ['tip:t', 'claim:7']);
    const isNew = rows().map((r) => r.textContent?.includes('New'));
    expect(isNew).toEqual([false, false, true, true]);
  });

  it('marks nothing when nothing is unread, and shows the empty state for an empty inbox', async () => {
    m.loadInbox.mockResolvedValue({ items: [], unread: new Set() });
    await render();
    expect(m.markInboxRead).not.toHaveBeenCalled();
    expect(container.textContent).toContain('All quiet');
  });
});
