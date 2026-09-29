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

const claimCardMock = vi.fn<(...a: unknown[]) => { type: string; props: object }>(() => ({
  type: 'div',
  props: {},
}));
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
const getMetaMock = vi.fn();
vi.mock('@/lib/registry', () => ({
  reverseHandle: (...a: unknown[]) => reverseHandleMock(...a),
  getMeta: (...a: unknown[]) => getMetaMock(...a),
}));

const DAY = 86_400;
const now = () => Math.floor(Date.now() / 1000);
const G = 'G'.padEnd(56, 'B');
const vouch = (over: object = {}) => ({
  id: 7,
  from: G,
  note: 'unblocked me at 2am',
  claimed: false,
  claimer: null,
  created: now() - DAY,
  stake: 5,
  slashed: false,
  ...over,
});

async function render(params: { id: string }, extra: object = {}) {
  const { default: Image } = await import('./opengraph-image');
  await Image({ params, ...extra } as Parameters<typeof Image>[0]);
  return claimCardMock.mock.calls.at(-1)?.[0];
}

describe('/claim/[id]/opengraph-image', () => {
  beforeEach(() => {
    imageResponseMock.mockClear();
    claimCardMock.mockClear();
    loadFontMock.mockClear();
    getVouchMock.mockReset();
    reverseHandleMock.mockReset().mockResolvedValue(null);
    getMetaMock.mockReset().mockResolvedValue(null);
  });

  it('renders an open card with the voucher, their published face and note', async () => {
    const avatar = { kind: 'face', id: 'face-04' };
    getVouchMock.mockResolvedValue(vouch());
    reverseHandleMock.mockResolvedValue('alice');
    getMetaMock.mockResolvedValue({ avatar, bio: 'hi' });

    expect(await render({ id: '7' })).toEqual({
      status: 'open',
      vouchId: 7,
      from: G,
      handle: 'alice',
      avatar,
      note: 'unblocked me at 2am',
      daysLeft: 6,
    });
    expect(getVouchMock).toHaveBeenCalledWith(7);
    expect(reverseHandleMock).toHaveBeenCalledWith(G);
    expect(getMetaMock).toHaveBeenCalledWith(G);
  });

  it('loads both a regular and a bold weight of the same family', async () => {
    getVouchMock.mockResolvedValue(vouch());
    await render({ id: '7' });

    const [, options] = imageResponseMock.mock.calls[0] as [
      unknown,
      { width: number; height: number; fonts: Array<{ name: string; weight: number; data: string }> },
    ];
    expect(options).toMatchObject({ width: 1200, height: 630 });
    expect(options.fonts).toEqual([
      expect.objectContaining({ name: 'Noto Sans', weight: 400, data: 'font-bytes:fonts/NotoSans-Regular.ttf' }),
      expect.objectContaining({ name: 'Noto Sans', weight: 700, data: 'font-bytes:fonts/NotoSans-Bold.ttf' }),
    ]);
  });

  it('marks a claimed vouch as lit', async () => {
    getVouchMock.mockResolvedValue(vouch({ claimed: true, claimer: 'GCLAIMER' }));
    expect(await render({ id: '7' })).toMatchObject({ status: 'claimed' });
  });

  it.each([
    ['the stake window has passed', { created: now() - 8 * DAY }],
    ['the stake was already slashed', { slashed: true }],
  ])('marks an unclaimed card as closed when %s', async (_, over) => {
    getVouchMock.mockResolvedValue(vouch(over));
    expect(await render({ id: '7' })).toMatchObject({ status: 'closed' });
  });

  it('keeps the address and default face when the name and face reads fail', async () => {
    getVouchMock.mockResolvedValue(vouch());
    reverseHandleMock.mockRejectedValue(new Error('rpc down'));
    getMetaMock.mockRejectedValue(new Error('rpc down'));
    expect(await render({ id: '7' })).toMatchObject({ status: 'open', from: G, handle: null, avatar: undefined });
  });

  it('renders the unknown card when no half-card has the id', async () => {
    getVouchMock.mockResolvedValue(null);
    expect(await render({ id: '9999' })).toEqual({ status: 'unknown' });
    expect(reverseHandleMock).not.toHaveBeenCalled();
  });

  it.each(['not-a-number', '-1', '1.5', '1e300'])(
    'treats an id that can never be a vouch (%s) as unknown without reading the chain',
    async (id) => {
      expect(await render({ id })).toEqual({ status: 'unknown' });
      expect(getVouchMock).not.toHaveBeenCalled();
    },
  );

  it('never calls a live link dead when the chain does not answer', async () => {
    getVouchMock.mockRejectedValue(new Error('simulate get_vouch failed'));
    expect(await render({ id: '7' })).toEqual({ status: 'unavailable' });
    expect(imageResponseMock).toHaveBeenCalledTimes(1); // still a valid image, never a 500
  });

  describe('the claim code', () => {
    it('is never read: the route has no query, fragment or header access at all', () => {
      const src = readFileSync(join(process.cwd(), 'src/app/claim/[id]/opengraph-image.tsx'), 'utf8');
      const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const access of [/searchParams/, /URLSearchParams/, /\blocation\b/, /\bhash\b/, /\bheaders\b/, /\bcookies\b/, /parseClaimCode/, /console\./]) {
        expect(code).not.toMatch(access);
      }
    });

    it('never reaches the card, the image or a chain read, even when a caller hands it one', async () => {
      const SECRET = 'SUPER_SECRET_CLAIM_SEED';
      getVouchMock.mockResolvedValue(vouch());
      await render({ id: '7' }, { searchParams: { s: SECRET, k: SECRET } });
      const seen = JSON.stringify([
        claimCardMock.mock.calls,
        imageResponseMock.mock.calls.map(([, options]) => options),
        getVouchMock.mock.calls,
        reverseHandleMock.mock.calls,
        getMetaMock.mock.calls,
      ]);
      expect(seen).not.toContain(SECRET);
    });
  });
});
