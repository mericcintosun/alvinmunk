import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const srcDir = join(process.cwd(), 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

function hslTriple(value: string): [number, number, number] {
  const m = /^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/.exec(value.trim());
  if (!m) throw new Error(`bad hsl triple: ${value}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function toRgb([h, s, l]: [number, number, number]): [number, number, number] {
  const c = (1 - Math.abs((2 * l) / 100 - 1)) * (s / 100);
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l / 100 - c / 2;
  const hp = h / 60;
  const [r, g, b] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x]
    : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m] as [number, number, number];
}

function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(toRgb(hslTriple(a))), luminance(toRgb(hslTriple(b)))].sort(
    (x, y) => y - x,
  );
  return (hi + 0.05) / (lo + 0.05);
}

function rootToken(css: string, token: string): string {
  const body = /(^|\n):root\s*\{([^}]*)\}/.exec(css)?.[2] ?? '';
  const m = new RegExp(`${token}\\s*:\\s*([^;]+);`).exec(body);
  if (!m) throw new Error(`no ${token}`);
  return m[1].trim();
}

const globals = readFileSync(join(srcDir, 'app/globals.css'), 'utf8');
const muted = rootToken(globals, '--muted-foreground');

describe('secondary text contrast', () => {
  it('full-strength muted-foreground clears AA on both dark surfaces', () => {
    expect(contrast(muted, rootToken(globals, '--background'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(muted, rootToken(globals, '--surface'))).toBeGreaterThanOrEqual(4.5);
  });

  it('no text fades muted-foreground below 80 (except the permitted /40 decorative icons)', () => {
    const offenders: string[] = [];
    for (const file of walk(srcDir)) {
      const source = readFileSync(file, 'utf8');
      for (const [, n] of source.matchAll(/text-muted-foreground\/(\d+)/g)) {
        if (Number(n) < 80 && n !== '40') offenders.push(`${file.replace(srcDir, '')} -> /${n}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('placeholders use the full-strength token', () => {
    for (const file of walk(srcDir)) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/placeholder:text-muted-foreground\//);
    }
  });
});
