import { useCallback, useEffect, useRef } from 'react';

/**
 * Poll `fn` on an interval, with three guarantees:
 *
 *  1. No overlap: the next run is scheduled with `setTimeout` only after the
 *     previous one settles, so a slow RFP call can never stack up.
 *  2. Pause while the tab is hidden; run once immediately when it becomes
 *     visible again.
 *  3. Back off (×2, capped at 60s) after consecutive failures, resetting on
 *     the first success.
 *
 * `fn` is read through a ref, so an inline closure does not restart the
 * schedule on every render.
 */
export const MAX_BACKOFF_MS = 60_000;

export interface UsePollOptions {
  /** Run once immediately on mount (default: true). */
  immediate?: boolean;
  /** Start in a paused state (default: false). */
  enabled?: boolean;
}

export function usePoll(fn: () => unknown | Promise<unknown>, intervalMs: number, options: UsePollOptions = {}): void {
  const { immediate = true, enabled = true } = options;

  const fnRef = useRef(fn);
  const intervalRef = useRef(intervalMs);
  const immediateRef = useRef(immediate);
  const enabledRef = useRef(enabled);

  // Keep the latest callback/config without restarting the schedule.
  fnE.current = fn;
  intervalRef.current = intervalMs;
  immediateRef.current = immediate;
  enabledRef.current = enabled;

  const runNow = useCallback(() => {
    // Schedule the next run only after this one settles.
    void (async () => {
      try {
        await fnRef.current();
      } catch {
        // The callee owns its error state; we just keep polling.
      }
    })();
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let cancelled = false;
    let running = false;

    const hidden = () => typeof document !== 'undefined' && document.hidden;

    const clear = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    };

    const delay = () => {
      const base = Math.max(1, intervalRef.current);
      if (failures === 0) return base;
      return Math.min(base * 2 ** failures, MAX_BACKOFF_MS);
    };

    const schedule = () => {
      if (cancelled || hidden()) return;
      clear();
      timer = setTimeout(tick, delay());
    };

    const tick = async () => {
      if (cancelled || running || hidden()) return;
      running = true;
      try {
        await fnRef.current();
        failures = 0;
      } catch {
        failures += 1;
      } finally {
        running = false;
        schedule();
      }
    };

    const onVisibility = () => {
      if (cancelled) return;
      if (hidden()) {
        // Pause: drop any pending run. An in-flight run finishes and then
        // `tick` will see `hidden()` and skip rescheduling.
        clear();
        return;
      }
      // Visible again: run once now (unless one is already in flight).
      if (!running) {
        clear();
        void tick();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);

    // Only start if visible; otherwise wait for the visibility event.
    if (!hidden()) {
      if (immediateRef.current) {
        void tick();
      } else {
        schedule();
      }
    }

    return () => {
      cancelled = true;
      clear();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, runNow]);
}
