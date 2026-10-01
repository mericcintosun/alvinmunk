import React from 'react';
import { cn } from '@/lib/utils';
import { STATE, asset, type StateKind } from '@/lib/assets';

/**
 * An illustrated state moment (success / empty). Rendered at or below intrinsic size so
 * it never upscales. `size` is the max rendered WIDTH. Loads lazily and decodes off the
 * main thread; pass `priority` for above-the-fold art. Decorative by default (alt="").
 */
export function StateArt({
  kind,
  size = 220,
  priority = false,
  alt = '',
  className,
}: {
  kind: StateKind;
  size?: number;
  priority?: boolean;
  alt?: string;
  className?: string;
}) {
  const m = STATE[kind];
  const width = Math.min(size, m.w);
  const height = Math.round((width / m.w) * m.h);
  return (
    <img
      src={asset(m.file)}
      alt={alt}
      width={width}
      height={height}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      draggable={false}
      aria-hidden={alt === '' ? true : undefined}
      className={cn('select-none', className)}
    />
  );
}
