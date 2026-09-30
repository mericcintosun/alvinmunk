import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Wallet',
  description: 'Connect a Stellar wallet, check your balance, and send a testnet XLM payment.',
};

export default function WalletLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
