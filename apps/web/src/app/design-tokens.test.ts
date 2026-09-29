import { readFileSync } from 'node:fs';
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
