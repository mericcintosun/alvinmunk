import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const imageResponseMock = vi.fn();
vi.mock('next/og', () => ({
  ImageResponse: class {
    constructor(element: unknown, options: unknown) {
      imageResponseMock(element, options);
    }
  },
}));

const claimCardMock = vi.fn();
vi.mock('@/lib/og-card', () => ({
  claimCard: (...a: unknown[]) => claimCardMock(...a),
}));

const loadFontMock = vi.fn((relPath: string) => `font-bytes:${relPath}`);
vi.mock('@/lib/og-assets', () => ({ loadFont: (relPath: string) => loadFontMock(relPath) }));

const getVouchMock = vi.fn();
vi.mock('@/lib/reputation', () => ({
  getVouch: (...a: unknown[]) => getVouchMock(...a),
  VOUCH_TTL_SECS: 604_800,
}));

const reverseHandleMock = vi.fn();
vi.mock('@/lib/registry', () => ({ reverseHandle: (...a: unknown[]) => reverseHandleMock(...a) }));

const VOUCH = {
  id: 7,
  from: 'G'.padEnd(56, 'B'),
  note: 'unblocked me at 2am',
  claimed: false,
  claimer: null,
  created: Math.floor(Date.now() / 1000) - 86_400,
  stake: 3,
  slashed: false,
};

describe('/claim/[id]/opengraph-image', () => {
  beforeEach(() => {
    imageResponseMock.mockClear();
    claimCardMock.mockClear();
    getVouchMock.mockReset();
    reverseHandleMock.mockReset();
    reverseHandleMock.mockResolvedValue(null);
  });

  it('renders an open card from the public id, with both font weights', async () => {
    getVouchMock.mockResolvedValue(VOUCH);
    reverseHandleMock.mockResolvedValue('alice');

    const { default: Image } = await import('./opengraph-image');
    await Image({ params: { id: '7' } });

    expect(getVouchMock).toHaveBeenCalledWith(7);
    expect(reverseHandleMock).toHaveBeenCalledWith(VOUCH.from);
    expect(claimCardMock).toHaveBeenCalledWith(
      expect.objectContaining({ vouchId: 7, from: VOUCH.from, handle: 'alice', status: 'open', daysLeft: 6 }),
    );

    expect(loadFontMock).toHaveBeenCalledWith('fonts/NotoSans-Regular.ttf');
    expect(loadFontMock).toHaveBeenCalledWith('fonts/NotoSans-Bold.ttf');
    const [, options] = imageResponseMock.mock.calls[0] as [unknown, { fonts: Array<{ name: string; weight: number; data: string }> }];
    expect(options.fonts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Noto Sans', weight: 400, data: 'font-bytes:fonts/NotoSans-Regular.ttf' }),
        expect.objectContaining({ name: 'Noto Sans', weight: 700, data: 'font-bytes:fonts/NotoSans-Bold.ttf' }),
      ]),
    );
  });

  it('marks a claimed vouch as lit', async () => {
    getVouchMock.mockResolvedValue({ ...VOUCH, claimed: true });
    const { default: Image } = await import('./opengraph-image');
    await Image({ params: { id: '7' } });
    expect(claimCardMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'claimed' }));
  });

  it('renders a neutral card for an unknown id and never throws', async () => {
    getVouchMock.mockResolvedValue(null);
    const { default: Image } = await import('./opengraph-image');
    await Image({ params: { id: '9999' } });
    expect(claimCardMock).toHaveBeenCalledWith(
      expect.objectContaining({ from: null, handle: null, status: 'unknown' }),
    );
  });

  it('treats a non-numeric id as unknown without reading the chain', async () => {
    const { default: Image } = await import('./opengraph-image');
    await Image({ params: { id: 'not-a-number' } });
    expect(getVouchMock).not.toHaveBeenCalled();
    expect(claimCardMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'unknown' }));
  });

  it('never reads the claim secret from any query/hash parameter', async () => {
    const src = readFileSync(join(process.cwd(), 'src/app/claim/[id]/opengraph-image.tsx'), 'utf8');
    expect(src).not.toMatch(/searchParams/);
    expect(src).not.toMatch(/URLSearchParams/);
    expect(src).not.toMatch(/\blocation\b/);
    expect(src).not.toMatch(/\bhash\b/);

    // Even if a caller hands it an `s`, the route must ignore it.
    getVouchMock.mockResolvedValue(VOUCH);
    const { default: Image } = await import('./opengraph-image');
    await Image({ params: { id: '7' }, searchParams: { s: 'SUPER_SECRET' } } as never);
    expect(JSON.stringify(claimCardMock.mock.calls)).not.toContain('SUPER_SECRET');
  });
});
