/**
 * OG-image asset loader. Satori (next/og) can't fetch `/assets/...` URLs reliably, so for
 * the node-runtime OG routes we read the PNG off disk and inline it as a base64 data-URI.
 * Memoized per process — OG cards are rendered often and the files never change at runtime.
 */
import fs from 'node:fs';
import path from 'node:path';

const cache = new Map<string, string>();

/** Inline a public/assets PNG as a `data:image/png;base64,…` URI (node runtime only). */
export function loadPngDataUri(relPath: string): string {
  const key = relPath.replace(/^\/+/, '');
  const hit = cache.get(key);
  if (hit) return hit;
  const abs = path.join(process.cwd(), 'public', 'assets', key);
  const uri = `data:image/png;base64,${fs.readFileSync(abs).toString('base64')}`;
  cache.set(key, uri);
  return uri;
}
