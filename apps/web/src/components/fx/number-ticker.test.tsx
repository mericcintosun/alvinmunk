import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('motion/react', () => ({ useInView: () => true }));

import { NumberTicker } from './number-ticker';

type QueuedFrame = { id: number; callback: FrameRequestCallback };

describe('NumberTicker', () => {
  let container: HTMLDivElement;
  let root: Root;
  let frames: QueuedFrame[];
  let nextFrameId: number;
  let reduceMotion: boolean;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    frames = [];
    nextFrameId = 1;
    reduceMotion = false;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      frames.push({ id, callback });
      return id;
    });
    // A real cancelAnimationFrame removes the callback from the queue so it never fires;
    // a bare vi.fn() stub would leave it queued and let a "canceled" tick run anyway.
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      frames = frames.filter((f) => f.id !== id);
    });
    vi.stubGlobal('matchMedia', () => ({ matches: reduceMotion }));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function renderedValue() {
    return container.querySelector('span')?.textContent ?? '';
  }

  function render(value: number, decimals = 0) {
    act(() => {
      root.render(<NumberTicker value={value} durationMs={1000} decimals={decimals} />);
    });
  }

  function runFrame(timestamp: number) {
    const frame = frames.shift();
    expect(frame).toBeDefined();
    act(() => frame?.callback(timestamp));
  }

  it('animates its first in-view appearance from zero to the requested value', () => {
    render(5);
    runFrame(0);
    expect(renderedValue()).toBe('0');
    runFrame(1000);
    expect(renderedValue()).toBe('5');
  });

  it('animates updates from the completed value without resetting through zero', () => {
    render(5);
    runFrame(0);
    runFrame(1000);

    render(4);
    runFrame(2000);
    expect(renderedValue()).toBe('5');
    runFrame(2500);
    expect(renderedValue()).not.toBe('0');
    expect(Number(renderedValue())).toBeGreaterThan(0);
    runFrame(3000);
    expect(renderedValue()).toBe('4');
  });

  it('does not jump backward when a second update interrupts the first mid-flight', () => {
    // decimals=2 so the fractional mid-animation value survives toLocaleString rounding.
    render(5, 2);
    runFrame(0);
    runFrame(1000); // settles at 5.00

    render(4, 2); // 5 -> 4
    runFrame(2000); // start
    runFrame(2500); // halfway-ish, still animating toward 4 — well below 5
    const midFlight = Number(renderedValue());
    expect(midFlight).toBeLessThan(5);
    expect(midFlight).toBeGreaterThan(4);

    render(6, 2); // interrupt again before the 5 -> 4 animation completes: 4-target -> 6-target
    runFrame(3000); // first frame of the new animation

    // The new animation must continue from wherever it visually was (~midFlight), not
    // snap back to the old completed value (5) before easing toward 6.
    const afterInterrupt = Number(renderedValue());
    expect(afterInterrupt).not.toBe(5);
    expect(Math.abs(afterInterrupt - midFlight)).toBeLessThan(1);

    runFrame(4000); // finishes the 6 animation
    expect(renderedValue()).toBe('6.00');
  });

  it('cancels the in-flight animation frame on unmount, so it can never call setState later', () => {
    render(5);
    runFrame(0); // mid-flight: this tick already queued the next one
    expect(frames).toHaveLength(1);

    act(() => root.unmount());

    // The pending frame must actually be removed from the queue, not merely ignored —
    // an unmounted component's tick has nothing left to update.
    expect(frames).toHaveLength(0);
  });

  it('snaps under reduced motion and uses the snapped value for later animations', () => {
    reduceMotion = true;
    render(5);
    expect(renderedValue()).toBe('5');
    expect(frames).toHaveLength(0);

    reduceMotion = false;
    render(4);
    runFrame(2000);
    expect(renderedValue()).toBe('5');
    runFrame(3000);
    expect(renderedValue()).toBe('4');
  });
});
