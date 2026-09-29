import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Wallet',
  description: 'Connect a Stellar wallet, view balances, and try classic payments.',
};

export default function WalletLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
