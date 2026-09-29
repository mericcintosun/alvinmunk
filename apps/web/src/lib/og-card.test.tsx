import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// og-card.tsx relies on Next's automatic JSX runtime; this vitest setup compiles JSX to
// `React.createElement`, so give that module a global React to resolve.
(globalThis as { React?: typeof React }).React = React;

const resolveHandleMock = vi.fn();
const getMetaMock = vi.fn();

vi.mock('./registry', () => ({
  resolveHandle: (...a: unknown[]) => resolveHandleMock(...a),
  getMeta: (...a: unknown[]) => getMetaMock(...a),
}));
vi.mock('./reputation', () => ({ getScores: async () => ({ social: 40, earned: 7 }) }));
vi.mock('./constellation', () => ({ getPeopleCounts: async () => ({ vouchedBy: 3, backed: 2 }) }));

import { ogResolve, ogCard, handleFontSize, type OgScores } from './og-card';
import { loadPng } from './og-assets';
import { defaultAvatarId, faceFile, kitFile, type KitAvatar } from './avatar';

const G = 'G'.padEnd(56, 'B');
const scores: OgScores = { social: 40, earned: 7, vouchedBy: 3, backed: 2 };

function render(el: JSX.Element): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(el), 'text/html');
}
const srcs = (doc: Document) => [...doc.querySelectorAll('img')].map((i) => i.getAttribute('src'));

describe('handleFontSize', () => {
  it('returns max size for short handles (acceptance criteria: 3, 12 chars)', () => {
    expect(handleFontSize(3)).toBe(76);
    expect(handleFontSize(12)).toBe(76);
  });

  it('scales down for medium handles (acceptance criteria: 20 chars)', () => {
    // At 20 chars: (20-12)/(32-12) = 0.4, so 76 - 0.4*(76-40) = 76 - 14.4 = 61.6
    expect(handleFontSize(20)).toBeCloseTo(61.6, 1);
  });

  it('returns min size for very long handles (acceptance criteria: 32 chars)', () => {
    expect(handleFontSize(32)).toBe(40);
  });

  it('handles edge cases', () => {
    expect(handleFontSize(1)).toBe(76);
    expect(handleFontSize(100)).toBe(40);
  });
});

describe('ogResolve', () => {
  beforeEach(() => {
    resolveHandleMock.mockReset();
    getMetaMock.mockReset();
  });

  it('returns the published face and bio with the scores', async () => {
    const avatar = { kind: 'face', id: 'face-04' };
    resolveHandleMock.mockResolvedValueOnce(G);
    getMetaMock.mockResolvedValueOnce({ avatar, bio: 'hello' });
    await expect(ogResolve('alice')).resolves.toEqual({ address: G, scores, avatar, bio: 'hello' });
    expect(getMetaMock).toHaveBeenCalledWith(G);
  });

  it('falls back to no face and no bio when there is no profile (or no get_meta)', async () => {
    resolveHandleMock.mockResolvedValueOnce(G);
    getMetaMock.mockResolvedValueOnce(null);
    await expect(ogResolve('alice')).resolves.toMatchObject({
      address: G,
      avatar: undefined,
      bio: '',
    });
  });

  it('never asks for a profile when the handle is unclaimed', async () => {
    resolveHandleMock.mockResolvedValueOnce(null);
    await expect(ogResolve('free')).resolves.toMatchObject({ address: null, bio: '' });
    expect(getMetaMock).not.toHaveBeenCalled();
  });
});

describe('ogCard', () => {
  it('shows the published face sticker', () => {
    const doc = render(
      ogCard({ handle: 'alice', address: G, scores, avatar: { kind: 'face', id: 'face-04' } }),
    );
    expect(srcs(doc)).toEqual([loadPng(faceFile('face-04')).uri]);
  });

  it('shows the deterministic default face without a published one', () => {
    const doc = render(ogCard({ handle: 'alice', address: G, scores }));
    expect(srcs(doc)).toEqual([loadPng(faceFile(defaultAvatarId(G))).uri]);
  });

  it('composes a remixed kit face from its layers, bg first', () => {
    const kit: KitAvatar = { kind: 'kit', skin: 2, hair: 5, eyes: 3, mouth: 9, acc: null, bg: 4 };
    const doc = render(ogCard({ handle: 'alice', address: G, scores, avatar: kit }));
    expect(srcs(doc)).toEqual(
      [
        kitFile('bg', 4),
        kitFile('skin', 2),
        kitFile('hair', 5),
        kitFile('eyes', 3),
        kitFile('mouth', 9),
      ].map((f) => loadPng(f).uri),
    );
    // every layer gets an explicit box (Satori can't size or center them itself)
    for (const img of doc.querySelectorAll('img')) {
      expect(Number(img.getAttribute('width'))).toBeGreaterThan(0);
      expect(Number(img.getAttribute('height'))).toBeGreaterThan(0);
    }
  });

  it('prints the bio as plain text, never markup', () => {
    const bio = '<img src=x onerror=alert(1)> & friends';
    const doc = render(ogCard({ handle: 'alice', address: G, scores, bio }));
    expect(doc.body.textContent).toContain(bio);
    expect(srcs(doc)).toHaveLength(1); // only the face — the bio's <img> stayed text
  });

  it('shows no face and no bio for an unclaimed handle', () => {
    const doc = render(ogCard({ handle: 'free', address: null, scores, bio: 'stale' }));
    expect(srcs(doc)).toEqual([]);
    expect(doc.body.textContent).not.toContain('stale');
  });
});

describe('loadPng', () => {
  it('reads the intrinsic size from the PNG header', () => {
    expect(loadPng(faceFile('face-01'))).toMatchObject({ w: 148, h: 189 });
  });
});
