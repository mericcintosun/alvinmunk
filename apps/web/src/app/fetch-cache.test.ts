import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Next 14 caches `fetch` calls made while rendering a server segment in the Data Cache, and the
 * Stellar SDK reads the chain through fetch (JSON-RPC POSTs). `dynamic = 'force-dynamic'` does
 * not turn that off for a GET route handler, so without an explicit opt-out a segment that
 * reads the chain keeps serving the first answer it ever got — /api/health reported the same
 * ledger for hours. Every server segment that renders chain data must opt out.
 */
const APP = dirname(fileURLToPath(import.meta.url));

// Modules whose exports read the chain (directly or through the SDK).
const CHAIN_READERS =
  /from '(@stellar\/stellar-sdk|@\/lib\/(stellar|reputation|registry|constellation|og-card|contracts|gate|rewards|events))'/;
// Server segments that render per request: GET handlers, metadata image routes, async pages
// and layouts. POST-only handlers are never cached by Next, so they don't need the opt-out.
const RENDERS = /export (async function GET|const GET)|export default async function/;
const OPTS_OUT = /export const fetchCache = '(default-no-store|force-no-store|only-no-store)'|export const revalidate = 0\b/;

const segments = (readdirSync(APP, { recursive: true }) as string[])
  .filter((f) => /(^|\/)(route\.ts|(page|layout|opengraph-image|twitter-image)\.tsx)$/.test(f))
  .map((file) => ({ file, text: readFileSync(join(APP, file), 'utf8') }))
  .filter(({ text }) => !/^\s*['"]use client['"]/.test(text));

describe('server segments that read the chain opt out of the fetch cache', () => {
  const readers = segments.filter(({ text }) => CHAIN_READERS.test(text) && RENDERS.test(text));

  it('finds the known chain-reading segments (so the scan itself is not broken)', () => {
    const files = readers.map((s) => s.file).sort();
    for (const known of [
      'api/cron/notify/route.ts',
      'api/health/route.ts',
      'api/stats/route.ts',
      'claim/[id]/opengraph-image.tsx',
      'score/[address]/page.tsx',
      'u/[handle]/opengraph-image.tsx',
      'v/[handle]/opengraph-image.tsx',
    ]) {
      expect(files).toContain(known);
    }
  });

  it.each(readers.map((s) => [s.file, s.text]))('%s declares fetchCache no-store or revalidate = 0', (_file, text) => {
    expect(text).toMatch(OPTS_OUT);
  });
});
