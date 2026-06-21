'use client';

import { stampArt } from '@passport/shared';

/**
 * The half-card — Stellar Passport's core viral artifact (00-strategy §3).
 * One side filled (the voucher), the other a glowing empty socket until claimed.
 * The sigil is deterministic generative art seeded from the wallet address
 * (shared `stampArt`, the engine locked at White belt).
 */
export function VouchCard({
  fromHandle,
  toHandle,
  note,
  seedAddress,
}: {
  fromHandle: string;
  toHandle: string | null; // null => unclaimed "empty socket"
  note: string;
  seedAddress: string;
}) {
  const art = stampArt(seedAddress);
  const claimed = toHandle !== null;

  return (
    <div
      className="relative aspect-[1.6/1] w-full overflow-hidden rounded-2xl border border-white/10 shadow-2xl"
      style={{
        background: `linear-gradient(135deg, hsl(${art.hue} 70% 18%), hsl(${art.hue2} 70% 12%))`,
      }}
    >
      {/* generative sigil */}
      <svg viewBox="0 0 100 100" className="absolute right-2 top-2 h-16 w-16 opacity-80" role="img">
        <circle cx="50" cy="50" r="30" fill={`hsl(${art.hue} 90% 60%)`} opacity="0.5" />
        <polygon
          points={art.points}
          fill="none"
          stroke={`hsl(${art.hue2} 95% 70%)`}
          strokeWidth="2"
        />
      </svg>

      <div className="absolute inset-0 flex flex-col justify-between p-4">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold">@{fromHandle}</span>
          <span className="text-white/40">×</span>
          <span className={claimed ? 'font-semibold' : 'text-white/30'}>
            {claimed ? `@${toHandle}` : 'claim your side →'}
          </span>
        </div>

        <p className="text-sm leading-snug text-white/80">“{note}”</p>

        {!claimed && (
          <div className="absolute inset-y-0 right-0 w-1/2 animate-pulse rounded-r-2xl bg-sigil/10 ring-1 ring-inset ring-sigil/30" />
        )}
      </div>
    </div>
  );
}
