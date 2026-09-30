import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Every non-test source file under src/. */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

/** Declarations of the first `selector { … }` block, comments stripped. */
function block(css: string, selector: ':root' | ':root.light'): Map<string, string> {
  const escaped = selector.replace('.', '\\.');
  const body = new RegExp(`(^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[2];
  if (body === undefined) throw new Error(`no ${selector} block`);
  const decls = new Map<string, string>();
  for (const [, prop, value] of body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) {
    decls.set(prop, value.trim());
  }
  return decls;
}

type Rgb = [number, number, number];

/** `265 100% 66%` (or `265 100% 66% / 0.4`) → sRGB 0–1. */
function toRgb(value: string): Rgb {
  const [h, s, l] = value
    .replace(/\/\s*[\d.]+\s*$/, '')
    .trim()
    .split(/\s+/)
    .map((part) => Number(part.replace('%', '')));
  if ([h, s, l].some(Number.isNaN)) throw new Error(`bad hsl triple: ${value}`);
  const sat = s / 100;
  const lig = l / 100;
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lig - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg: Rgb, bg: Rgb): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const globals = readFileSync(join(srcDir, 'app/globals.css'), 'utf8');
const THEMES = { dark: block(globals, ':root'), light: block(globals, ':root.light') };

/** Declarations of the `:focus-visible` rule inside `@layer base`. */
function focusRule(css: string): Map<string, string> {
  const layer = /@layer base\s*\{([\s\S]*?)\n\}/.exec(css)?.[1];
  const body = layer && /:focus-visible\s*\{([^}]*)\}/.exec(layer)?.[1];
  if (body === undefined) throw new Error('no :focus-visible rule in @layer base');
  const decls = new Map<string, string>();
  for (const [, prop, value] of body.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) decls.set(prop, value.trim());
  return decls;
}

describe('focus ring', () => {
  const rule = focusRule(globals);

  it('globals.css applies one ring globally, in @layer base', () => {
    expect(rule.get('outline')).toBe('2px solid hsl(var(--ring))');
    expect(rule.get('outline-offset')).toBe('2px');
  });

  it('rests the ring colour and geometry on every element, so focus only switches it on', () => {
    // Otherwise a `transition-all` control animates the ring in from the UA default outline
    // (3px, currentColor, no offset) on every focus.
    const layer = /@layer base\s*\{([\s\S]*?)\n\}/.exec(globals)![1];
    const body = /(?:^|\n)\s*\*\s*\{([^}]*)\}/.exec(layer)?.[1];
    expect(body, '* rule in @layer base').toBeDefined();
    const decls = new Map<string, string>();
    for (const [, prop, value] of body!.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) {
      decls.set(prop, value.trim());
    }
    expect(decls.get('outline-color')).toBe('hsl(var(--ring))');
    expect(decls.get('outline-width')).toBe(rule.get('outline')!.split(' ')[0]);
    expect(decls.get('outline-offset')).toBe(rule.get('outline-offset'));
  });

  for (const [theme, tokens] of Object.entries(THEMES)) {
    it(`the ${theme} ring clears 3:1 against every surface it can sit on`, () => {
      const ring = toRgb(tokens.get('--ring')!);
      for (const surface of ['--background', '--surface', '--surface-2', '--card', '--muted']) {
        expect(contrast(ring, toRgb(tokens.get(surface)!)), surface).toBeGreaterThanOrEqual(3);
      }
    });
  }

  it('no component hand-picks a focus ring colour', () => {
    const offenders: string[] = [];
    for (const file of walk(srcDir)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          // `ring-ring` (the token) is fine; `ring-primary`, `ring-lime`, … are not.
          if (/focus-visible:ring-(?!ring\b)[\w-]+/.test(line)) {
            offenders.push(`${file.replace(srcDir, '')}:${i + 1}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  it('no component suppresses the global ring with a bare outline-none', () => {
    const offenders: string[] = [];
    for (const file of walk(srcDir)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          // A deliberately scoped `focus-visible:outline-none` is the one allowed opt-out.
          const bare = line.replace(/focus-visible:outline-none/g, '').match(/(?<![\w:-])outline-none/);
          if (bare) offenders.push(`${file.replace(srcDir, '')}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});