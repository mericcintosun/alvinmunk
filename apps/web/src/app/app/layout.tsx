import type { Metadata } from 'next';
import { AppClientLayout } from '@/components/app/app-client-layout';
import { TITLE_TEMPLATE } from '@/lib/metadata';

export const metadata: Metadata = {
  // `default` titles /app itself; the template must be repeated because a plain string
  // title here would reset it, and the tabs below would lose the "· alvinmunk" suffix.
  title: { default: 'Home', template: TITLE_TEMPLATE },
  description: 'Your crest, recent activity, and shortcuts into the vouch loop.',
  // The signed-in dashboard has nothing to rank; every /app/* tab inherits this.
  robots: { index: false, follow: false },
};

/**
 * /app segment layout. A server component so it can export metadata; the wallet-gated
 * onboarding gate and dashboard shell live in the client-side AppClientLayout.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppClientLayout>{children}</AppClientLayout>;
}
