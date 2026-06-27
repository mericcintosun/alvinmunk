import Link from 'next/link';
import { cn } from '@/lib/utils';

/** The alvinmunk logo — a small constellation mark + the lowercase wordmark. */
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
    <Link href={href} className={cn('group inline-flex items-center gap-2', className)} aria-label="alvinmunk home">
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
        <span className="select-none font-display text-[19px] font-semibold lowercase tracking-tight text-foreground transition-transform group-hover:-rotate-1">
          alvinmunk
        </span>
      )}
    </Link>
  );
}
