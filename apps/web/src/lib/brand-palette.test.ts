import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BRAND_DARK,
  BRAND_LIGHT,
  BRAND_TOKENS,
  brandPalette,
  rgba,
  type BrandPalette,
} from './brand-palette';

const read = (rel: string) => readFileSync(path.resolve(__dirname, rel), 'utf8');
const css = read('../app/globals.css');

/** The body of the first `<selector> { … }` block in globals.css. */
function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} block`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
}

/** An `H S% L%` token from a block, as numbers. */
function token(body: string, name: string): [number, number, number] {
  const m = body.match(new RegExp(`${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`));
  expect(m, `${name} token`).not.toBeNull();
  return [Number(m![1]), Number(m![2]), Number(m![3])];
}

/** CSS hsl() → `#RRGGBB` (the CSS Color 4 conversion, channels rounded). */
function hslToHex([h, s, l]: [number, number, number]): string {
  const sat = s / 100;
  const lig = l / 100;
  const a = sat * Math.min(lig, 1 - lig);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = lig - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

describe('brand palette', () => {
  const themes: Array<[string, string, BrandPalette]> = [
    ['dark', ':root', BRAND_DARK],
    ['light', ':root.light', BRAND_LIGHT],
  ];

  it.each(themes)('the %s palette matches the %s tokens in globals.css', (_, selector, palette) => {
    const body = block(selector);
    for (const [key, name] of Object.entries(BRAND_TOKENS) as Array<[keyof BrandPalette, string]>) {
      expect(palette[key], `${key} (${name})`).toBe(hslToHex(token(body, name)));
    }
  });

  it('resolves the design-system signature colours, not a look-alike brand trio', () => {
    expect([BRAND_DARK.violet, BRAND_DARK.green, BRAND_DARK.cyan, BRAND_DARK.gold]).toEqual([
      '#9A52FF',
      '#1EEB9D',
      '#0ACAFF',
      '#FFB647',
    ]);
  });

  it('picks the palette of the active theme', () => {
    expect(brandPalette(false)).toBe(BRAND_DARK);
    expect(brandPalette(true)).toBe(BRAND_LIGHT);
  });

  it('turns a hex colour into an rgba() string for canvas gradients', () => {
    expect(rgba('#9A52FF', 0.5)).toBe('rgba(154, 82, 255, 0.5)');
    expect(rgba('#0A0611', 0)).toBe('rgba(10, 6, 17, 0)');
  });
});

describe('no hex colours outside the palette', () => {
  const HEX = /#[0-9a-f]{3,8}\b/i;
  const brand = readdirSync(path.resolve(__dirname, '../components/brand')).map(
    (f) => `../components/brand/${f}`,
  );

  it.each([...brand, './og-card.tsx'])('%s spells no hex colour', (file) => {
    const hits = read(file)
      .split('\n')
      .filter((line) => HEX.test(line));
    expect(hits).toEqual([]);
  });
});
