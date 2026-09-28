import type { Metadata } from 'next';
import { AppClientLayout } from '@/components/app/app-client-layout';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppClientLayout>{children}</AppClientLayout>;
}
