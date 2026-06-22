import { Bricolage_Grotesque, Inter, JetBrains_Mono } from 'next/font/google';

/** Display / headings — warm humanist (brand "human" feeling). */
export const fontDisplay = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

/** Body / UI — neutral humanist, legible at small sizes. */
export const fontSans = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

/** Mono — addresses, hashes, code, dev docs (the on-chain layer). */
export const fontMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const fontVars = `${fontDisplay.variable} ${fontSans.variable} ${fontMono.variable}`;
