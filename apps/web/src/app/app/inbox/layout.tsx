import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Inbox',
  description: 'Claims, tips received, and quest awards — what happened while you were away.',
};

export default function InboxLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
