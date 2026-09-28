import type { Metadata } from 'next';

type ProfileLayoutProps = {
  children: React.ReactNode;
  params: { handle: string };
};

export async function generateMetadata({ params }: { params: { handle: string } }): Promise<Metadata> {
  const handle = params.handle.toLowerCase();
  const title = `@${handle}`;
  const description = `View @${handle}'s constellation and reputation on alvinmunk.`;

  return {
    title,
    description,
    alternates: { canonical: `/u/${handle}` },
    openGraph: {
      title: `@${handle} on alvinmunk`,
      description,
    },
    twitter: {
      title: `@${handle} on alvinmunk`,
      description,
    },
  };
}

export default function ProfileLayout({ children }: ProfileLayoutProps) {
  return <>{children}</>;
}
