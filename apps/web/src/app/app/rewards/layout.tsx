import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Rewards',
  description: 'Rank unlocks, reward tiers, and USDC claims.',
};

export default function RewardsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
