import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Stellar Passport',
  description: 'Collect people, not points. A social proof-of-people game on Stellar.',
  openGraph: {
    title: 'Stellar Passport',
    description: 'Someone vouched for you. Claim your side →',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
