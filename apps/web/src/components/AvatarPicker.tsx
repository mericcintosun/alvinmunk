'use client';

import { FACE_IDS, faceSrc, type FaceId } from '@/lib/avatar';
import { cn } from '@/lib/utils';

/**
 * Pick-don't-build avatar selector — the 5 hand-drawn portrait stickers as a one-tap
 * choice (Kaan's onboarding rule: choose, never compose). Pairs with the deterministic
 * default so a passport always has a face even if the user skips this.
 */
export function AvatarPicker({
  value,
  onChange,
  size = 56,
  className,
}: {
  value?: FaceId;
  onChange: (id: FaceId) => void;
  size?: number;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Pick your passport face"
      className={cn('flex flex-wrap justify-center gap-2.5', className)}
    >
      {FACE_IDS.map((id) => {
        const active = value === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`Face ${id.replace('face-', '')}`}
            onClick={() => onChange(id)}
            style={{ width: size, height: size }}
            className={cn(
              'relative overflow-hidden rounded-full bg-surface-2 ring-2 transition-all',
              active
                ? 'scale-105 ring-lime'
                : 'ring-border/60 hover:scale-105 hover:ring-lime/50',
            )}
          >
            <img
              src={faceSrc(id)}
              alt=""
              draggable={false}
              className="absolute inset-0 h-full w-full select-none object-cover object-top"
            />
          </button>
        );
      })}
    </div>
  );
}
