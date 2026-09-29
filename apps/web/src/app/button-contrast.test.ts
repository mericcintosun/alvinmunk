import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buttonVariants } from '@/components/ui/button';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const globals = read('./globals.css');

/** Declarations of the first `selector { … }` block, comments stripped. */
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

const mix = (a: Rgb, b: Rgb, t: number) => a.map((c, i) => c * (1 - t) + b[i] * t) as Rgb;

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES = { dark: block(':root'), light: block(':root.light') };
/** The `.flow` gradient's stops, in order, as token names. */
const FLOW_STOPS = [
  ...(block('.flow').get('background-image') ?? '').matchAll(/var\((--[\w-]+)\)/g),
].map((m) => m[1]);
/** Where a transparent button can sit. */
const PAGE_SURFACES = ['--background', '--card', '--surface'];
const VARIANTS = [
  'primary',
  'flow',
  'onchain',
  'outline',
  'ghost',
  'secondary',
  'destructive',
] as const;

/**
 * Every (label, background) colour pair a variant can show in one theme, at rest and on
 * hover. `flow` sweeps its whole gradient behind the label, so it is sampled end to end.
 */
function pairs(variant: (typeof VARIANTS)[number], tokens: Map<string, string>) {
  const color = (token: string): Rgb => {
    if (token === 'white') return [1, 1, 1];
    const value = tokens.get(`--${token}`);
    if (!value) throw new Error(`--${token} is not a colour token`);
    return toRgb(value);
  };
  const classes = buttonVariants({ variant }).split(' ');
  const out: { label: string; ratio: number }[] = [];
  const TEXT = /^text-([a-z-]+?)(?:\/(\d+))?$/;
  const BG = /^bg-([a-z-]+?)(?:\/(\d+))?$/;
  const isColor = (re: RegExp, c: string) => {
    const m = re.exec(c);
    return !!m && (['transparent', 'white'].includes(m[1]) || tokens.has(`--${m[1]}`));
  };
  for (const state of ['', 'hover:']) {
    // The state's own class wins; otherwise the resting one applies.
    const pick = (re: RegExp) =>
      classes
        .filter((c) => c.startsWith(state) && isColor(re, c.slice(state.length)))
        .pop()
        ?.slice(state.length) ?? classes.filter((c) => isColor(re, c)).pop();
    const text = TEXT.exec(pick(TEXT) ?? '');
    if (!text) throw new Error(`${variant} has no label colour`);
    const bg = pick(BG);

    const backdrops: [string, Rgb][] = [];
    if (classes.includes('flow')) {
      const stops = FLOW_STOPS.map((t) => color(t.slice(2)));
      for (let s = 0; s < stops.length - 1; s++) {
        for (let i = 0; i <= 50; i++)
          backdrops.push([`flow ${s}+${i / 50}`, mix(stops[s], stops[s + 1], i / 50)]);
      }
    } else {
      const bgMatch = bg && bg !== 'bg-transparent' ? BG.exec(bg) : null;
      for (const surface of PAGE_SURFACES) {
        const page = color(surface.slice(2));
        const shown = bgMatch
          ? mix(page, color(bgMatch[1]), Number(bgMatch[2] ?? 100) / 100)
          : page;
        backdrops.push([bgMatch ? `${bg} over ${surface}` : surface, shown]);
      }
    }
    for (const [where, backdrop] of backdrops) {
      const label = mix(backdrop, color(text[1]), Number(text[2] ?? 100) / 100);
      out.push({ label: `${state}${text[0]} on ${where}`, ratio: contrast(label, backdrop) });
    }
  }
  return out;
}

describe('button label contrast (WCAG AA, 4.5:1)', () => {
  it('reads the flow gradient from globals.css', () => {
    expect(FLOW_STOPS).toEqual(['--flow-violet', '--tertiary', '--secondary', '--flow-violet']);
  });

  for (const [theme, tokens] of Object.entries(THEMES)) {
    for (const variant of VARIANTS) {
      it(`${variant} clears AA in the ${theme} theme`, () => {
        const failing = pairs(variant, tokens).filter((p) => p.ratio < 4.5);
        expect(failing.map((p) => `${p.label}: ${p.ratio.toFixed(2)}`)).toEqual([]);
      });
    }
  }
});
