'use client';

import { useEffect } from 'react';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import { SCROLL_LOCK_EVENT, isScrollLocked } from '@/lib/scroll-lock';

/**
 * Apple-style inertial smooth scroll (Lenis). Disabled under prefers-reduced-motion
 * (native scroll). Renders nothing — it just drives the scroll engine via rAF. Paused while
 * a modal holds the scroll lock (lib/scroll-lock), so the page never scrolls behind it.
 */
export function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const lenis = new Lenis({
      lerp: 0.1,
      smoothWheel: true,
      wheelMultiplier: 1,
      touchMultiplier: 1.4,
    });
    const syncLock = () => (isScrollLocked() ? lenis.stop() : lenis.start());
    window.addEventListener(SCROLL_LOCK_EVENT, syncLock);
    syncLock(); // a dialog may already be open

    let raf = 0;
    const loop = (time: number) => {
      lenis.raf(time);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener(SCROLL_LOCK_EVENT, syncLock);
      lenis.destroy();
    };
  }, []);

  return null;
}
