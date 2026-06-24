import { cn } from '@/lib/utils';

/**
 * Aurora text — a kinetic gradient headline accent (orange → amber → starlight → orange),
 * the brand's "alive" word treatment. Pairs with the display font on heroes.
 */
export function AuroraText({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('text-gradient', className)}>{children}</span>;
}

/**
 * Shiny text — a subtle sweep of light across muted text (eyebrows, "live" labels).
 * Static fallback under reduced-motion via the global media query.
 */
export function ShinyText({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'bg-clip-text text-transparent [background-image:linear-gradient(110deg,hsl(var(--muted-foreground))_40%,hsl(var(--starlight))_50%,hsl(var(--muted-foreground))_60%)] [background-size:200%_100%] motion-safe:animate-shiny',
        className,
      )}
    >
      {children}
    </span>
  );
}
