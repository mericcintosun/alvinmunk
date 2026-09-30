// @vitest-environment node
/**
 * `GET /api/badge/[handle]` (#283): valid SVG for a claimed and an unclaimed handle, CDN
 * cache headers, and no failure mode that renders a broken image — an RPC miss, an
 * unreadable profile and a non-handle path all degrade to the neutral badge with status 200.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  resolveHandle: vi.fn(),
  getProfile: vi.fn(),
  getCounts: vi.fn(),
}));

vi.mock('@/lib/registry', () => ({ resolveHandle: m.resolveHandle }));
vi.mock('@/lib/reputation', () => ({ getProfile: m.getProfile, getCounts: m.getCounts }));

import { GET } from './route';

const ADDRESS = 'G'.padEnd(56, 'T');
const CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=3600';

const call = (handle: string, style?: string) =>
  GET(new Request(`http://localhost/api/badge/${encodeURIComponent(handle)}${style ? `?style=${style}` : ''}`), {
    params: { handle },
  });

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  m.resolveHandle.mockReset().mockResolvedValue(ADDRESS);
  m.getProfile.mockReset().mockResolvedValue({ social: 5, earned: 12, verified: true });
  m.getCounts.mockReset().mockResolvedValue({ vouchedBy: 3, backed: 1 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/badge/[handle] — claimed', () => {
  it('returns a cacheable SVG with the people count and Earned XP', async () => {
    const res = await call('Alice');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe(CACHE_CONTROL);
    const svg = await res.text();
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    // The handle is lowercased like every other registry read.
    expect(svg).toContain('@alice');
    expect(svg).toContain('3 vouched');
    expect(svg).toContain('12 earned');
    expect(m.resolveHandle).toHaveBeenCalledWith('alice');
  });

  it('shows the on-chain people counter, not Social XP', async () => {
    m.getProfile.mockResolvedValue({ social: 99, earned: 12, verified: false });

    const svg = await (await call('alice')).text();

    expect(svg).toContain('3 vouched');
    expect(svg).not.toContain('99 vouched');
  });

  it('falls back to Social XP when the contract predates get_counts', async () => {
    m.getCounts.mockResolvedValue(null);
    m.getProfile.mockResolvedValue({ social: 7, earned: 0, verified: false });

    expect(await (await call('alice')).text()).toContain('7 vouched');
  });

  it('renders the card shape on ?style=card and the flat one otherwise', async () => {
    const card = await (await call('alice', 'card')).text();
    expect(card).toContain('VOUCHED BY');
    expect(card).toContain('VERIFIED');

    const flat = await (await call('alice', 'plaid')).text();
    expect(flat).not.toContain('VOUCHED BY');
  });
});

describe('GET /api/badge/[handle] — unclaimed and odd input', () => {
  it('returns a neutral unclaimed badge with status 200, never a 404', async () => {
    m.resolveHandle.mockResolvedValue(null);

    const res = await call('nobody');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8');
    expect(await res.text()).toContain('@nobody · unclaimed');
    // An unclaimed handle is never read further.
    expect(m.getProfile).not.toHaveBeenCalled();
    expect(m.getCounts).not.toHaveBeenCalled();
  });

  it('never rejects: an RPC miss and an unreadable profile both stay 200', async () => {
    m.resolveHandle.mockRejectedValue(new Error('rpc down'));
    expect(await (await call('alice')).text()).toContain('unclaimed');

    m.resolveHandle.mockResolvedValue(ADDRESS);
    m.getProfile.mockRejectedValue(new Error('rpc down'));
    m.getCounts.mockRejectedValue(new Error('rpc down'));
    const res = await call('alice');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('@alice · 0 vouched · 0 earned');
  });

  it('renders a param that can never be a handle without touching the chain', async () => {
    const res = await call('<script>alert(1)</script>');

    expect(res.status).toBe(200);
    const svg = await res.text();
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('alert');
    expect(svg).toContain('@unknown · unclaimed');
    expect(m.resolveHandle).not.toHaveBeenCalled();
  });

  it('treats a handle longer than the registry allows as unclaimed, not as a lookup', async () => {
    await call('a'.repeat(33));

    expect(m.resolveHandle).not.toHaveBeenCalled();
  });
});
