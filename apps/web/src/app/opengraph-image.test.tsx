// @vitest-environment node
import { describe, it, expect } from 'vitest';
import Image, { alt, contentType, size } from './opengraph-image';
import { SITE_CARD_ALT } from '@/lib/og-card';

// The real renderer (Satori + resvg) with the real fonts: proves the site card lays out
// without a Satori error and comes out at the size its metadata declares (#505).
describe('app/opengraph-image (the site-wide card)', () => {
  it('declares a 1200×630 PNG with alt text', () => {
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe('image/png');
    expect(alt).toBe(SITE_CARD_ALT);
  });

  it('renders a 1200×630 PNG', async () => {
    const png = Buffer.from(await Image().arrayBuffer());
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // IHDR: width and height, big-endian, right after the 8-byte signature and chunk header.
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  }, 30_000);
});
