import { describe, it, expect, vi, beforeEach } from 'vitest';

// Same regression as /u/[handle]/opengraph-image.test.tsx: `ImageResponse`'s `fonts` option
// fully replaces the default font set, so a bold-only array would make every text node bold.
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
}));

const loadFontMock = vi.fn((relPath: string) => `font-bytes:${relPath}`);
vi.mock('@/lib/og-assets', () => ({ loadFont: (relPath: string) => loadFontMock(relPath) }));

describe('/v/[handle]/opengraph-image', () => {
  beforeEach(() => {
    imageResponseMock.mockClear();
    ogResolveMock.mockReset();
    ogCardMock.mockClear();
    loadFontMock.mockClear();
    ogResolveMock.mockResolvedValue({ address: 'GABC', scores: { social: 1, earned: 2, vouchedBy: 0, backed: 0 }, avatar: undefined });
  });

  it('loads both a regular and a bold weight of the same family, not the bold weight alone', async () => {
    const { default: Image } = await import('./opengraph-image');
    await Image({ params: { handle: 'bob' } });

    expect(loadFontMock).toHaveBeenCalledWith('fonts/NotoSans-Regular.ttf');
    expect(loadFontMock).toHaveBeenCalledWith('fonts/NotoSans-Bold.ttf');

    const [, options] = imageResponseMock.mock.calls[0] as [unknown, { fonts: Array<{ name: string; weight: number; data: string }> }];
    expect(options.fonts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Noto Sans', weight: 400, data: 'font-bytes:fonts/NotoSans-Regular.ttf' }),
        expect.objectContaining({ name: 'Noto Sans', weight: 700, data: 'font-bytes:fonts/NotoSans-Bold.ttf' }),
      ]),
    );
    expect(options.fonts.every((f) => f.name === 'Noto Sans')).toBe(true);
  });

  it('passes invite: true and lowercases the handle', async () => {
    const { default: Image } = await import('./opengraph-image');
    await Image({ params: { handle: 'Bob' } });
    expect(ogResolveMock).toHaveBeenCalledWith('bob');
    expect(ogCardMock).toHaveBeenCalledWith(expect.objectContaining({ handle: 'bob', invite: true }));
  });
});
