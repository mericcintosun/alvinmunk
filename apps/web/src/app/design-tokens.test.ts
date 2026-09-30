import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import tailwindConfig from '../../tailwind.config';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const globalsCss = read('./globals.css');
const tokensDoc = read('../../../../docs/product/DESIGN_SYSTEM_TOKENS.md');

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

const dark = block(globalsCss, ':root');
const light = block(globalsCss, ':root.light');

describe('design tokens', () => {
  it('the light theme redefines every dark token and nothing else', () => {
    expect([...light.keys()].sort()).toEqual([...dark.keys()].sort());
  });

  it('DESIGN_SYSTEM_TOKENS.md documents both token sets exactly as globals.css defines them', () => {
    expect(Object.fromEntries(block(tokensDoc, ':root'))).toEqual(Object.fromEntries(dark));
    expect(Object.fromEntries(block(tokensDoc, ':root.light'))).toEqual(Object.fromEntries(light));
  });

  it('every Tailwind colour reads the token of its own name', () => {
    const colors = tailwindConfig.theme?.extend?.colors as Record<string, string | Record<string, string>>;
    for (const [name, value] of Object.entries(colors)) {
      const shades = typeof value === 'string' ? { DEFAULT: value } : value;
      for (const [shade, css] of Object.entries(shades)) {
        const token = shade === 'DEFAULT' ? name : `${name}-${shade}`;
        expect(css, `colors.${name}.${shade}`).toBe(`hsl(var(--${token}) / <alpha-value>)`);
        expect(dark.has(`--${token}`), `--${token} in :root`).toBe(true);
      }
    }
  });

  it('every token a Tailwind boxShadow reads is defined', () => {
    const shadows = tailwindConfig.theme?.extend?.boxShadow as Record<string, string>;
    for (const css of Object.values(shadows)) {
      for (const [, token] of css.matchAll(/var\((--[\w-]+)\)/g)) {
        expect(dark.has(token), `${token} in :root`).toBe(true);
      }
    }
  });

  it('onchain is one colour: the token aliases primary and the variants use only it', () => {
    expect(dark.get('--onchain')).toBe(dark.get('--primary'));
    expect(light.get('--onchain')).toBe(light.get('--primary'));
    expect(
      (tailwindConfig.theme?.extend?.boxShadow as Record<string, string>)['glow-onchain'],
    ).toContain('var(--onchain)');

    const badge = String(Badge({ variant: 'onchain' }).props.className).split(' ');
    expect(badge).toEqual(expect.arrayContaining(['border-onchain/30', 'bg-onchain/10', 'text-onchain']));
    const button = buttonVariants({ variant: 'onchain' }).split(' ');
    expect(button).toEqual(expect.arrayContaining(['bg-onchain', 'shadow-glow-onchain']));
    for (const cls of [...badge, ...button]) expect(cls).not.toMatch(/secondary/);
  });
});

/** A `borderRadius` value in rem: `var(--radius)` or `calc(var(--radius) ± Nrem)`. */
function radiusRem(css: string, radius: number): number {
  if (css === 'var(--radius)') return radius;
  const m = /^calc\(var\(--radius\) ([+-]) ([\d.]+)rem\)$/.exec(css);
  if (!m) throw new Error(`radius not built from --radius: ${css}`);
  return radius + (m[1] === '-' ? -1 : 1) * Number(m[2]);
}

const RADIUS_STEPS = ['sm', 'md', 'lg', 'xl', '2xl', '3xl'] as const;

describe('radius and shadow scales', () => {
  const radii = tailwindConfig.theme?.extend?.borderRadius as Record<string, string>;
  const shadows = tailwindConfig.theme?.extend?.boxShadow as Record<string, string>;

  it('every rounded-* step from sm to 3xl is rounder than the one before, in both themes', () => {
    for (const theme of [dark, light]) {
      const radius = Number(/^([\d.]+)rem$/.exec(theme.get('--radius') ?? '')?.[1]);
      expect(radius).toBeGreaterThan(0);
      const rems = RADIUS_STEPS.map((step) => radiusRem(radii[step] ?? `missing ${step}`, radius));
      for (let i = 1; i < rems.length; i++) {
        expect(rems[i], `${RADIUS_STEPS[i]} > ${RADIUS_STEPS[i - 1]}`).toBeGreaterThan(rems[i - 1]);
      }
      expect(rems[0]).toBeGreaterThan(0);
    }
  });

  it('DESIGN_SYSTEM_TOKENS.md lists the full radius scale with the values the config computes', () => {
    const radius = Number(/^([\d.]+)rem$/.exec(dark.get('--radius')!)![1]);
    const documented = Object.fromEntries(
      [...tokensDoc.matchAll(/`(sm|md|lg|xl|2xl|3xl) ([\d.]+)rem`/g)].map(([, step, rem]) => [step, Number(rem)]),
    );
    expect(documented).toEqual(
      Object.fromEntries(RADIUS_STEPS.map((step) => [step, radiusRem(radii[step], radius)])),
    );
  });

  it('every shadow token reads a CSS variable and has no literal colour', () => {
    for (const [name, css] of Object.entries(shadows)) {
      expect(css, `boxShadow.${name}`).toMatch(/(hsl|rgb)a?\(var\(--[\w-]+\)/);
      expect(css, `boxShadow.${name}`).not.toMatch(/#[\da-f]{3,8}\b/i);
      expect(css, `boxShadow.${name}`).not.toMatch(/(hsl|rgb)a?\(\s*[\d.]/);
      // every colour in the shadow is a token, not just one of them
      expect(css.match(/(hsl|rgb)a?\(/g)?.length, `boxShadow.${name}`).toBe(css.match(/(hsl|rgb)a?\(var\(/g)?.length);
    }
    expect(Object.keys(shadows)).toEqual(expect.arrayContaining(['card', 'popover', 'toast']));
    // the drop shadow is theme-aware: the light theme's shadow colour is not the dark one
    expect(light.get('--glass-shadow')).not.toBe(dark.get('--glass-shadow'));
  });

  it('DESIGN_SYSTEM_TOKENS.md lists every shadow exactly as the config defines it', () => {
    const documented = Object.fromEntries(
      [...tokensDoc.matchAll(/^shadow-([\w-]+):\s+(.+?);/gm)].map(([, name, css]) => [name, css]),
    );
    expect(documented).toEqual(shadows);
  });

  it('components use the shadow tokens, not Tailwind\u2019s default shadow scale', () => {
    const src = join(dirname(fileURLToPath(import.meta.url)), '..');
    const offenders = (readdirSync(src, { recursive: true }) as string[])
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .flatMap((f) =>
        readFileSync(join(src, f), 'utf8')
          .split('\n')
          .flatMap((line, i) =>
            /(^|[\s"'`:])shadow(-(sm|md|lg|xl|2xl|inner))?(?=[\s"'`]|$)/.test(line) ? [`${f}:${i + 1}`] : [],
          ),
      );
    expect(offenders).toEqual([]);
  });
});
