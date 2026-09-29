import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Vouch',
  description: 'Vouch for someone you trust and share a claim link.',
};

export default function VouchLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
