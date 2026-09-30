import type { Metadata, Viewport } from 'next';
import './globals.css';
import { fontVars } from '@/lib/fonts';
import { Starfield } from '@/components/brand/starfield';
import { SmoothScroll } from '@/components/smooth-scroll';
import { Navbar } from '@/components/layout/navbar';
import { SiteFooter } from '@/components/layout/site-footer';
import { Toaster } from '@/components/ui/toaster';
import { AnalyticsProvider } from '@/components/analytics';
import { ConfigStatusBanner } from '@/components/config-status-banner';
import { WalletProvider } from '@/components/wallet/wallet-provider';
import { MotionProvider } from '@/components/motion/motion-provider';
import { I18nProvider } from '@/lib/i18n';
import { rootMetadata } from '@/lib/metadata';
import { rootViewport, THEME_INIT } from '@/lib/theme';

// THEME_INIT runs before first paint so the page never flashes the wrong theme: an explicit
// choice (localStorage `alvinmunk.theme`, written by ThemeToggle) wins, else the OS preference.
// The server always renders `dark`, so without JS the brand's dark theme is the fallback.

export const metadata: Metadata = rootMetadata;
// theme-color per colour scheme (the mobile toolbar and PWA title bar), from the --background tokens.
export const viewport: Viewport = rootViewport;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fontVars} dark`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="grain min-h-dvh" suppressHydrationWarning>
        <WalletProvider>
          <I18nProvider>
          <MotionProvider>
          <SmoothScroll />
          <Starfield />
          <ConfigStatusBanner />
          <Navbar />
          <main className="min-h-[calc(100dvh-4rem)]">{children}</main>
          <SiteFooter />
          <Toaster />
          <AnalyticsProvider />
          </MotionProvider>
          </I18nProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
