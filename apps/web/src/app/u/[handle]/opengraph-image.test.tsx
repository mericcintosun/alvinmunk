import { describe, it, expect, vi, beforeEach } from 'vitest';

// `next/og`'s ImageResponse replaces its *entire* default font set with whatever `fonts`
// array it's given (see index.node.js's `render`: `fonts: options.fonts || defaultFonts`).
// Passing only a bold font would make every text node render bold, including the ones that
// never asked for fontWeight: 700 — regression covered below (issue #206).
const imageResponseMock = vi.fn();
vi.mock('next/og', () => ({
  ImageResponse: class {
    constructor(element: unknown, options: unknown) {
      imageResponseMock(element, options);
    }
  },
}));

const ogResolveMock = vi.fn();
const ogCardMock = vi.fn<(...a: unknown[]) => { type: string; props: object }>(() => ({
  type: 'div',
  props: {},
}));
vi.mock('@/lib/og-card', () => ({
  ogResolve: (...a: unknown[]) => ogResolveMock(...a),
  ogCard: (...a: unknown[]) => ogCardMock(...a),
  OG_RETRY_CACHE: 'public, max-age=60, s-maxage=60',
}));

const loadFontMock = vi.fn((relPath: string) => `font-bytes:${relPath}`);
vi.mock('@/lib/og-assets', () => ({ loadFont: (relPath: string) => loadFontMock(relPath) }));

describe('/u/[handle]/opengraph-image', () => {
  beforeEach(() => {
    imageResponseMock.mockClear();
    ogResolveMock.mockReset();
    ogCardMock.mockClear();
    loadFontMock.mockClear();
    ogResolveMock.mockResolvedValue({ address: 'GABC', lookup: 'ok', scores: { social: 1, earned: 2, vouchedBy: 0, backed: 0 }, avatar: undefined, bio: '' });
  });

  it('loads both a regular and a bold weight of the same family, not the bold weight alone', async () => {
    const { default: Image } = await import('./opengraph-image');
    await Image({ params: { handle: 'alice' } });

    expect(loadFontMock).toHaveBeenCalledWith('fonts/NotoSans-Regular.ttf');
    expect(loadFontMock).toHaveBeenCalledWith('fonts/NotoSans-Bold.ttf');

    const [, options] = imageResponseMock.mock.calls[0] as [unknown, { fonts: Array<{ name: string; weight: number; data: string }> }];
    expect(options.fonts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Noto Sans', weight: 400, data: 'font-bytes:fonts/NotoSans-Regular.ttf' }),
        expect.objectContaining({ name: 'Noto Sans', weight: 700, data: 'font-bytes:fonts/NotoSans-Bold.ttf' }),
      ]),
    );
    // Every font shares one family name — ogCard's root only sets `fontFamily: 'Noto Sans'`
    // once, so anything registered under a different name would never be selected.
    expect(options.fonts.every((f) => f.name === 'Noto Sans')).toBe(true);
  });

  it('lowercases the handle before resolving it', async () => {
    const { default: Image } = await import('./opengraph-image');
    await Image({ params: { handle: 'Alice' } });
    expect(ogResolveMock).toHaveBeenCalledWith('alice');
  });

  it('drops a leading @ before resolving it', async () => {
    const { default: Image } = await import('./opengraph-image');
    await Image({ params: { handle: '%40Alice' } });
    expect(ogResolveMock).toHaveBeenCalledWith('alice');
  });

  it('keeps next/og default caching for a resolved card', async () => {
    const { default: Image } = await import('./opengraph-image');
    await Image({ params: { handle: 'alice' } });
    const [, options] = imageResponseMock.mock.calls[0] as [unknown, { headers?: Record<string, string> }];
    expect(options.headers).toBeUndefined();
  });

  it('caches the neutral card for a minute when the lookup failed (#188)', async () => {
    ogResolveMock.mockResolvedValueOnce({
      address: null,
      lookup: 'error',
      scores: { social: 0, earned: 0, vouchedBy: 0, backed: 0 },
      bio: '',
    });
    const { default: Image } = await import('./opengraph-image');
    await Image({ params: { handle: 'alice' } });
    const [, options] = imageResponseMock.mock.calls[0] as [unknown, { headers: Record<string, string> }];
    // Lowercase, so it replaces next/og's own `cache-control` instead of joining it.
    expect(options.headers).toEqual({ 'cache-control': 'public, max-age=60, s-maxage=60' });
    expect(ogCardMock).toHaveBeenCalledWith(expect.objectContaining({ address: null, lookup: 'error' }));
  });
});
