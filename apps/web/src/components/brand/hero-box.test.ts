import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HERO_BOX } from './hero-box';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const hero = read('./constellation-3d.tsx');
const placeholder = read('../../app/app/page.tsx');

describe('hero box sizing', () => {
  it('uses one shared height so the lazy hero cannot shift the dashboard', () => {
    expect(HERO_BOX).toContain('h-[64vh]');
    expect(HERO_BOX).toContain('max-h-[620px]');
    expect(HERO_BOX).toContain('min-h-[440px]');
  });

  it('sizes the 3D hero through the shared constant', () => {
    expect(hero).toContain('${HERO_BOX}');
    expect(hero).not.toMatch(/h-\[64vh\]/);
  });

  it('sizes the dynamic() loading placeholder through the same constant', () => {
    expect(placeholder).toContain('${HERO_BOX}');
    expect(placeholder).not.toMatch(/h-\[44vh\]/);
    expect(placeholder).not.toMatch(/h-\[64vh\]/);
  });
});
