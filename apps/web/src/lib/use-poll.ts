import { useCallback, useEffect, useRef } from 'react';

/**
 * Poll `fn` on an interval, with three guards that plain `setInterval` lacks:
 *
 *  1. **No overlap.** The next run is scheduled with `setTimeout` only after the
 *     current one settles, so a slow RFP call can never stack up with the next tick.
 *  2. **Pause while hidden.** No requests fire while `document.hidden`; one runs
 *     immediately when the tab becomes visible again.
 *  3. **Backoff on failure.** After consecutive failures the interval doubles,
 *     capped at 60 s, and resets on the first success.
 *
 * `fn` may return a promise; rejection counts as a failure. The hook returns
 * a manual `trigger` for callers that want to force a refresh.
 */

const MAX_BACKOFF = 60_000;

export function usePoll(fn: () => unknown | Promise<unknown>, intervalMs: number) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failures = useRef(0);
  const running = useRef(false);
  const generation = useRef(0);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const schedule = useCallback(
    (delay: number) => {
      clear();
      const my = generation.current;
      timer.current = setTimeout(() => {
        if (generation.current !== my) return;
        void tick();
      }, delay);
    },
    [clear],
  );

  const tick = useCallback(async () => {
    if (running.current) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    running.current = true;
    try {
      await fnRef.current();
      failures.current = 0;
    } catch {
      failures.current += 1;
    } finally {
      running.current = false;
    }
    if (typeof document !== 'undefined' && document.hidden) return;
    const backoff = Math.min(intervalMs * 2 ** failures.current, MAX_BACKOFF);
    schedule(backoff);
  }, [intervalMs, schedule]);

  useEffect(() => {
    generation.current += 1;
    const my = generation.current;
    const onVisibility = () => {
      if (generation.current !== my) return;
      if (document.hidden) {
        clear();
      } else {
        void tick();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    if (!document.hidden) void tick();
    return () => {
      generation.current += 1;
      document.removeEventListener('visibilitychange', onVisibility);
      clear();
    };
  }, [clear, tick]);

  return useCallback(() => {
    failures.current = 0;
    void tick();
  }, [tick]);
}
