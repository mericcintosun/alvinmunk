import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import tailwindConfig from '../../tailwind.config';

type FontOptions = { subsets?: string[]; preload?: boolean; variable?: string };
const { fontCalls } = vi.hoisted(() => ({ fontCalls: [] as { family: string; options: FontOptions }[] }));
vi.mock('next/font/google', () => {
  const family = (name: string) => (options: FontOptions) => {
    fontCalls.push({ family: name, options });
    return { className: name, variable: options.variable ?? '', style: {} };
  };
  return {
    Bricolage_Grotesque: family('Bricolage_Grotesque'),
    Inter: family('Inter'),
    JetBrains_Mono: family('JetBrains_Mono'),
  };
});

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
const globalsCss = read('app/globals.css');
const tokensDoc = read('../../../docs/product/DESIGN_SYSTEM_TOKENS.md');

// Every UI source file. The OG image renderer draws on a fixed 1200×630 canvas with its own
// pixel sizes, so it is the one allowed exception.
const sources = (readdirSync(SRC, { recursive: true }) as string[])
  .filter((f) => /\.(tsx?|css)$/.test(f) && !/\.test\.tsx?$/.test(f) && !/og-card/.test(f))
  .map((f) => ({ file: f, text: read(f) }));

function offenders(re: RegExp) {
  return sources.flatMap(({ file, text }) =>
    text.split('\n').flatMap((line, i) => (re.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : [])),
  );
}

/** Font size in px for a CSS length (rem = 16px). */
function px(len: string): number {
  const m = /^([\d.]+)(px|rem)$/.exec(len.trim());
  if (!m) throw new Error(`not a px/rem length: ${len}`);
  return Number(m[1]) * (m[2] === 'rem' ? 16 : 1);
}

/** Body of the first `@layer <name> { … }` block, braces matched. */
function layer(css: string, name: string): string {
  const start = css.indexOf(`@layer ${name} {`);
  if (start < 0) throw new Error(`no @layer ${name}`);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error(`unclosed @layer ${name}`);
}

/** Declarations of the rule whose selector list is exactly `selector`. */
function rule(css: string, selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/,\s*/g, ',\\s*');
  // the selector must start the rule (after `{`, `}` and comments), not end a longer list
  const body = new RegExp(`(?:^|[{}])\\s*(?:/\\*[\\s\\S]*?\\*/\\s*)*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1];
  if (body === undefined) throw new Error(`no rule for ${selector}`);
  return Object.fromEntries(
    [...body.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map(([, k, v]) => [
      k,
      v.trim(),
    ]),
  );
}

describe('type scale', () => {
  it('text-2xs is the 11px floor of the scale', () => {
    const sizes = tailwindConfig.theme?.extend?.fontSize as Record<string, [string, { lineHeight: string }]>;
    expect(sizes['2xs']).toEqual(['0.6875rem', { lineHeight: '1rem' }]);
    for (const [name, [size]] of Object.entries(sizes)) {
      expect(px(size), `fontSize.${name}`).toBeGreaterThanOrEqual(11);
    }
  });

  it('no arbitrary text-[…] size is left outside og-card', () => {
    expect(offenders(/\btext-\[\d[\d.]*(px|rem|em)\]/)).toEqual([]);
  });

  it('no CSS or inline font size goes below 11px', () => {
    const tooSmall: string[] = [];
    for (const { file, text } of sources) {
      for (const [, len] of text.matchAll(/font-size:\s*([\d.]+(?:px|rem))\s*;/g)) {
        if (px(len) < 11) tooSmall.push(`${file}: font-size ${len}`);
      }
      for (const [, n] of text.matchAll(/fontSize:\s*['"]?(\d+(?:\.\d+)?)(?:px)?['"]?/g)) {
        if (Number(n) < 11) tooSmall.push(`${file}: fontSize ${n}`);
      }
    }
    expect(tooSmall).toEqual([]);
  });

  it('uppercase kickers use the eyebrow utilities, never a hand-rolled letter-spacing', () => {
    expect(offenders(/tracking-\[[^\]]+\]/)).toEqual([]);
    const components = layer(globalsCss, 'components');
    const eyebrow = rule(components, '.eyebrow, .eyebrow-mono');
    expect(eyebrow).toMatchObject({
      'font-size': '0.6875rem',
      'letter-spacing': '0.22em',
      'text-transform': 'uppercase',
    });
    expect(px(eyebrow['font-size'])).toBeGreaterThanOrEqual(11);
    expect(rule(components, '.eyebrow-mono')['font-family']).toBe('var(--font-mono), monospace');
    // components layer, so `eyebrow-mono text-primary/80` really is primary: a utility-layer
    // eyebrow would be emitted after the colour utilities and win.
    expect(layer(globalsCss, 'utilities')).not.toMatch(/\.eyebrow/);
  });

  it('DESIGN_SYSTEM_TOKENS.md documents the 2xs floor, the eyebrows and the latin-ext preload', () => {
    expect(tokensDoc).toMatch(/\| `2xs` \| 0\.6875rem \/ 1rem \|/);
    expect(tokensDoc).toMatch(/`eyebrow` \/ `eyebrow-mono`/);
    expect(tokensDoc).toMatch(/`latin` \+ `latin-ext`/);
  });
});

describe('brand fonts', () => {
  it('every family preloads latin and latin-ext', async () => {
    await import('@/lib/fonts');
    expect(fontCalls.map((c) => c.family).sort()).toEqual(['Bricolage_Grotesque', 'Inter', 'JetBrains_Mono']);
    for (const { family, options } of fontCalls) {
      expect(options.subsets, family).toEqual(expect.arrayContaining(['latin', 'latin-ext']));
      expect(options.preload, family).not.toBe(false);
    }
  });

  it('latin + latin-ext cover every letter in the Turkish messages, and ğ ş İ need latin-ext', () => {
    const tr = read('../messages/tr.json');
    // Google Fonts' latin subset is U+0000–00FF (plus U+0131 ı); latin-ext adds U+0100–024F.
    const inLatin = (cp: number) => cp <= 0xff || cp === 0x131;
    const inLatinExt = (cp: number) => cp >= 0x100 && cp <= 0x24f;
    const letters = new Set([...tr].filter((ch) => /\p{L}/u.test(ch)));
    const uncovered = [...letters].filter((ch) => {
      const cp = ch.codePointAt(0)!;
      return !inLatin(cp) && !inLatinExt(cp);
    });
    expect(uncovered).toEqual([]);
    for (const ch of ['ğ', 'ş', 'İ']) {
      expect(letters.has(ch), ch).toBe(true);
      expect(inLatin(ch.codePointAt(0)!), ch).toBe(false);
    }
  });
});
