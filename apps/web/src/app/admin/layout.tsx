import type { Metadata } from 'next';

// Admin-only and linked from nowhere public: keep it out of search results too.
export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
