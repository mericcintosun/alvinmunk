'use client';

import { useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Tape } from '@/components/ui/sticker';
import { type TapeCorner } from '@/lib/assets';

/**
 * Technical Frame — the brand's anti-template container. Sharp corners, a hairline
 * border with CORNER BRACKETS, and an optional monospace field header (label + index),
 * like a passport data page / spec sheet. Replaces generic rounded glass "AI cards".
 * Keeps the live spotlight + optional tilt, but the SKIN is editorial/technical.
 */
export function Frame({
  children,
  className,
  label,
  index,
  tilt = false,
  brackets = true,
  accent = 'primary',
  tape,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
  index?: string;
  tilt?: boolean;
  brackets?: boolean;
  accent?: 'primary' | 'secondary' | 'tertiary';
  /** Optional washi-tape decal pinning a corner — the scrapbook touch. */
  tape?: TapeCorner;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const ring =
    accent === 'secondary'
      ? 'border-secondary/60'
      : accent === 'tertiary'
        ? 'border-tertiary/60'
        : 'border-primary/60';

  function onMove(e: React.MouseEvent) {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    el.style.setProperty('--mx', `${px}px`);
    el.style.setProperty('--my', `${py}px`);
    if (tilt && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.style.transform = `perspective(1000px) rotateX(${(py / r.height - 0.5) * -4}deg) rotateY(${(px / r.width - 0.5) * 4}deg)`;
    }
  }
  function onLeave() {
    if (ref.current) ref.current.style.transform = '';
  }

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className={cn(
        'spotlight group relative border border-border/70 bg-surface/30 backdrop-blur-md transition-[transform,border-color] duration-200 ease-out hover:border-border',
        tilt && '[transform-style:preserve-3d]',
        className,
      )}
    >
      {brackets && (
        <>
          <span className={cn('pointer-events-none absolute -left-px -top-px size-3.5 border-l-2 border-t-2', ring)} />
          <span className={cn('pointer-events-none absolute -right-px -top-px size-3.5 border-r-2 border-t-2', ring)} />
          <span className={cn('pointer-events-none absolute -bottom-px -left-px size-3.5 border-b-2 border-l-2', ring)} />
          <span className={cn('pointer-events-none absolute -bottom-px -right-px size-3.5 border-b-2 border-r-2', ring)} />
        </>
      )}
      {tape && <Tape corner={tape} size={64} className="z-10" />}
      {(label || index) && (
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          <span>{label}</span>
          {index && <span className="text-primary/70">{index}</span>}
        </div>
      )}
      {children}
    </div>
  );
}
