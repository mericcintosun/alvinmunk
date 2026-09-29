import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Leaderboard',
  description: 'The most-connected constellations in the alvinmunk sky.',
};

export default function LeaderboardLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
