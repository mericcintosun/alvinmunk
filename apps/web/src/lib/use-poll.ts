import { useEffect, useRef } from 'react';

/** The longest a failing poll backs off to (unless `intervalMs` is already longer). */
export const MAX_BACKOFF_MS = 60_000;

/**
 * Run `fn` now and then every `intervalMs` while the tab is visible (#210):
 *
 *  1. No overlap: the next run is scheduled with `setTimeout` only after the current one
 *     settles, so a slow RPC call never stacks a second request on top of it.
 *  2. Paused while `document.hidden`; one run as soon as the tab is visible again.
 *  3. A run that throws or rejects backs the next one off ×2 per consecutive failure, up to
 *     MAX_BACKOFF_MS; the first success resets it. So `fn` must rethrow a failure it handles.
 *
 * `fn` gets an AbortSignal that aborts when the poll stops (unmount, or a new `intervalMs` or
 * `key`), so a run that finishes late can skip its state updates. `fn` is read through a ref,
 * so an inline closure does not restart the schedule; changing `key` does, with an immediate
 * run (the stats page passes its network tab).
 */
export function usePoll(
  fn: (signal: AbortSignal) => unknown,
  intervalMs: number,
  key?: unknown,
): void {
  const fnRef = useRef(fn);
  // Declared before the polling effect, so it has run by the time that effect first calls `fn`.
  useEffect(() => {
    fnRef.current = fn;
  });

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    let failures = 0;

    const clear = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    const delay = () =>
      failures === 0
        ? intervalMs
        : Math.min(intervalMs * 2 ** failures, Math.max(intervalMs, MAX_BACKOFF_MS));

    const run = async () => {
      clear();
      if (running || controller.signal.aborted || document.hidden) return;
      running = true;
      try {
        await fnRef.current(controller.signal);
        failures = 0;
      } catch {
        failures += 1;
      }
      running = false;
      // Hidden by now: stay paused until the tab is visible again (`onVisibility` runs it).
      if (!controller.signal.aborted && !document.hidden) timer = setTimeout(run, delay());
    };

    const onVisibility = () => {
      if (document.hidden) clear();
      else void run();
    };

    document.addEventListener('visibilitychange', onVisibility);
    void run();
    return () => {
      controller.abort();
      clear();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs, key]);
}
