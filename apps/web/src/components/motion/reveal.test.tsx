import { readFileSync } from 'node:fs';
import { act, useContext } from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot, type Root } from 'react-dom/client';
import { MotionConfigContext } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Reveal } from './reveal';
import { MotionProvider } from './motion-provider';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** One `(prefers-reduced-motion)` query whose answer the test flips, like the OS setting. */
const reduceQuery = {
  matches: false,
  listeners: new Set<() => void>(),
  addEventListener(_: string, fn: () => void) {
    this.listeners.add(fn);
  },
  removeEventListener(_: string, fn: () => void) {
    this.listeners.delete(fn);
  },
};

/** Reports every observed element as on screen, so `whileInView` fires. */
class OnScreenObserver {
  constructor(private callback: IntersectionObserverCallback) {}
  observe(target: Element) {
    queueMicrotask(() =>
      this.callback(
        [{ isIntersecting: true, target } as unknown as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      ),
    );
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

const tree = (
  <MotionProvider>
    <Reveal className="hero">Stellar Passport</Reveal>
  </MotionProvider>
);

describe('Reveal under prefers-reduced-motion', () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) =>
      query.includes('prefers-reduced-motion')
        ? reduceQuery
        : { matches: false, addEventListener() {}, removeEventListener() {} },
    );
    vi.stubGlobal('IntersectionObserver', OnScreenObserver);
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    root = undefined;
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('hydrates the server HTML without a mismatch and ends fully visible', async () => {
    // The server never knows the setting, so it renders the hidden start state.
    reduceQuery.matches = false;
    container.innerHTML = renderToString(tree);
    const node = container.querySelector<HTMLElement>('.hero')!;
    expect(node.style.opacity).toBe('0');

    // The visitor's browser has Reduce Motion on.
    reduceQuery.matches = true;
    reduceQuery.listeners.forEach((fn) => fn());

    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => {
      root = hydrateRoot(container, tree);
    });

    expect(container.querySelector('.hero')).toBe(node);
    await vi.waitFor(() => expect(node.style.opacity).toBe('1'), { timeout: 3000 });
    expect(node.style.transform).not.toContain('18px');
    // React leaves mismatched server attributes in place, so a mismatch is the bug itself.
    expect(errors).not.toHaveBeenCalled();
  });
});

describe('MotionProvider', () => {
  it('tells motion to follow the OS reduce-motion setting', () => {
    function Probe() {
      return <span>{useContext(MotionConfigContext).reducedMotion}</span>;
    }
    expect(
      renderToString(
        <MotionProvider>
          <Probe />
        </MotionProvider>,
      ),
    ).toContain('user');
  });

  it('wraps every page from the root layout', () => {
    const layout = read('../../app/layout.tsx');
    expect(layout).toContain(
      "import { MotionProvider } from '@/components/motion/motion-provider';",
    );
    expect(layout).toMatch(
      /<MotionProvider>[\s\S]*<main[\s\S]*\{children\}[\s\S]*<\/MotionProvider>/,
    );
  });
});
