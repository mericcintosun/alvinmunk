import type { Metadata } from 'next';
import './globals.css';
import { fontVars } from '@/lib/fonts';
import { Starfield } from '@/components/brand/starfield';
import { SmoothScroll } from '@/components/smooth-scroll';
import { Navbar } from '@/components/layout/navbar';
import { Footer } from '@/components/layout/footer';
import { Toaster } from '@/components/ui/toaster';
import { WalletProvider } from '@/components/wallet/wallet-provider';

export const metadata: Metadata = {
  metadataBase: new URL('https://alvinmunk.vercel.app'),
  title: {
    default: 'Stellar Passport — Collect people, not points',
    template: '%s · Stellar Passport',
  },
  description:
    'A social proof-of-people reputation game on Stellar. Someone you trust vouches for you, and it becomes a star in your constellation.',
  openGraph: {
    title: 'Stellar Passport — Collect people, not points',
    description: 'Someone vouched for you. Claim your half of the sky.',
    type: 'website',
  },
  twitter: { card: 'summary_large_image' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fontVars} dark`} suppressHydrationWarning>
      <body className="grain min-h-dvh" suppressHydrationWarning>
        <WalletProvider>
          <SmoothScroll />
          <Starfield />
          <Navbar />
          <main className="min-h-[calc(100dvh-4rem)]">{children}</main>
          <Footer />
          <Toaster />
        </WalletProvider>
      </body>
    </html>
  );
}
