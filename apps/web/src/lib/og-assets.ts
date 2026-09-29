/**
 * OG-image asset loader. Satori (next/og) can't fetch `/assets/...` URLs reliably, so for
 * the node-runtime OG routes we read the PNG off disk and inline it as a base64 data-URI.
 * Memoized per process — OG cards are rendered often and the files never change at runtime.
 */
import fs from 'node:fs';
import path from 'node:path';

const cache = new Map<string, OgPng>();
const fontCache = new Map<string, ArrayBuffer>();

/** An inlined PNG plus its intrinsic size (Satori needs explicit image dimensions). */
export interface OgPng {
  uri: string;
  w: number;
  h: number;
}

/** Inline a public/assets PNG and read its size from the IHDR chunk (node runtime only). */
export function loadPng(relPath: string): OgPng {
  const key = relPath.replace(/^\/+/, '');
  const hit = cache.get(key);
  if (hit) return hit;
  const abs = path.join(process.cwd(), 'public', 'assets', key);
  const buf = fs.readFileSync(abs);
  // 8-byte signature, then IHDR: length(4) type(4) width(4) height(4), big-endian
  const png = {
    uri: `data:image/png;base64,${buf.toString('base64')}`,
    w: buf.readUInt32BE(16),
    h: buf.readUInt32BE(20),
  };
  cache.set(key, png);
  return png;
}

/** Inline a public/assets PNG as a `data:image/png;base64,…` URI (node runtime only). */
export function loadPngDataUri(relPath: string): string {
  return loadPng(relPath).uri;
}

/** Load a font file from public/assets as an ArrayBuffer for Satori (node runtime only). */
export function loadFont(relPath: string): ArrayBuffer {
  const key = relPath.replace(/^\/+/, '');
  const hit = fontCache.get(key);
  if (hit) return hit;
  const abs = path.join(process.cwd(), 'public', 'assets', key);
  const buffer = fs.readFileSync(abs);
  fontCache.set(key, buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  return fontCache.get(key)!;
}
