import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_BACKOFF_MS, usePoll } from './use-poll';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type PollFn = (signal: AbortSignal) => unknown;

function Harness({ fn, ms, pollKey }: { fn: PollFn; ms: number; pollKey?: unknown }) {
  usePoll(fn, ms, pollKey);
  return null;
}

let root: Root;
let container: HTMLDivElement;

function render(fn: PollFn, ms: number, pollKey?: unknown) {
  act(() => root.render(createElement(Harness, { fn, ms, pollKey })));
}

/** Advance fake time, letting each run's promise settle before the next timer fires. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

/** A run that stays in flight until `resolve`/`reject` is called. */
function deferred() {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (document as { hidden?: boolean }).hidden;
  vi.useRealTimers();
});

describe('usePoll', () => {
  it('runs once on mount, then every interval', async () => {
    const fn = vi.fn();
    render(fn, 5000);
    expect(fn).toHaveBeenCalledTimes(1);

    await advance(4999);
    expect(fn).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fn).toHaveBeenCalledTimes(2);
    await advance(5000);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('never overlaps a slow run: the next one waits for it to settle', async () => {
    const slow = deferred();
    const fn = vi.fn().mockReturnValueOnce(slow.promise);
    render(fn, 5000);

    await advance(30_000); // the first run is still in flight
    expect(fn).toHaveBeenCalledTimes(1);

    slow.resolve();
    await advance(0);
    await advance(4999);
    expect(fn).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not start a second run when the tab returns while one is in flight', async () => {
    const slow = deferred();
    const fn = vi.fn().mockReturnValueOnce(slow.promise);
    render(fn, 5000);

    setHidden(true);
    setHidden(false);
    await advance(0);
    expect(fn).toHaveBeenCalledTimes(1);

    slow.resolve();
    await advance(5000);
    expect(fn).toHaveBeenCalledTimes(2);
    await advance(4999);
    expect(fn).toHaveBeenCalledTimes(2); // still one schedule
  });

  it('fires nothing while the tab is hidden, and once when it is visible again', async () => {
    const fn = vi.fn();
    render(fn, 5000);
    expect(fn).toHaveBeenCalledTimes(1);

    setHidden(true);
    await advance(60_000);
    expect(fn).toHaveBeenCalledTimes(1);

    setHidden(false);
    await advance(0);
    expect(fn).toHaveBeenCalledTimes(2);
    await advance(5000);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not reschedule a run that finishes after the tab was hidden', async () => {
    const slow = deferred();
    const fn = vi.fn().mockReturnValueOnce(slow.promise);
    render(fn, 5000);

    setHidden(true);
    slow.resolve();
    await advance(60_000);
    expect(fn).toHaveBeenCalledTimes(1);

    setHidden(false);
    await advance(0);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('waits for the tab to be visible before the first run', async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    const fn = vi.fn();
    render(fn, 5000);
    await advance(60_000);
    expect(fn).not.toHaveBeenCalled();

    setHidden(false);
    await advance(0);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('backs off x2 per consecutive failure, up to 60 s, and resets on success', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('rpc down'));
    render(fn, 5000); // run 1 fails at t=0
    const callsAfter = async (ms: number) => {
      await advance(ms);
      return fn.mock.calls.length;
    };

    expect(await callsAfter(9999)).toBe(1); // backoff 10 s
    expect(await callsAfter(1)).toBe(2); // run 2 fails
    expect(await callsAfter(19_999)).toBe(2); // backoff 20 s
    expect(await callsAfter(1)).toBe(3); // run 3 fails
    expect(await callsAfter(40_000)).toBe(4); // backoff 40 s, run 4 fails
    expect(await callsAfter(MAX_BACKOFF_MS - 1)).toBe(4); // capped: 60 s, not 80 s
    expect(await callsAfter(1)).toBe(5); // run 5 fails
    expect(await callsAfter(MAX_BACKOFF_MS)).toBe(6); // still capped

    fn.mockResolvedValue(undefined);
    expect(await callsAfter(MAX_BACKOFF_MS)).toBe(7); // succeeds: back to 5 s
    expect(await callsAfter(5000)).toBe(8);
  });

  it('treats a synchronous throw as a failure too', async () => {
    const fn = vi.fn(() => {
      throw new Error('boom');
    });
    render(fn, 5000);
    await advance(5000);
    expect(fn).toHaveBeenCalledTimes(1); // backed off to 10 s
    await advance(5000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('uses the latest callback without restarting the schedule', async () => {
    const first = vi.fn();
    const second = vi.fn();
    render(first, 5000);
    render(second, 5000);
    expect(second).not.toHaveBeenCalled(); // no immediate re-run on a re-render

    await advance(5000);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('restarts with an immediate run when the key changes, aborting the old run', async () => {
    const slow = deferred();
    const fn = vi.fn().mockReturnValueOnce(slow.promise);
    render(fn, 10_000, 'testnet');
    const firstSignal = fn.mock.calls[0][0] as AbortSignal;

    render(fn, 10_000, 'mainnet');
    expect(firstSignal.aborted).toBe(true);
    expect(fn).toHaveBeenCalledTimes(2); // the new key runs at once, not after the old run

    slow.resolve();
    await advance(10_000);
    expect(fn).toHaveBeenCalledTimes(3); // one schedule: the aborted run did not add its own
  });

  it('stops polling and aborts on unmount', async () => {
    const fn = vi.fn();
    render(fn, 5000);
    const signal = fn.mock.calls[0][0] as AbortSignal;

    act(() => root.unmount());
    expect(signal.aborted).toBe(true);
    await advance(60_000);
    setHidden(false);
    expect(fn).toHaveBeenCalledTimes(1);

    root = createRoot(container); // for afterEach
  });
});
