// @vitest-environment node
/**
 * Every file under public/ is deployed, so each one must be referenced by the app (#506).
 * A file counts as referenced when its public path appears in non-test source (src/**,
 * public/sw.js, next.config.mjs), or when it belongs to a family the code builds at runtime
 * (the face stickers and the portrait kit, see avatar.ts). A failure lists the orphans.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND, STATE, STICKER, TAPE } from './assets';
import { FACE_IDS, KIT_COUNTS, faceFile, kitFile, type KitCategory } from './avatar';

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const publicDir = join(webDir, 'public');

/**
 * Unreferenced files still waiting to be deleted for #506. Delete a file, then drop it from
 * this list; a file that is gone but still listed fails the test so the list stays honest.
 */
const PENDING_REMOVAL: readonly string[] = [];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const abs = join(dir, name);
    return statSync(abs).isDirectory() ? walk(abs) : [abs];
  });
}

/** POSIX path relative to public/, e.g. `assets/stickers/star-01.png`. */
const publicPath = (abs: string) => relative(publicDir, abs).split(sep).join('/');

const sourceText = [
  ...walk(join(webDir, 'src')).filter((f) => /\.(ts|tsx|css|mjs)$/.test(f) && !/\.test\.tsx?$/.test(f)),
  join(publicDir, 'sw.js'),
  join(webDir, 'next.config.mjs'),
]
  .map((f) => readFileSync(f, 'utf-8'))
  .join('\n');

/** Asset paths (relative to public/assets) the code composes at runtime instead of spelling out. */
const dynamicAssets = new Set<string>([
  ...FACE_IDS.map(faceFile),
  ...(Object.keys(KIT_COUNTS) as KitCategory[]).flatMap((cat) =>
    Array.from({ length: KIT_COUNTS[cat] }, (_, i) => kitFile(cat, i + 1)),
  ),
]);

function isReferenced(path: string): boolean {
  if (sourceText.includes(`/${path}`)) return true;
  if (!path.startsWith('assets/')) return false;
  const underAssets = path.slice('assets/'.length);
  return dynamicAssets.has(underAssets) || sourceText.includes(underAssets);
}

describe('public/ assets', () => {
  const files = walk(publicDir).map(publicPath).sort();

  it('has no unreferenced files', () => {
    const orphans = files.filter((f) => !isReferenced(f) && !PENDING_REMOVAL.includes(f));
    expect(orphans).toEqual([]);
  });

  it('lists only files that still exist and are still unreferenced as pending removal', () => {
    for (const f of PENDING_REMOVAL) {
      expect(files, `${f} was deleted: drop it from PENDING_REMOVAL`).toContain(f);
      expect(isReferenced(f), `${f} is referenced again: drop it from PENDING_REMOVAL`).toBe(false);
    }
  });

  it('every registry, face and portrait-kit asset exists on disk', () => {
    const registry = [...Object.values(STATE), ...Object.values(STICKER), ...Object.values(TAPE), ...Object.values(BRAND)];
    const missing = [...registry.map((m) => m.file), ...dynamicAssets].filter(
      (f) => !existsSync(join(publicDir, 'assets', f)),
    );
    expect(missing).toEqual([]);
  });
});
