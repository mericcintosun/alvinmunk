import { stampArt } from '@passport/shared';
import { cn } from '@/lib/utils';

/**
 * The Crest — a deterministic personal **constellation** derived from a wallet address.
 * Stars at each vertex, faintly connected; the brand's avatar and identity mark.
 * "Collect people, not points" — your constellation grows with your network.
 * Shape (vertex count) carries signal independent of color (a11y).
 */
export function Crest({
  address,
  handle,
  size = 96,
  points: pointCount = 7,
  animate = false,
  className,
}: {
  address: string;
  handle?: string;
  size?: number;
  points?: number;
  animate?: boolean;
  className?: string;
}) {
  const dna = stampArt(address || 'passport', pointCount);
  const stars = dna.points.split(' ').map((p) => {
    const [x, y] = p.split(',').map(Number);
    return { x, y };
  });
  const polyline = [...stars, stars[0]].map((s) => `${s.x},${s.y}`).join(' ');

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label={`Constellation crest${handle ? ` for @${handle}` : ''} — ${dna.vertices} stars`}
      className={cn('overflow-visible', animate && 'motion-safe:animate-breathe', className)}
    >
      <defs>
        <radialGradient id={`glow-${dna.seed}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.35" />
          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="46" fill={`url(#glow-${dna.seed})`} />
      {/* faint connecting lines — the constellation */}
      <polyline
        points={polyline}
        fill="none"
        stroke="hsl(var(--starlight))"
        strokeOpacity="0.25"
        strokeWidth="0.75"
        strokeLinejoin="round"
      />
      {/* the stars */}
      {stars.map((s, i) => (
        <circle
          key={i}
          cx={s.x}
          cy={s.y}
          r={i === 0 ? 3.2 : 2.1}
          fill={i === 0 ? 'hsl(var(--primary))' : 'hsl(var(--starlight))'}
          className={animate ? 'motion-safe:animate-twinkle' : undefined}
          style={animate ? { animationDelay: `${(i * 0.4).toFixed(1)}s` } : undefined}
        />
      ))}
    </svg>
  );
}
