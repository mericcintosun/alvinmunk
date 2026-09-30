/**
 * Central registry for the sticker/scrapbook asset kit (public/assets/**). One source of
 * truth for paths + intrinsic pixel sizes, so components never hardcode magic px and the
 * "render at or below intrinsic size" (no-quality-loss) rule is enforceable. PNGs are
 * served unoptimized (next.config) and rendered via <Sticker>/<StateArt> (<img>).
 */
const BASE = '/assets';

/** Public URL for any asset under public/assets (e.g. asset('stickers/star-01.webp')). */
export function asset(path: string): string {
  return `${BASE}/${path.replace(/^\/+/, '')}`;
}

interface AssetMeta {
  file: string;
  w: number;
  h: number;
}

/** Illustrated empty/success states — the emotional beats of the loop. */
export const STATE = {
  'vouch-sent': { file: 'states/vouch-sent.webp', w: 441, h: 265 },
  'claim-success': { file: 'states/claim-success.webp', w: 425, h: 237 },
  'quest-complete': { file: 'states/quest-complete.webp', w: 294, h: 265 },
  'tip-received': { file: 'states/tip-received.webp', w: 236, h: 294 },
  'streak-fire': { file: 'states/streak-fire.webp', w: 310, h: 263 },
  'empty-leaderboard': { file: 'states/empty-leaderboard.webp', w: 436, h: 260 },
} satisfies Record<string, AssetMeta>;
export type StateKind = keyof typeof STATE;

/** Curated decorative stickers (friendly name → file + intrinsic size). */
export const STICKER = {
  'star-lime': { file: 'stickers/star-01.webp', w: 112, h: 106 },
  'star-arc': { file: 'stickers/star-02.webp', w: 136, h: 86 },
  'star-pop': { file: 'stickers/star-03.webp', w: 100, h: 99 },
  'wax-seal': { file: 'stickers/wax-01.webp', w: 106, h: 108 },
  'stamp-verified': { file: 'stickers/stamp-01.webp', w: 126, h: 97 },
  'stamp-ticket': { file: 'stickers/stamp-02.webp', w: 125, h: 83 },
  'stamp-strip': { file: 'stickers/stamp-03.webp', w: 127, h: 67 },
  'social-seen': { file: 'stickers/social-01.webp', w: 115, h: 88 },
  'social-eye': { file: 'stickers/social-02.webp', w: 99, h: 85 },
  'social-plus1': { file: 'stickers/social-03.webp', w: 80, h: 71 },
  'social-boom': { file: 'stickers/social-04.webp', w: 114, h: 94 },
  'hand-crossed': { file: 'stickers/hand-01.webp', w: 140, h: 93 },
  'hand-shake': { file: 'stickers/hand-02.webp', w: 162, h: 105 },
  'hand-open': { file: 'stickers/hand-03.webp', w: 139, h: 80 },
  'doodle-arrow': { file: 'stickers/doodles/doodle-01.webp', w: 74, h: 51 },
  'doodle-spark': { file: 'stickers/doodles/doodle-02.webp', w: 53, h: 56 },
  'doodle-spiral': { file: 'stickers/doodles/doodle-03.webp', w: 55, h: 58 },
  'burst-new': { file: 'decals/sticker-burst-01.webp', w: 184, h: 182 },
  'burst-hot': { file: 'decals/sticker-burst-02.webp', w: 160, h: 175 },
  'burst-wow': { file: 'decals/sticker-burst-03.webp', w: 179, h: 184 },
  'ticker-coin': { file: 'ticker/coin.webp', w: 74, h: 59 },
  'ticker-eye': { file: 'ticker/eye.webp', w: 89, h: 36 },
  'ticker-heart': { file: 'ticker/heart.webp', w: 93, h: 70 },
} satisfies Record<string, AssetMeta>;
export type StickerName = keyof typeof STICKER;

/** Washi-tape corner decals, keyed by the corner they pin. */
export const TAPE = {
  tl: { file: 'decals/tape-corner-tl.webp', w: 167, h: 162 },
  tr: { file: 'decals/tape-corner-tr.webp', w: 167, h: 163 },
  bl: { file: 'decals/tape-corner-bl.webp', w: 164, h: 171 },
  br: { file: 'decals/tape-corner-br.webp', w: 160, h: 169 },
} satisfies Record<string, AssetMeta>;
export type TapeCorner = keyof typeof TAPE;

/** Static brand + chrome assets. */
export const BRAND = {
  cursor: { file: 'cursors/sticker-default.png', w: 28, h: 27 },
} satisfies Record<string, AssetMeta>;
export type BrandName = keyof typeof BRAND;
