import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const globals = read('./globals.css');

type Rgb = [number, number, number];

/** Declarations of a `{ … }` body, comments stripped. */
function decls(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [, prop, value] of body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) {
    out.set(prop, value.trim());
  }
  return out;
}

/** Declarations of the first top-level `selector { … }` block. */
function block(css: string, selector: string): Map<string, string> {
  const escaped = selector.replace(/[.[\]]/g, '\\$&');
  const body = new RegExp(`(^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[2];
  if (body === undefined) throw new Error(`no ${selector} block`);
  return decls(body);
}

/** The inside of `@media print { … }`, brace-matched. */
function printBlock(): string {
  const start = globals.indexOf('@media print {');
  if (start < 0) throw new Error('no @media print block');
  let depth = 0;
  for (let i = globals.indexOf('{', start); i < globals.length; i++) {
    if (globals[i] === '{') depth++;
    if (globals[i] === '}' && --depth === 0)
      return globals.slice(globals.indexOf('{', start) + 1, i);
  }
  throw new Error('unterminated @media print block');
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

const themes = { dark: block(globals, ':root'), light: block(globals, ':root.light') };

describe('text selection and scrollbars (#509)', () => {
  const selection = block(globals, '::selection');

  it('selects in translucent brand violet under the foreground colour', () => {
    expect(selection.get('background-color')).toMatch(/^hsl\(var\(--primary\)\s*\/\s*0?\.35\)$/);
    // Without a colour, selected mint/cyan text in the light theme sat at ~1:1 on the violet.
    expect(selection.get('color')).toBe('hsl(var(--foreground))');
  });

  it('keeps selected text at AAA contrast on every surface in both themes', () => {
    for (const [name, t] of Object.entries(themes)) {
      const c = (k: string) => toRgb(t.get(k)!);
      for (const surface of ['--background', '--card', '--surface', '--muted']) {
        const ratio = contrast(c('--foreground'), mix(c(surface), c('--primary'), 0.35));
        expect(ratio, `${name} selection on ${surface}`).toBeGreaterThan(7);
      }
    }
  });

  it('draws thin scrollbars in the border token on a transparent track', () => {
    const html = block(globals, 'html');
    expect(html.get('scrollbar-color')).toBe('hsl(var(--border)) transparent');
    expect(html.get('scrollbar-width')).toBe('thin');
  });
});

describe('print stylesheet (#509)', () => {
  const print = printBlock();

  it('forces exactly the light tokens over the dark default, on paper-white', () => {
    const forced = /:root,\s*:root\.dark\s*\{([^}]*)\}/.exec(print);
    expect(forced, ':root, :root.dark block').not.toBeNull();
    const tokens = decls(forced![1]);
    expect(tokens.get('color-scheme')).toBe('light');
    tokens.delete('color-scheme');
    // A copy of :root.light, so a light-token change has to land here too.
    const expected = new Map(themes.light);
    expected.delete('color-scheme');
    expected.set('--background', '0 0% 100%');
    expect(Object.fromEntries(tokens)).toEqual(Object.fromEntries(expected));
    // The paper stays dark-on-light well past AAA.
    expect(contrast(toRgb(tokens.get('--foreground')!), toRgb('0 0% 100%'))).toBeGreaterThan(7);
  });

  it('hides the grain overlay and the toasts', () => {
    const hidden = /([^{}]+)\{\s*display:\s*none\s*!important;\s*\}/g;
    const selectors = [...print.matchAll(hidden)].flatMap((m) =>
      m[1].split(',').map((s) => s.trim()),
    );
    expect(selectors).toContain('.grain::after');
    expect(selectors).toContain('[data-sonner-toaster]');
    // Content headers, footers and canvases print: only the screen chrome is hidden, by
    // print:hidden on those components (below), never by a bare element selector.
    for (const bare of ['canvas', 'header', 'footer', 'nav', 'main'])
      expect(selectors).not.toContain(bare);
  });

  it('prints external link URLs, but not share intents', () => {
    const rule = /a\[href\^="http"\]([^{]*)::after\s*\{([^}]*)\}/.exec(print);
    expect(rule).not.toBeNull();
    expect(rule![1]).toContain(':not([href*="x.com/intent"])');
    expect(rule![1]).toContain(':not([href*="twitter.com/intent"])');
    expect(decls(rule![2]).get('content')).toMatch(/^(['"]) \(\1 attr\(href\) (['"])\)\2$/);
  });

  it('drops the fixed and sticky screen layers with print:hidden', () => {
    // The className that positions each layer must also hide it on paper.
    const layers: [string, RegExp][] = [
      ['../components/brand/starfield.tsx', /className="nebula[^"]*\bfixed\b[^"]*"/],
      ['../components/layout/navbar.tsx', /'sticky top-0[^']*'/],
      ['../components/layout/footer.tsx', /<footer className="[^"]*"/],
      ['../components/config-status-banner.tsx', /className="fixed inset-x-0 top-0[^"]*"/],
      ['../components/VouchClaimedNotice.tsx', /className="fixed bottom-20[^"]*"/],
    ];
    for (const [file, positioned] of layers) {
      const cls = positioned.exec(read(file))?.[0];
      expect(cls, file).toBeDefined();
      expect(cls, file).toContain('print:hidden');
    }
  });
});
