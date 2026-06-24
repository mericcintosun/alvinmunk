import Link from 'next/link';
import { cn } from '@/lib/utils';
import { asset, BRAND } from '@/lib/assets';

/** The Passport logo — a small constellation mark + the lime wordmark from the asset kit. */
export function Logo({
  href = '/',
  markOnly = false,
  className,
}: {
  href?: string;
  markOnly?: boolean;
  className?: string;
}) {
  return (
    <Link href={href} className={cn('group inline-flex items-center gap-2', className)} aria-label="Stellar Passport home">
      <svg viewBox="0 0 24 24" className="size-7 shrink-0" role="img" aria-hidden>
        <polyline
          points="5,8 12,5 18,11 9,18"
          fill="none"
          stroke="hsl(var(--starlight))"
          strokeOpacity="0.3"
          strokeWidth="1"
        />
        <circle cx="12" cy="5" r="2" fill="hsl(var(--primary))" />
        <circle cx="5" cy="8" r="1.4" fill="hsl(var(--starlight))" />
        <circle cx="18" cy="11" r="1.4" fill="hsl(var(--starlight))" />
        <circle cx="9" cy="18" r="1.4" fill="hsl(var(--starlight))" />
      </svg>
      {!markOnly && (
        <img
          src={asset(BRAND.wordmark.file)}
          alt="Passport"
          width={Math.round((22 / BRAND.wordmark.h) * BRAND.wordmark.w)}
          height={22}
          draggable={false}
          className="select-none transition-transform group-hover:-rotate-1"
        />
      )}
    </Link>
  );
}
