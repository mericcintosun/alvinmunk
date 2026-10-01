/**
 * The brand colours as hex, for the surfaces CSS variables can't reach: three.js materials,
 * the 2D starfield canvas and Satori (the OG image renderer). Every value is a design token
 * from `app/globals.css` resolved to hex (`brand-palette.test.ts` recomputes them from the
 * stylesheet, so a token change that isn't mirrored here fails the suite). This is the only
 * place under `components/brand/*` and `lib/og-card.tsx` allowed to spell a hex colour.
 */

export interface BrandPalette {
  /** --background: the sky. */
  background: string;
  /** --foreground: body text. */
  foreground: string;
  /** --muted-foreground: secondary text, constellation lines, ghost stars. */
  muted: string;
  /** --starlight: the brightest star tone (a highlighted beam, the shooting star). */
  starlight: string;
  /** --primary: violet, the chain. */
  violet: string;
  /** --secondary: green, earned energy. */
  green: string;
  /** --tertiary: cyan, social connection. */
  cyan: string;
  /** --accent: warm gold, the human accent. "You" is always this colour. */
  gold: string;
  /** --lime: the sticker-kit accent. */
  lime: string;
  /** --nebula-a: the glow behind the sky. */
  nebula: string;
}

/** The token behind each palette entry (read by the test that keeps them in sync). */
export const BRAND_TOKENS: Record<keyof BrandPalette, string> = {
  background: '--background',
  foreground: '--foreground',
  muted: '--muted-foreground',
  starlight: '--starlight',
  violet: '--primary',
  green: '--secondary',
  cyan: '--tertiary',
  gold: '--accent',
  lime: '--lime',
  nebula: '--nebula-a',
};

/** `:root` — the dark theme (and the OG cards, which are always dark). */
export const BRAND_DARK: BrandPalette = {
  background: '#0A0611',
  foreground: '#F3F2F8',
  muted: '#A49FB7',
  starlight: '#F2F0FF',
  violet: '#9A52FF',
  green: '#1EEB9D',
  cyan: '#0ACAFF',
  gold: '#FFB647',
  lime: '#C3F94D',
  nebula: '#1D1041',
};

/** `:root.light` — darker stars and rings, so they read on the pale sky. */
export const BRAND_LIGHT: BrandPalette = {
  background: '#F4EFFA',
  foreground: '#1D122B',
  muted: '#5D5874',
  starlight: '#220F3D',
  violet: '#8833FF',
  green: '#12D389',
  cyan: '#00B4E6',
  gold: '#FFA31A',
  lime: '#9ADF07',
  nebula: '#BDADEB',
};

export function brandPalette(light: boolean): BrandPalette {
  return light ? BRAND_LIGHT : BRAND_DARK;
}

/** `#RRGGBB` + alpha → `rgba(r, g, b, a)`, for canvas gradients and shadows. */
export function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
