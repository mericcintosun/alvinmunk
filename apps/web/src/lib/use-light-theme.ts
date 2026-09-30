import { useEffect, useState } from 'react';

/** True while `html.light` is set (the root layout's pre-paint script and the theme toggle set it). */
export function isLightTheme(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('light');
}

/**
 * Live light/dark theme for canvases that can't read CSS variables. Observes the `class` on
 * `<html>`, so the theme toggle and OS-driven switches repaint the sky without a reload.
 */
export function useLightTheme(): boolean {
  const [light, setLight] = useState(isLightTheme);

  useEffect(() => {
    const sync = () => setLight(isLightTheme());
    sync();
    if (typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return light;
}
