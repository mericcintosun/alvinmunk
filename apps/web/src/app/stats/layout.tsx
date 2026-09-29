import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Stats',
  description: 'Network growth, ledger activity, and on-chain usage for alvinmunk.',
};

export default function StatsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
