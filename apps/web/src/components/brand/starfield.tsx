import { cn } from '@/lib/utils';

// Deterministic star field (SSR-safe — fixed coordinates, no Math.random at render).
const STARS = [
  [6, 12, 1], [14, 30, 0.7], [22, 8, 1.3], [31, 22, 0.8], [38, 44, 1], [9, 58, 0.9],
  [17, 74, 1.2], [27, 88, 0.7], [44, 16, 0.8], [52, 36, 1.1], [61, 9, 0.9], [69, 28, 1.3],
  [77, 14, 0.7], [84, 40, 1], [92, 22, 0.8], [58, 60, 1.2], [66, 78, 0.9], [73, 52, 0.7],
  [81, 70, 1.1], [89, 86, 0.8], [48, 82, 1], [36, 66, 0.7], [12, 92, 0.9], [95, 56, 1.2],
  [3, 40, 0.8], [25, 50, 1], [42, 92, 0.7], [54, 18, 0.9], [88, 8, 1.1], [70, 94, 0.8],
] as const;

/** Fixed cosmic backdrop — nebula glow + a sprinkling of twinkling stars. */
export function Starfield({ className }: { className?: string }) {
  return (
    <div className={cn('pointer-events-none fixed inset-0 -z-10 nebula', className)} aria-hidden>
      <svg className="h-full w-full" preserveAspectRatio="xMidYMid slice" viewBox="0 0 100 100">
        {STARS.map(([x, y, r], i) => (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={r * 0.18}
            fill="hsl(var(--starlight))"
            className="motion-safe:animate-twinkle"
            style={{ animationDelay: `${(i % 7) * 0.6}s`, opacity: 0.6 }}
          />
        ))}
      </svg>
    </div>
  );
}
