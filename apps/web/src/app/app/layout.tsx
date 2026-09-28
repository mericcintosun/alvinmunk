import type { Metadata } from 'next';
import { AppClientLayout } from '@/components/app/app-client-layout';

export const metadata: Metadata = {
  title: 'Home',
  description: 'Your crest, recent activity, and shortcuts into the vouch loop.',
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppClientLayout>{children}</AppClientLayout>;
}
