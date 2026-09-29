import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Admin',
  description: 'Content management for the contract admin.',
  // Admin-only and linked from nowhere public: keep it out of search results. Not
  // blocked in robots.txt, which would advertise the path and hide this noindex.
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
