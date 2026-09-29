import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'People',
  description: 'The humans in your constellation and who vouched whom.',
};

export default function PeopleLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
