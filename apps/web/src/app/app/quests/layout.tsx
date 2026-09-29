import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Quests',
  description: 'Verified quests that earn on-chain reputation.',
};

export default function QuestsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
