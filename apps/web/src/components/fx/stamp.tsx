import { cn } from '@/lib/utils';

/**
 * Stamp — a rotated ink-stamp mark (profile metaphor). For "verified on-chain" style
 * seals: distressed-looking mono caps inside a double border, slightly askew.
 */
export function Stamp({
  children,
  className,
  accent = 'secondary',
}: {
  children: React.ReactNode;
  className?: string;
  accent?: 'secondary' | 'primary' | 'tertiary';
}) {
  const c =
    accent === 'primary'
      ? 'border-primary/55 text-primary/85'
      : accent === 'tertiary'
        ? 'border-tertiary/55 text-tertiary/85'
        : 'border-secondary/55 text-secondary/85';
  return (
    <span
      className={cn(
        'inline-flex -rotate-3 items-center gap-1.5 rounded-sm border-2 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.15em]',
        c,
        className,
      )}
    >
      {children}
    </span>
  );
}
