import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Activity',
  description: 'Recent vouches, claims, and constellation updates.',
};

export default function ActivityLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
