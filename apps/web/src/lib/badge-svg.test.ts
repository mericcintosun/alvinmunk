import { describe, expect, it } from 'vitest';
import { badgeStyle, badgeSvg, type BadgeView } from './badge-svg';

const claimed: BadgeView = {
  status: 'claimed',
  handle: 'alice',
  vouchedBy: 3,
  earned: 12,
  verified: true,
};

const free: BadgeView = { status: 'unclaimed', handle: 'bob', vouchedBy: 0, earned: 0, verified: false };
const down: BadgeView = { status: 'unavailable', handle: 'carol', vouchedBy: 0, earned: 0, verified: false };
const invalid: BadgeView = { status: 'invalid', handle: '', vouchedBy: 0, earned: 0, verified: false };

describe('badgeStyle (#283)', () => {
  it('defaults to flat and only opts into card', () => {
    expect(badgeStyle(null)).toBe('flat');
    expect(badgeStyle(undefined)).toBe('flat');
    expect(badgeStyle('')).toBe('flat');
    expect(badgeStyle('flat')).toBe('flat');
    expect(badgeStyle('CARD')).toBe('flat');
    expect(badgeStyle('card')).toBe('card');
  });
});

describe('badgeSvg — flat', () => {
  it('renders a standalone SVG naming the handle, the people count and Earned XP', () => {
    const svg = badgeSvg(claimed);

    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toMatch(/role="img"/);
    expect(svg).toContain('@alice · 3 vouched · 12 earned');
    expect(svg).toContain('alvinmunk');
    // The verified tick is drawn, never a font glyph.
    expect(svg).toContain('<path d="M0 5.2 L3.4 8.6 L9 1.6"');
  });

  it('sizes the canvas to its own text', () => {
    const box = (svg: string) => /width="(\d+)" height="(\d+)"/.exec(svg)!.slice(1).map(Number);
    const short = box(badgeSvg(claimed));
    const long = box(badgeSvg({ ...claimed, handle: 'a'.repeat(32) }));

    expect(short[1]).toBe(28);
    expect(long[1]).toBe(28);
    expect(long[0]).toBeGreaterThan(short[0]);
  });

  it('renders a neutral badge for an unclaimed handle: no tick, no counts', () => {
    const svg = badgeSvg(free);

    expect(svg).toContain('@bob · unclaimed');
    expect(svg).not.toContain('vouched');
    expect(svg).not.toContain('<path d="M0 5.2');
    expect(svg).toContain('aria-label="@bob is unclaimed on alvinmunk"');
  });

  it('says a failed read is unavailable, without claiming the handle is free', () => {
    const svg = badgeSvg({ ...down, verified: true });

    expect(svg).toContain('@carol · unavailable');
    expect(svg).not.toContain('unclaimed');
    expect(svg).not.toContain('<path d="M0 5.2');
  });

  it('names no one for a path that is not a handle', () => {
    const svg = badgeSvg(invalid);

    expect(svg).toContain('not a handle');
    expect(svg).not.toContain('@');
  });

  it('prints only whole, non-negative stats', () => {
    const svg = badgeSvg({ ...claimed, vouchedBy: Number.NaN, earned: -4 });

    expect(svg).toContain('@alice · 0 vouched · 0 earned');
  });
});

describe('badgeSvg — card', () => {
  it('labels both stats and stamps the verified tick', () => {
    const svg = badgeSvg(claimed, 'card');

    expect(svg).toContain('VOUCHED BY');
    expect(svg).toContain('EARNED XP');
    expect(svg).toContain('VERIFIED');
    expect(svg).toContain('>3</text>');
    expect(svg).toContain('>12</text>');
    expect(svg).toMatch(/width="360" height="150"/);
  });

  it('says an unclaimed handle is free instead of showing zeroed stats', () => {
    const svg = badgeSvg(free, 'card');

    expect(svg).toContain('unclaimed — this handle is free');
    expect(svg).not.toContain('VOUCHED BY');
    expect(svg).not.toContain('EARNED XP');
  });

  it('says a failed read is unavailable instead of showing zeroed stats', () => {
    const svg = badgeSvg(down, 'card');

    expect(svg).toContain('@carol');
    expect(svg).toContain('reputation unavailable');
    expect(svg).not.toContain('VOUCHED BY');
    expect(svg).not.toContain('this handle is free');
  });

  it('shrinks a 32-character handle to fit the panel', () => {
    const svg = badgeSvg({ ...claimed, handle: 'a'.repeat(32) }, 'card');
    const size = Number(/font-size="(\d+)" font-weight="700"/.exec(svg)![1]);

    expect(size).toBeLessThan(26);
    expect(size).toBeGreaterThanOrEqual(12);
    expect(svg).toContain('@' + 'a'.repeat(32));
  });
});

describe('badgeSvg — well-formedness', () => {
  it.each([
    ['flat', claimed],
    ['flat', free],
    ['flat', down],
    ['flat', invalid],
    ['card', claimed],
    ['card', free],
    ['card', down],
    ['card', invalid],
    ['card', { ...claimed, handle: 'a<script>&"' }],
  ] as [string, BadgeView][])(
    'parses as XML (%s, %o)',
    (style, view) => {
      const svg = badgeSvg(view, style as 'flat' | 'card');
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');

      expect(doc.querySelector('parsererror')).toBeNull();
      expect(doc.documentElement.tagName).toBe('svg');
      expect(doc.documentElement.getAttribute('viewBox')).toMatch(/^0 0 \d+ \d+$/);
    },
  );
});

describe('badgeSvg — escaping', () => {
  it('never lets a handle close a tag or an attribute', () => {
    for (const style of ['flat', 'card'] as const) {
      const svg = badgeSvg({ ...claimed, handle: 'a<script>x&"y' }, style);

      expect(svg).not.toContain('<script>');
      expect(svg).not.toContain('x&"y');
      expect(svg).toContain('a&lt;script&gt;x&amp;&quot;y');
    }
  });
});
