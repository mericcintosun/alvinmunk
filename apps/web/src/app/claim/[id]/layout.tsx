import type { Metadata } from 'next';

const CLAIM_FUNNEL_DESCRIPTION = 'Someone vouched for you. Claim your half of the sky.';

type ClaimLayoutProps = {
  children: React.ReactNode;
  params: { id: string };
};

export async function generateMetadata(): Promise<Metadata> {
  const title = 'Someone vouched for you';

  return {
    title,
    description: CLAIM_FUNNEL_DESCRIPTION,
    openGraph: {
      title,
      description: CLAIM_FUNNEL_DESCRIPTION,
    },
    twitter: {
      title,
      description: CLAIM_FUNNEL_DESCRIPTION,
    },
  };
}

export default function ClaimLayout({ children }: ClaimLayoutProps) {
  return <>{children}</>;
}
