import type { Metadata } from 'next';

type InviteLayoutProps = {
  children: React.ReactNode;
  params: { handle: string };
};

export async function generateMetadata({ params }: { params: { handle: string } }): Promise<Metadata> {
  const handle = params.handle.toLowerCase();
  const title = `@${handle} invited you`;
  const description = `@${handle} wants you in their constellation on alvinmunk.`;

  return {
    title,
    description,
    alternates: { canonical: `/v/${handle}` },
    openGraph: {
      title,
      description,
    },
    twitter: {
      title,
      description,
    },
  };
}

export default function InviteLayout({ children }: InviteLayoutProps) {
  return <>{children}</>;
}
