import type { ReactNode } from 'react';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function OpenAppLink({ children }: { children: ReactNode }) {
  return (
    <Link href="/app" className={cn(buttonVariants({ variant: 'flow', size: 'lg' }), 'inline-flex')}>
      {children}
    </Link>
  );
}

export function VouchActionLink({ children }: { children: ReactNode }) {
  return (
    <Link href="/app/vouch" className={cn(buttonVariants({ variant: 'flow', size: 'sm' }), 'gap-1.5')}>
      {children}
    </Link>
  );
}

export function SuggestionViewLink({
  href,
  ariaLabel,
  children,
}: {
  href: string;
  ariaLabel: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'shrink-0 gap-1 text-xs')}
    >
      {children}
    </Link>
  );
}