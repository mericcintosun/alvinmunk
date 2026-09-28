import { describe, it, expect } from 'vitest';
import {
  FACE_IDS,
  defaultAvatarId,
  resolveAvatarId,
  isFaceId,
  faceSrc,
  faceFile,
  defaultKit,
  kitSrc,
  KIT_COUNTS,
  KIT_LAYERS,
  encodeAvatar,
  decodeAvatar,
  isValidKit,
  type AvatarConfig,
  type KitAvatar,
} from './avatar';

const A = 'G'.padEnd(56, 'A');
const B = 'G'.padEnd(56, 'B');

describe('defaultAvatarId', () => {
  it('is deterministic for the same address', () => {
    expect(defaultAvatarId(A)).toBe(defaultAvatarId(A));
  });

  it('always resolves to a real face id', () => {
    for (const addr of [A, B, '', 'short', 'G'.padEnd(56, 'Z')]) {
      expect(FACE_IDS).toContain(defaultAvatarId(addr));
    }
  });

  it('spreads addresses across the face set', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(defaultAvatarId(`G${i}`.padEnd(56, 'X')));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('resolveAvatarId', () => {
  it('honors a valid explicit choice', () => {
    expect(resolveAvatarId({ kind: 'face', id: 'face-04' }, A)).toBe('face-04');
  });

  it('falls back to the deterministic default when unset', () => {
    expect(resolveAvatarId(undefined, A)).toBe(defaultAvatarId(A));
  });

  it('ignores an invalid stored id', () => {
    expect(resolveAvatarId({ kind: 'face', id: 'face-99' as never }, A)).toBe(defaultAvatarId(A));
  });
});

describe('face helpers', () => {
  it('validates face ids', () => {
    expect(isFaceId('face-01')).toBe(true);
    expect(isFaceId('nope')).toBe(false);
  });

  it('builds public src and repo-relative file paths', () => {
    expect(faceSrc('face-02')).toBe('/assets/stickers/face-02.png');
    expect(faceFile('face-02')).toBe('stickers/face-02.png');
  });
});

describe('portrait-kit', () => {
  it('defaultKit is deterministic and within bounds', () => {
    const k = defaultKit(A);
    expect(defaultKit(A)).toEqual(k);
    expect(k.skin).toBeGreaterThanOrEqual(1);
    expect(k.skin).toBeLessThanOrEqual(KIT_COUNTS.skin);
    expect(k.eyes).toBeLessThanOrEqual(KIT_COUNTS.eyes);
    expect(k.acc === null || (k.acc >= 1 && k.acc <= KIT_COUNTS.acc)).toBe(true);
  });

  it('kitSrc zero-pads the index and points into portrait-kit', () => {
    expect(kitSrc('skin', 3)).toBe('/assets/portrait-kit/skin/03.png');
    expect(kitSrc('acc', 12)).toBe('/assets/portrait-kit/accessory/12.png');
    expect(kitSrc('bg', 1)).toBe('/assets/portrait-kit/bg/01.png');
  });

  it('every layer maps to a real kit field', () => {
    const fields = new Set(['skin', 'hair', 'eyes', 'mouth', 'acc', 'bg']);
    for (const layer of KIT_LAYERS) {
      expect(fields.has(layer.field as string)).toBe(true);
      expect(layer.wRef).toBeGreaterThan(0);
    }
  });
});

describe('encodeAvatar / decodeAvatar', () => {
  // Golden packings, shared with contracts/registry/src/test.rs so the two stay in step.
  const kit = (
    skin: number,
    hair: number,
    eyes: number,
    mouth: number,
    acc: number | null,
    bg: number | null,
  ): KitAvatar => ({
    kind: 'kit',
    skin,
    hair,
    eyes,
    mouth,
    acc,
    bg,
  });
  const GOLDEN: [AvatarConfig, bigint][] = [
    [{ kind: 'face', id: 'face-03' }, 0x0000_0000_0000_0003n],
    [kit(3, 7, 5, 4, 9, 2), 0x0100_0307_0504_0902n],
    [kit(6, 10, 10, 9, 13, 5), 0x0100_060a_0a09_0d05n],
    [kit(1, 1, 1, 1, null, null), 0x0100_0101_0101_0000n],
  ];

  it('packs to the same u64s the registry contract tests use', () => {
    for (const [cfg, packed] of GOLDEN) {
      expect(encodeAvatar(cfg)).toBe(packed);
      expect(decodeAvatar(packed)).toEqual(cfg);
    }
  });

  it('round-trips every face id, numbered from 1', () => {
    FACE_IDS.forEach((id, i) => {
      expect(encodeAvatar({ kind: 'face', id })).toBe(BigInt(i + 1));
      expect(decodeAvatar(encodeAvatar({ kind: 'face', id }))).toEqual({ kind: 'face', id });
    });
  });

  it('round-trips every value of every kit field', () => {
    const base = kit(1, 1, 1, 1, null, null);
    for (const field of ['skin', 'hair', 'eyes', 'mouth', 'acc', 'bg'] as const) {
      const values: (number | null)[] = Array.from({ length: KIT_COUNTS[field] }, (_, i) => i + 1);
      if (field === 'acc' || field === 'bg') values.push(null);
      for (const v of values) {
        const cfg = { ...base, [field]: v } as KitAvatar;
        expect(decodeAvatar(encodeAvatar(cfg)), `${field}=${v}`).toEqual(cfg);
      }
    }
  });

  it('gives each field its own byte', () => {
    expect(encodeAvatar(kit(1, 1, 1, 1, null, 5)) & 0xffn).toBe(5n);
    expect((encodeAvatar(kit(1, 1, 1, 1, 13, null)) >> 8n) & 0xffn).toBe(13n);
    expect((encodeAvatar(kit(1, 1, 1, 9, null, null)) >> 16n) & 0xffn).toBe(9n);
    expect((encodeAvatar(kit(1, 1, 10, 1, null, null)) >> 24n) & 0xffn).toBe(10n);
    expect((encodeAvatar(kit(1, 10, 1, 1, null, null)) >> 32n) & 0xffn).toBe(10n);
    expect((encodeAvatar(kit(6, 1, 1, 1, null, null)) >> 40n) & 0xffn).toBe(6n);
    expect(encodeAvatar(kit(6, 1, 1, 1, null, null)) >> 56n).toBe(1n);
  });

  it('refuses to pack a face or kit index the app does not ship', () => {
    expect(() => encodeAvatar({ kind: 'face', id: 'face-99' as never })).toThrow();
    for (const bad of [
      kit(0, 1, 1, 1, null, null),
      kit(7, 1, 1, 1, null, null),
      kit(1, 11, 1, 1, null, null),
      kit(1, 1, 11, 1, null, null),
      kit(1, 1, 1, 10, null, null),
      kit(1, 1, 1, 1, 14, null),
      kit(1, 1, 1, 1, null, 6),
      kit(1, 1, 1, 1, 0, null),
      kit(1.5, 1, 1, 1, null, null),
    ]) {
      expect(isValidKit(bad)).toBe(false);
      expect(() => encodeAvatar(bad), JSON.stringify(bad)).toThrow();
    }
  });

  it('decodes anything the contract would reject (or a newer build wrote) as undefined', () => {
    // same list as the registry's out_of_range_avatars_revert test
    const invalid = [
      0x0000_0000_0000_0000n,
      0x0000_0000_0000_0006n,
      0x0000_0000_0000_0103n,
      0x8000_0000_0000_0003n,
      0x0200_0101_0101_0101n,
      0xff00_0101_0101_0101n,
      0x0100_0001_0101_0101n,
      0x0100_0701_0101_0101n,
      0x0100_010b_0101_0101n,
      0x0100_0101_0b01_0101n,
      0x0100_0101_010a_0101n,
      0x0100_0101_0101_0e01n,
      0x0100_0101_0101_0106n,
      0x0100_0000_0101_0101n,
      0x0101_0101_0101_0101n,
      (1n << 64n) - 1n,
      -1n,
      1n << 64n,
    ];
    for (const v of invalid) expect(decodeAvatar(v), v.toString(16)).toBeUndefined();
    expect(decodeAvatar(3 as never)).toBeUndefined(); // a number, not a u64 bigint
  });
});
