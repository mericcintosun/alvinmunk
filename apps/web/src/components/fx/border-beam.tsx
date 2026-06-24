'use client';

import { cn } from '@/lib/utils';

/**
 * Border beam (Magic-UI style) — a light particle that travels around a rounded border
 * via `offset-path`. Drop into any `relative` rounded container to mark it as live
 * (primary CTAs, the hero card). Pure CSS animation (`animate-border-beam`), no deps.
 */
export function BorderBeam({
  size = 64,
  duration = 7,
  delay = 0,
  colorFrom = 'hsl(var(--primary))',
  colorTo = 'hsl(var(--secondary))',
  className,
}: {
  size?: number;
  duration?: number;
  delay?: number;
  colorFrom?: string;
  colorTo?: string;
  className?: string;
}) {
  return (
    <div
      className="pointer-events-none absolute inset-0 rounded-[inherit]"
      style={{
        border: '1px solid transparent',
        WebkitMask: 'linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0)',
        WebkitMaskComposite: 'xor',
        maskComposite: 'exclude',
      }}
    >
      <div
        className={cn('absolute aspect-square animate-border-beam', className)}
        style={{
          width: size,
          offsetPath: `rect(0 auto auto 0 round ${size}px)`,
          background: `linear-gradient(to left, ${colorFrom}, ${colorTo}, transparent)`,
          animationDelay: `${delay}s`,
          // consumed by the tailwind keyframe (animation: border-beam var(--beam-duration))
          ['--beam-duration' as string]: `${duration}s`,
        }}
      />
    </div>
  );
}
