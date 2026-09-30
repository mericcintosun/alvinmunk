/**
 * Page scroll lock for modal dialogs (#489). It is counted, so a dialog opened over another
 * only releases the page when the last one closes. Locking hides the body's own overflow
 * (native scroll, e.g. under reduced motion, where Lenis is off) and tells SmoothScroll to
 * pause Lenis, which otherwise keeps turning wheel and touch input into page scroll behind
 * the modal.
 */
export const SCROLL_LOCK_EVENT = 'alvinmunk:scroll-lock';

let locks = 0;
let savedOverflow = '';

export function isScrollLocked(): boolean {
  return locks > 0;
}

/** Locks the page; returns the matching unlock (calling it more than once is a no-op). */
export function lockScroll(): () => void {
  if (locks++ === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.dispatchEvent(new Event(SCROLL_LOCK_EVENT));
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--locks === 0) {
      document.body.style.overflow = savedOverflow;
      window.dispatchEvent(new Event(SCROLL_LOCK_EVENT));
    }
  };
}
