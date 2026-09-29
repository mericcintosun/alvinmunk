// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../public');
const source = readFileSync(resolve(publicDir, 'sw.js'), 'utf-8');

/** Evaluate public/sw.js against a stub worker global and return its event listeners. */
function loadWorker() {
  const listeners: Record<string, (event: unknown) => void> = {};
  const self = {
    location: { origin: 'https://alvinmunk.test' },
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      listeners[type] = fn;
    },
    skipWaiting: vi.fn(() => Promise.resolve()),
    clients: { claim: vi.fn(() => Promise.resolve()) },
    registration: { showNotification: vi.fn((_title: string, _options: unknown) => Promise.resolve()) },
  };
  new Function('self', 'clients', 'caches', 'fetch', source)(self, self.clients, {}, vi.fn());
  return { self, listeners };
}

/** Width x height from a PNG's IHDR chunk. */
function pngSize(file: string): string {
  const png = readFileSync(file);
  return `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;
}

describe('service worker asset references', () => {
  const assetPaths = Array.from(source.matchAll(/\/assets\/[\w./-]+/g)).map((m) => m[0]);

  it('references at least one asset', () => {
    expect(assetPaths.length).toBeGreaterThan(0);
  });

  it('every /assets/... path resolves to a real file', () => {
    for (const p of assetPaths) {
      const filePath = resolve(publicDir, p.replace(/^\//, ''));
      expect(existsSync(filePath), `${p} should exist under public/`).toBe(true);
    }
  });
});

describe('service worker', () => {
  it('skips waiting on install, so an update does not wait for every tab to close', () => {
    const { self, listeners } = loadWorker();
    expect(listeners.install).toBeTypeOf('function');
    listeners.install({ waitUntil: vi.fn() });
    expect(self.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it('brands the vouch-claimed notification with the 192px icon and the 96px badge', () => {
    const { self, listeners } = loadWorker();
    listeners.push({ data: { json: () => ({ vouchId: 7 }) }, waitUntil: vi.fn() });
    expect(self.registration.showNotification).toHaveBeenCalledTimes(1);
    const options = self.registration.showNotification.mock.calls[0][1] as { icon: string; badge: string };

    for (const [path, size] of [
      [options.icon, '192x192'],
      [options.badge, '96x96'],
    ]) {
      expect(path).toMatch(/^\/assets\/.+\.png$/);
      const file = resolve(publicDir, path.slice(1));
      expect(existsSync(file), `${path} should exist under public/`).toBe(true);
      expect(pngSize(file), path).toBe(size);
    }
  });
});
