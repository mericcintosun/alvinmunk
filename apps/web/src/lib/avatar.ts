/**
 * Avatar identity. A profile's face is one of the hand-drawn portrait stickers. The
 * choice is stored on the Profile and published on-chain (registry `set_meta`, packed by
 * `encodeAvatar`) so every viewer sees it; absent a choice, a DETERMINISTIC default is
 * derived from the address so the same wallet always shows the same face — on the
 * dashboard AND in the (node-runtime) OG card. The geometric Crest remains the fallback identity for
 * addresses we render without a face (leaderboard rows, dev surfaces).
 */
import { artSeed } from '@alvinmunk/shared';
import { asset } from './assets';

export const FACE_IDS = ['face-01', 'face-02', 'face-03', 'face-04', 'face-05'] as const;
export type FaceId = (typeof FACE_IDS)[number];

/** Intrinsic sizes of the face stickers (for no-upscale rendering). */
export const FACE_META: Record<FaceId, { w: number; h: number }> = {
  'face-01': { w: 148, h: 189 },
  'face-02': { w: 167, h: 188 },
  'face-03': { w: 145, h: 187 },
  'face-04': { w: 127, h: 192 },
  'face-05': { w: 153, h: 187 },
};

/** A pre-made face sticker choice. */
export interface FaceAvatar {
  kind: 'face';
  id: FaceId;
}

/**
 * A remixed avatar from the layered portrait kit. Each field is a 1-based index into its
 * category folder (bg/acc optional). Anchors below were calibrated against the kit's
 * reference composite so any combination stacks into a coherent face.
 */
export interface KitAvatar {
  kind: 'kit';
  skin: number; // 1..6
  hair: number; // 1..10
  eyes: number; // 1..10
  mouth: number; // 1..9
  acc: number | null; // 1..13
  bg: number | null; // 1..5
}

/** What a profile stores about its face. Versioned by `kind` for safe migration. */
export type AvatarConfig = FaceAvatar | KitAvatar;

/** Option counts per portrait-kit category (folder file counts). */
export const KIT_COUNTS = { skin: 6, hair: 10, eyes: 10, mouth: 9, acc: 13, bg: 5 } as const;
export type KitCategory = keyof typeof KIT_COUNTS;

/**
 * Layer manifest — geometry on a 200×216 reference canvas (gravity = top-center). The
 * <KitFace> renderer scales these by size/200, so on-screen sizing is a single multiply.
 * Order = z-order (bg behind … accessory on top). Calibrated visually; do not re-tune
 * casually (it keeps every skin/eyes/hair/mouth/acc combination aligned).
 */
export const KIT_LAYERS: { cat: KitCategory; field: keyof KitAvatar; wRef: number; topRef: number; cover?: boolean }[] = [
  { cat: 'bg', field: 'bg', wRef: 200, topRef: 0, cover: true },
  { cat: 'skin', field: 'skin', wRef: 158, topRef: 40 },
  { cat: 'hair', field: 'hair', wRef: 168, topRef: 20 },
  { cat: 'eyes', field: 'eyes', wRef: 96, topRef: 98 },
  { cat: 'mouth', field: 'mouth', wRef: 60, topRef: 138 },
  { cat: 'acc', field: 'acc', wRef: 110, topRef: 8 },
];
export const KIT_REF_W = 200;
export const KIT_REF_H = 216;

const DIR: Record<KitCategory, string> = {
  skin: 'skin',
  hair: 'hair',
  eyes: 'eyes',
  mouth: 'mouth',
  acc: 'accessory',
  bg: 'bg',
};

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Repo-relative file of one portrait-kit layer piece (for the OG node fs reader). */
export function kitFile(cat: KitCategory, n: number): string {
  return `portrait-kit/${DIR[cat]}/${pad2(n)}.png`;
}

/** Public src for one portrait-kit layer piece (1-based index). */
export function kitSrc(cat: KitCategory, n: number): string {
  return asset(kitFile(cat, n));
}

/** A deterministic starter kit from an address — every field seeded so it varies. */
export function defaultKit(address: string): KitAvatar {
  let h = artSeed(address || 'profile');
  const next = (mod: number) => {
    h = (Math.imul(h, 1103515245) + 12345) >>> 0;
    return (h % mod) + 1;
  };
  return {
    kind: 'kit',
    skin: next(KIT_COUNTS.skin),
    hair: next(KIT_COUNTS.hair),
    eyes: next(KIT_COUNTS.eyes),
    mouth: next(KIT_COUNTS.mouth),
    acc: h % 2 === 0 ? next(KIT_COUNTS.acc) : null,
    bg: next(KIT_COUNTS.bg),
  };
}

export function isFaceId(id: string): id is FaceId {
  return (FACE_IDS as readonly string[]).includes(id);
}

/** Public src for a face sticker. */
export function faceSrc(id: FaceId): string {
  return asset(`stickers/${id}.png`);
}

/** Repo-relative file (for the OG node fs reader). */
export function faceFile(id: FaceId): string {
  return `stickers/${id}.png`;
}

/** The deterministic face for an address with no explicit choice. */
export function defaultAvatarId(address: string): FaceId {
  return FACE_IDS[artSeed(address || 'profile') % FACE_IDS.length];
}

/** Resolve the face to render: explicit valid choice wins, else the deterministic default. */
export function resolveAvatarId(avatar: AvatarConfig | undefined, address: string): FaceId {
  if (avatar?.kind === 'face' && isFaceId(avatar.id)) return avatar.id;
  return defaultAvatarId(address);
}

/** Is `cfg` a kit whose every index points at a shipped layer (acc/bg may be none)? */
export function isValidKit(cfg: KitAvatar): boolean {
  const inRange = (n: unknown, max: number) =>
    Number.isInteger(n) && (n as number) >= 1 && (n as number) <= max;
  return (
    inRange(cfg.skin, KIT_COUNTS.skin) &&
    inRange(cfg.hair, KIT_COUNTS.hair) &&
    inRange(cfg.eyes, KIT_COUNTS.eyes) &&
    inRange(cfg.mouth, KIT_COUNTS.mouth) &&
    (cfg.acc === null || inRange(cfg.acc, KIT_COUNTS.acc)) &&
    (cfg.bg === null || inRange(cfg.bg, KIT_COUNTS.bg))
  );
}

/*
 * On-chain packing for the registry's `set_meta(avatar: u64)` — one byte per field, every
 * other byte zero (the contract rejects anything else, so keep FACE_IDS / KIT_COUNTS in
 * step with its FACE_COUNT / KIT_* constants):
 *   byte 7: kind — 0 = face, 1 = kit
 *   face:   byte 0 = face number (1-based: face-01 → 1)
 *   kit:    bytes 5..0 = skin, hair, eyes, mouth, acc, bg (1-based; acc/bg 0 = none)
 * e.g. face-03 → 0x03, kit {3,7,5,4,9,2} → 0x0100030705040902.
 */
const KIND_FACE = 0n;
const KIND_KIT = 1n;
const KIT_FIELDS = ['skin', 'hair', 'eyes', 'mouth', 'acc', 'bg'] as const; // bytes 5..0
const U64_MAX = (1n << 64n) - 1n;

/** Pack a face for `set_meta`. Throws on a face id or kit index the app doesn't ship. */
export function encodeAvatar(cfg: AvatarConfig): bigint {
  if (cfg.kind === 'face') {
    const n = FACE_IDS.indexOf(cfg.id);
    if (n < 0) throw new Error(`unknown face id: ${String(cfg.id)}`);
    return (KIND_FACE << 56n) | BigInt(n + 1);
  }
  if (!isValidKit(cfg)) throw new Error('kit avatar index out of range');
  return KIT_FIELDS.reduce(
    (v, field, i) => v | (BigInt(cfg[field] ?? 0) << BigInt(8 * (5 - i))),
    KIND_KIT << 56n,
  );
}

/**
 * Unpack an on-chain `avatar`. Returns undefined for anything this build can't render (a
 * kind or index from a newer contract, a malformed value), so callers fall back to the
 * deterministic default face.
 */
export function decodeAvatar(packed: bigint): AvatarConfig | undefined {
  if (typeof packed !== 'bigint' || packed < 0n || packed > U64_MAX) return undefined;
  const byte = (i: number) => Number((packed >> BigInt(8 * i)) & 0xffn);
  const kind = packed >> 56n;
  if (kind === KIND_FACE) {
    const n = byte(0);
    if (packed >> 8n !== 0n || n < 1 || n > FACE_IDS.length) return undefined;
    return { kind: 'face', id: FACE_IDS[n - 1] };
  }
  if (kind === KIND_KIT && byte(6) === 0) {
    const cfg: KitAvatar = {
      kind: 'kit',
      skin: byte(5),
      hair: byte(4),
      eyes: byte(3),
      mouth: byte(2),
      acc: byte(1) || null,
      bg: byte(0) || null,
    };
    return isValidKit(cfg) ? cfg : undefined;
  }
  return undefined;
}
