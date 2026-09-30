import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const globals = read('./globals.css');
const starfield = read('../components/brand/starfield.tsx');
const navbar = read('../components/layout/navbar.tsx');
const footer = read('../components/layout/footer.tsx');

type Rgb = [number, number, number];

function block(selector: string): Map<string, string> {
  const escaped = selector.replace('.', '\\.');
  const body = new RegExp(`(^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(globals)?.[2];
  if (body === undefined) throw new Error(`no ${selector} block`);
  const decls = new Map<string, string>();
  for (const [, prop, value] of body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) {
    decls.set(prop, value.trim());
  }
  return decls;
}

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

const mix = (a: Rgb, b: Rgb, t: number) => a.map((c, i) => c * (1 - t) + b[i] * t) as Rgb;

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('theme selection, scrollbars, and print output (issue #509)', () => {
  it('defines ::selection style with the primary token at 0.35 opacity', () => {
    const selectionMatch = globals.match(/::selection\s*\{([^}]*)\}/);
    expect(selectionMatch).not.toBeNull();
    const body = selectionMatch![1];
    expect(body).toMatch(/background-color:\s*hsl\(var\(--primary\)\s*\/\s*0?\.35\)/);
  });

  it('guarantees accessible text contrast for selection in both dark and light themes', () => {
    const darkTokens = block(':root');
    const lightTokens = block(':root.light');

    // Dark theme selection contrast
    const darkBg = toRgb(darkTokens.get('--background')!);
    const darkPrimary = toRgb(darkTokens.get('--primary')!);
    const darkFg = toRgb(darkTokens.get('--foreground')!);
    const darkSelectionBg = mix(darkBg, darkPrimary, 0.35);
    const darkRatio = contrast(darkFg, darkSelectionBg);
    expect(darkRatio).toBeGreaterThan(7.0); // WCAG AAA is 7:1

    // Light theme selection contrast
    const lightBg = toRgb(lightTokens.get('--background')!);
    const lightPrimary = toRgb(lightTokens.get('--primary')!);
    const lightFg = toRgb(lightTokens.get('--foreground')!);
    const lightSelectionBg = mix(lightBg, lightPrimary, 0.35);
    const lightRatio = contrast(lightFg, lightSelectionBg);
    expect(lightRatio).toBeGreaterThan(7.0); // WCAG AAA is 7:1
  });

  it('defines html scrollbar with border token and thin width', () => {
    const htmlMatch = globals.match(/html\s*\{([^}]*)\}/);
    expect(htmlMatch).not.toBeNull();
    const body = htmlMatch![1];
    expect(body).toMatch(/scrollbar-color:\s*hsl\(var\(--border\)\)\s+transparent/);
    expect(body).toMatch(/scrollbar-width:\s*thin/);
  });

  it('contains @media print stylesheet that forces light tokens and hides screen chrome', () => {
    const printIndex = globals.indexOf('@media print');
    expect(printIndex).toBeGreaterThan(-1);

    const printBlock = globals.slice(printIndex);

    // Forces light tokens in print
    expect(printBlock).toContain('color-scheme: light');
    expect(printBlock).toContain(':root,');
    expect(printBlock).toContain(':root.dark');

    // Hides fixed visual overlays and chrome
    expect(printBlock).toMatch(/canvas/);
    expect(printBlock).toMatch(/header/);
    expect(printBlock).toMatch(/footer/);
    expect(printBlock).toMatch(/\[data-sonner-toaster\]/);
    expect(printBlock).toMatch(/\.grain::after/);

    // Strips animations and transitions on print
    expect(printBlock).toMatch(/animation:\s*none\s*!important/);
    expect(printBlock).toMatch(/transition:\s*none\s*!important/);

    // Sets white background on paper
    expect(printBlock).toMatch(/background:\s*#ffffff\s*!important/);

    // Handles external links
    expect(printBlock).toMatch(/a\[href\^="http"\]/);
  });

  it('adds print:hidden utility to starfield canvas, navbar header, and footer', () => {
    expect(starfield).toContain('print:hidden');
    expect(navbar).toContain('print:hidden');
    expect(footer).toContain('print:hidden');
  });
});
