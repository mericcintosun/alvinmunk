'use client';

import dynamic from 'next/dynamic';

// Client island: keeps three.js out of SSR + the RSC marketing bundle (Lighthouse).
const Backdrop = dynamic(() => import('./constellation-backdrop'), { ssr: false });

export function HeroBackdrop({ className }: { className?: string }) {
  return (
    <div className={className} aria-hidden>
      <Backdrop />
    </div>
  );
}
