import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buttonVariants } from '@/components/ui/button';

const globals = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

function token(name: string): string {
  const body = /(^|\n):root\s*\{([^}]*)\}/.exec(globals)?.[2] ?? '';
  const m = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(body);
  if (!m) throw new Error(`no ${name}`);
  return m[1].trim();
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

function hsl(value: string): [number, number, number] {
  const m = /^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/.exec(value.trim());
  if (!m) throw new Error(`bad hsl: ${value}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(bg: string, fg: string): number {
  const [hi, lo] = [luminance(toRgb(hsl(bg))), luminance(toRgb(hsl(fg)))].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

describe('button contrast (WCAG AA, 4.5:1)', () => {
  it('flow labels clear AA on every gradient stop', () => {
    for (const stop of ['--primary', '--tertiary', '--secondary']) {
      expect(contrast(token(stop), token('--secondary-foreground')), stop).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('primary and onchain labels clear AA on their violet background', () => {
    expect(contrast(token('--primary'), token('--primary-foreground'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('--onchain'), token('--primary-foreground'))).toBeGreaterThanOrEqual(4.5);
  });

  it('the flow variant no longer hard-codes white text', () => {
    expect(buttonVariants({ variant: 'flow' })).toContain('text-secondary-foreground');
    expect(buttonVariants({ variant: 'flow' })).not.toContain('text-white');
  });
});
