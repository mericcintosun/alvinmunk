'use client';

import { useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Spotlight + tilt card (Magic-UI style) — a glass surface that tracks the cursor,
 * lifts a violet→cyan glow under it, AND tilts in 3D toward the pointer with a soft
 * border/shadow glow. The brand's interactive card primitive: every flat box becomes
 * alive. Pure CSS + a pointer listener (reduced-motion skips the tilt), no deps.
 */
export function MagicCard({
  children,
  className,
  tilt = true,
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  tilt?: boolean;
  as?: 'div' | 'section' | 'li';
}) {
  const ref = useRef<HTMLDivElement>(null);

  function onMove(e: React.MouseEvent) {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    el.style.setProperty('--mx', `${px}px`);
    el.style.setProperty('--my', `${py}px`);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (tilt && !reduce) {
      const rx = (py / r.height - 0.5) * -6;
      const ry = (px / r.width - 0.5) * 6;
      el.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg)`;
    }
  }

  function onLeave() {
    const el = ref.current;
    if (el) el.style.transform = 'perspective(900px) rotateX(0deg) rotateY(0deg)';
  }

  return (
    <Tag
      ref={ref as never}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className={cn(
        'spotlight glass group relative overflow-hidden rounded-2xl [transform-style:preserve-3d] transition-[transform,border-color,box-shadow] duration-200 ease-out hover:border-primary/35 hover:shadow-[0_0_44px_-12px_hsl(var(--primary)/0.45)]',
        className,
      )}
    >
      {children}
    </Tag>
  );
}
