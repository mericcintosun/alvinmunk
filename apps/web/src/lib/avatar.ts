/**
 * Avatar identity. A profile's face is one of the hand-drawn portrait stickers. The
 * choice is stored on the Profile; absent a choice, a DETERMINISTIC default is derived
 * from the address so the same wallet always shows the same face — on the dashboard AND
 * in the (node-runtime) OG card. The geometric Crest remains the fallback identity for
 * addresses we render without a face (leaderboard rows, dev surfaces).
 */
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

/** Public src for one portrait-kit layer piece (1-based index). */
export function kitSrc(cat: KitCategory, n: number): string {
  return asset(`portrait-kit/${DIR[cat]}/${pad2(n)}.png`);
}

/** A deterministic starter kit from an address — every field seeded so it varies. */
export function defaultKit(address: string): KitAvatar {
  let h = seedFromAddress(address || 'profile');
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

/** Stable FNV-1a hash of an address (mirrors addrHue / crest determinism). */
function seedFromAddress(address: string): number {
  let h = 2166136261;
  for (let i = 0; i < address.length; i++) {
    h ^= address.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The deterministic face for an address with no explicit choice. */
export function defaultAvatarId(address: string): FaceId {
  return FACE_IDS[seedFromAddress(address || 'profile') % FACE_IDS.length];
}

/** Resolve the face to render: explicit valid choice wins, else the deterministic default. */
export function resolveAvatarId(avatar: AvatarConfig | undefined, address: string): FaceId {
  if (avatar?.kind === 'face' && isFaceId(avatar.id)) return avatar.id;
  return defaultAvatarId(address);
}
