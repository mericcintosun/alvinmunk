'use client';

import { stampArt } from '@alvinmunk/shared';
import { Avatar } from '@/components/Avatar';

/**
 * alvinmunk Cover + Genesis Stamp (Sprint 1). Deterministic generative crest from the
 * wallet address — every profile is unique from second one. The first screenshot-able
 * artifact. Shape (vertex count) carries signal independent of color for a11y.
 */
export function GenesisStamp({
  address,
  handle,
  joinedAt,
}: {
  address: string;
  handle: string;
  joinedAt: number;
}) {
  const dna = stampArt(address);
  const date = new Date(joinedAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <figure
      className="relative aspect-[1.6/1] w-full overflow-hidden rounded-2xl border border-white/10 shadow-2xl"
      style={{ background: `linear-gradient(135deg, hsl(${dna.hue} 70% 18%), hsl(${dna.hue2} 70% 12%))` }}
      aria-label={`Genesis profile stamp for ${handle}, a ${dna.vertices}-point sigil`}
    >
      <svg viewBox="0 0 100 100" className="absolute right-3 top-3 h-20 w-20 opacity-90" role="img">
        <circle cx="50" cy="50" r="30" fill={`hsl(${dna.hue} 90% 60%)`} opacity="0.5" />
        <polygon
          points={dna.points}
          fill="none"
          stroke={`hsl(${dna.hue2} 95% 70%)`}
          strokeWidth="2"
        />
      </svg>

      <figcaption className="absolute inset-0 flex flex-col justify-between p-4">
        <span className="text-[11px] uppercase tracking-widest text-white/40">
          alvinmunk
        </span>
        <div className="flex items-center gap-3">
          <Avatar address={address} handle={handle} size={48} />
          <div>
            <div className="text-lg font-semibold">@{handle}</div>
            <div className="text-xs text-white/50">
              joined {date} · {address.slice(0, 4)}…{address.slice(-4)}
            </div>
          </div>
        </div>
      </figcaption>
    </figure>
  );
}
