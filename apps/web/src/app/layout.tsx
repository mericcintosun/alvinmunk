import type { Metadata } from 'next';
import './globals.css';
import { fontVars } from '@/lib/fonts';
import { Starfield } from '@/components/brand/starfield';
import { SmoothScroll } from '@/components/smooth-scroll';
import { Navbar } from '@/components/layout/navbar';
import { SiteFooter } from '@/components/layout/site-footer';
import { Toaster } from '@/components/ui/toaster';
import { AnalyticsProvider } from '@/components/analytics';
import { WalletProvider } from '@/components/wallet/wallet-provider';
import { I18nProvider } from '@/lib/i18n';

// Runs before first paint so the page never flashes the wrong theme: an explicit choice
// (localStorage `alvinmunk.theme`, written by ThemeToggle) wins, else the OS preference.
// The server always renders `dark`, so without JS the brand's dark theme is the fallback.
const THEME_INIT = `(function(){try{var t=localStorage.getItem('alvinmunk.theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}var r=document.documentElement;r.classList.remove('light','dark');r.classList.add(t);r.style.colorScheme=t}catch(e){}})();`;

export const metadata: Metadata = {
  metadataBase: new URL('https://alvinmunk.vercel.app'),
  title: {
    default: 'alvinmunk — Collect people, not points',
    template: '%s · alvinmunk',
  },
  description:
    'A social proof-of-people reputation game on Stellar. Someone you trust vouches for you, and it becomes a star in your constellation.',
  openGraph: {
    title: 'alvinmunk — Collect people, not points',
    description: 'Someone vouched for you. Claim your half of the sky.',
    type: 'website',
    images: ['/assets/meta/og-default.png'],
  },
  twitter: { card: 'summary_large_image', images: ['/assets/meta/og-default.png'] },
  icons: { icon: [{ url: '/assets/meta/favicon-32.png', type: 'image/png' }] },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fontVars} dark`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="grain min-h-dvh" suppressHydrationWarning>
        <WalletProvider>
          <I18nProvider>
          <SmoothScroll />
          <Starfield />
          <Navbar />
          <main className="min-h-[calc(100dvh-4rem)]">{children}</main>
          <SiteFooter />
          <Toaster />
          <AnalyticsProvider />
          </I18nProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
