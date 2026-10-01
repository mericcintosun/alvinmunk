import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import tailwindConfig from '../../tailwind.config';
import { Badge } from '@/components/ui/badge';

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

function toRgb(value: string): Rgb {
  const m = /^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/.exec(value);
  if (!m) throw new Error(`bad hsl triple: ${value}`);
  const [h, s, l] = [Number(m[1]), Number(m[2]) / 100, Number(m[3]) / 100];
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg: Rgb, bg: Rgb): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `fg` at `alpha` over `bg` (a translucent tint such as `bg-warning/15`). */
function over(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  return fg.map((v, i) => v * alpha + bg[i] * (1 - alpha)) as Rgb;
}

const globals = readFileSync(join(srcDir, 'app/globals.css'), 'utf8');
const THEMES = { dark: block(globals, ':root'), light: block(globals, ':root.light') };
const SURFACES = ['--background', '--surface', '--surface-2', '--card', '--muted'];

describe('secondary text contrast', () => {
  for (const [theme, tokens] of Object.entries(THEMES)) {
    const color = (token: string) => toRgb(tokens.get(token)!);

    it(`full-strength muted-foreground clears AA on every ${theme} surface`, () => {
      for (const surface of SURFACES) {
        expect(
          contrast(color('--muted-foreground'), color(surface)),
          surface,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  // No fade is safe for text: /80 still clears AA on dark (5.3:1) but not on light (3.85:1).
  it('only decorative icons fade muted-foreground', () => {
    const offenders: string[] = [];
    for (const file of walk(srcDir)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          // Icons are sized with `size-*`; everything else here is text.
          if (/text-muted-foreground\/\d+/.test(line) && !/\bsize-\d/.test(line)) {
            offenders.push(`${file.replace(srcDir, '')}:${i + 1}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  it('placeholders use the full-strength token', () => {
    for (const file of walk(srcDir)) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/placeholder:text-muted-foreground\//);
    }
  });
});

// The semantic colours (primary, secondary, warning, …) are bright fills. As text they read a
// per-theme `--<name>-text` variant instead: tailwind.config.ts `textColor` points text-<name>
// at it, while bg-, border- and ring- keep the fill (#499).
type ColorValue = string | Record<string, string>;
const colors = tailwindConfig.theme?.extend?.colors as Record<string, ColorValue>;
const textColors = tailwindConfig.theme?.extend?.textColor as Record<string, ColorValue>;
const textToken = (name: string) => `--${name}-text`;
const TEXT_SURFACES = ['--background', '--card', '--surface', '--surface-2', '--popover', '--muted'];

describe('semantic text contrast', () => {
  it('every text-<semantic> utility reads its own --<name>-text token, defined in both themes', () => {
    expect(Object.keys(textColors).sort()).toEqual(
      ['accent', 'destructive', 'lime', 'onchain', 'primary', 'secondary', 'success', 'tertiary', 'warning'],
    );
    for (const [name, value] of Object.entries(textColors)) {
      const css = typeof value === 'string' ? value : value.DEFAULT;
      expect(css, `textColor.${name}`).toBe(`hsl(var(${textToken(name)}) / <alpha-value>)`);
      for (const tokens of Object.values(THEMES)) expect(tokens.has(textToken(name)), textToken(name)).toBe(true);
    }
    // aliases stay aliases as text too
    for (const tokens of Object.values(THEMES)) {
      expect(tokens.get('--onchain-text')).toBe(tokens.get('--primary-text'));
      expect(tokens.get('--success-text')).toBe(tokens.get('--secondary-text'));
    }
  });

  for (const [theme, tokens] of Object.entries(THEMES)) {
    const color = (token: string) => toRgb(tokens.get(token)!);

    it.each(Object.keys(textColors))(`text-%s clears AA on every ${theme} surface`, (name) => {
      for (const surface of TEXT_SURFACES) {
        expect(contrast(color(textToken(name)), color(surface)), `${name} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`Badge variants clear AA on their own tint over every ${theme} surface`, () => {
      for (const variant of ['primary', 'onchain', 'success', 'warning'] as const) {
        const cls = String(Badge({ variant }).props.className).split(' ');
        // the variant's text colour must be one with a text variant, and its tint a fill
        const text = cls.find((c) => c.startsWith('text-') && c.slice(5) in textColors)?.slice(5);
        expect(text, `${variant}: a text-<semantic> class`).toBeDefined();
        const [, tint, pct] = cls.map((c) => /^bg-([a-z]+)\/(\d+)$/.exec(c)).find(Boolean)!;
        for (const surface of ['--background', '--card', '--surface']) {
          const bg = over(color(`--${tint}`), Number(pct) / 100, color(surface));
          expect(contrast(color(textToken(text!)), bg), `${variant} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  }

  it('every semantic colour used as text has a text variant', () => {
    // A colour key whose token is a surface / fill, not a *-foreground made for text.
    const fills = new Set(
      Object.entries(colors).flatMap(([name, v]) =>
        typeof v === 'string' || 'DEFAULT' in v ? [name] : [],
      ),
    );
    for (const neutral of ['foreground', 'background', 'border', 'input', 'ring', 'surface', 'card', 'popover', 'muted', 'starlight']) {
      fills.delete(neutral);
    }
    const missing = new Set<string>();
    for (const file of walk(srcDir)) {
      for (const [, name] of readFileSync(file, 'utf8').matchAll(/(?<![\w-])text-([a-z]+)(?:\/\d+)?(?![\w-])/g)) {
        if (fills.has(name) && !(name in textColors)) missing.add(`${name} (${file.replace(srcDir, '')})`);
      }
    }
    expect([...missing]).toEqual([]);
  });

  it('components use tokens, never raw Tailwind palette colours', () => {
    const PALETTE =
      /(?<![\w-])(?:[a-z]+:)*(?:text|bg|border|ring|fill|stroke|from|via|to|shadow|outline|decoration|divide|accent|caret)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}(?![\w-])/;
    const offenders: string[] = [];
    for (const file of walk(srcDir)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (PALETTE.test(line)) offenders.push(`${file.replace(srcDir, '')}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
