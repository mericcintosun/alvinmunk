import { Bricolage_Grotesque, Inter, JetBrains_Mono } from 'next/font/google';

// next/font preloads only the subsets listed here. Turkish ğ, ş and İ live in latin-ext, so
// without it they flash in the fallback font on first paint of a Turkish page.

/** Display / headings — warm humanist (brand "human" feeling). */
export const fontDisplay = Bricolage_Grotesque({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-display',
  display: 'swap',
});

/** Body / UI — neutral humanist, legible at small sizes. */
export const fontSans = Inter({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-sans',
  display: 'swap',
});

/** Mono — addresses, hashes, code, dev docs (the on-chain layer). */
export const fontMono = JetBrains_Mono({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-mono',
  display: 'swap',
});

export const fontVars = `${fontDisplay.variable} ${fontSans.variable} ${fontMono.variable}`;
