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

import { ogResolve, ogCard, claimCard, claimNameSize, handleFontSize, siteCard, type OgScores } from './og-card';
import { shortAddr, stampArt } from '@alvinmunk/shared';
import { loadPng } from './og-assets';
import { FACE_IDS, defaultAvatarId, faceFile, kitFile, type KitAvatar } from './avatar';

const G = 'G'.padEnd(56, 'B');
/** A published face that differs from G's deterministic default, so ignoring it shows. */
const PUBLISHED = FACE_IDS.find((id) => id !== defaultAvatarId(G))!;
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
    await expect(ogResolve('alice')).resolves.toEqual({ address: G, lookup: 'ok', scores, avatar, bio: 'hello' });
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
    await expect(ogResolve('free')).resolves.toMatchObject({ address: null, lookup: 'ok', bio: '' });
    expect(getMetaMock).not.toHaveBeenCalled();
  });

  it('marks a failed lookup as an error, not as an unclaimed handle (#188)', async () => {
    resolveHandleMock.mockRejectedValueOnce(new Error('rpc down'));
    await expect(ogResolve('alice')).resolves.toMatchObject({ address: null, lookup: 'error' });
    expect(getMetaMock).not.toHaveBeenCalled();
  });

  it('keeps a resolved handle when only its profile read fails', async () => {
    resolveHandleMock.mockResolvedValueOnce(G);
    getMetaMock.mockRejectedValueOnce(new Error('rpc down'));
    await expect(ogResolve('alice')).resolves.toMatchObject({ address: G, lookup: 'ok', scores, bio: '' });
  });

  it('never looks up a handle the app could not create', async () => {
    for (const h of ['a-b', 'ab', 'a'.repeat(33)]) {
      await expect(ogResolve(h)).resolves.toMatchObject({ address: null, lookup: 'invalid' });
    }
    expect(resolveHandleMock).not.toHaveBeenCalled();
  });
});

describe('ogCard', () => {
  it('only calls an unclaimed handle available when the lookup said so', () => {
    const line = (lookup?: 'ok' | 'error' | 'invalid') =>
      render(ogCard({ handle: 'alice', address: null, lookup, scores })).body.textContent;
    expect(line()).toContain('available — claim it');
    expect(line('error')).toContain('profile lookup unavailable');
    expect(line('error')).not.toContain('available — claim it');
    expect(line('invalid')).toContain('not a valid handle');
    expect(line('invalid')).not.toContain('claim it');
  });

  it('shows the published face sticker', () => {
    const doc = render(
      ogCard({ handle: 'alice', address: G, scores, avatar: { kind: 'face', id: PUBLISHED } }),
    );
    expect(srcs(doc)).toEqual([loadPng(faceFile(PUBLISHED)).uri]);
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

  it('draws the handle’s seeded constellation in place of a face when unclaimed', () => {
    const doc = render(ogCard({ handle: 'free', address: null, scores }));
    const first = stampArt('unclaimed-free', 7).points.split(' ')[0].split(',');
    const stars = [...doc.querySelectorAll('svg circle')].slice(1); // [0] is the halo
    expect(stars).toHaveLength(7);
    expect([stars[0].getAttribute('cx'), stars[0].getAttribute('cy')]).toEqual([String(Number(first[0])), String(Number(first[1]))]);
  });
});

describe('siteCard', () => {
  it('shows the logo, the tagline and a constellation, with no raster art', () => {
    const doc = render(siteCard());
    const text = doc.body.textContent ?? '';
    expect(text).toContain('alvinmunk');
    expect(text).toContain('Collect people, not points.');
    const [mark, constellation] = [...doc.querySelectorAll('svg')];
    expect(mark.querySelectorAll('circle')).toHaveLength(4); // the navbar logo's four stars
    expect(constellation.querySelectorAll('circle')).toHaveLength(8); // halo + seven stars
    expect(srcs(doc)).toEqual([]);
  });

  it('never shows the retired "passport" name (#505)', () => {
    expect(render(siteCard()).body.textContent?.toLowerCase()).not.toContain('passport');
  });
});

describe('claimCard', () => {
  const open = {
    status: 'open' as const,
    vouchId: 7,
    from: G,
    handle: 'alice',
    note: 'unblocked me at 2am',
    daysLeft: 3,
  };
  const text = (doc: Document) => doc.body.textContent ?? '';

  it('shows the voucher face, @handle, note, the empty socket and the days left', () => {
    const doc = render(claimCard(open));
    expect(srcs(doc)).toEqual([loadPng(faceFile(defaultAvatarId(G))).uri]);
    expect(text(doc)).toContain('@alice');
    expect(text(doc)).toContain('“unblocked me at 2am”');
    expect(text(doc)).toContain('YOUR HALF');
    expect(text(doc)).toContain('3 DAYS LEFT TO CLAIM');
    expect(text(doc)).toContain('#7');
  });

  it('shows the voucher’s published face, like the claim page does', () => {
    const doc = render(claimCard({ ...open, avatar: { kind: 'face', id: PUBLISHED } }));
    expect(srcs(doc)).toEqual([loadPng(faceFile(PUBLISHED)).uri]);
  });

  it('composes a remixed kit face from its layers', () => {
    const kit: KitAvatar = { kind: 'kit', skin: 2, hair: 5, eyes: 3, mouth: 9, acc: null, bg: 4 };
    const doc = render(claimCard({ ...open, avatar: kit }));
    expect(srcs(doc)).toEqual(
      [kitFile('bg', 4), kitFile('skin', 2), kitFile('hair', 5), kitFile('eyes', 3), kitFile('mouth', 9)].map(
        (f) => loadPng(f).uri,
      ),
    );
  });

  it('falls back to the short address when the voucher has no handle', () => {
    const doc = render(claimCard({ ...open, handle: null, daysLeft: 1 }));
    expect(text(doc)).toContain(shortAddr(G));
    expect(text(doc)).not.toContain('@');
    expect(text(doc)).toContain('1 DAY LEFT TO CLAIM');
  });

  it('keeps the name on one line: full size for a short one, scaled down for the longest handle', () => {
    expect(claimNameSize('@alice'.length)).toBe(40);
    expect(claimNameSize(shortAddr(G).length)).toBe(40);
    // '@' + a 32-character handle at ~0.6em a glyph stays inside the 520px column
    expect(claimNameSize(33) * 0.6 * 33).toBeLessThan(520);
    expect(claimNameSize(33)).toBeGreaterThanOrEqual(24);
  });

  it('prints the note as plain text, never markup, and drops the quote when there is none', () => {
    const note = '<img src=x onerror=alert(1)> & friends';
    expect(text(render(claimCard({ ...open, note })))).toContain(note);
    expect(srcs(render(claimCard({ ...open, note })))).toHaveLength(1); // only the face
    expect(text(render(claimCard({ ...open, note: '' })))).not.toContain('“');
  });

  it('gives a claimed card a lit socket instead of the empty one', () => {
    const doc = render(claimCard({ ...open, status: 'claimed', daysLeft: 0 }));
    expect(text(doc)).toContain('THIS STAR IS LIT');
    expect(text(doc)).not.toContain('YOUR HALF');
    expect(text(doc)).not.toContain('LEFT TO CLAIM');
  });

  it('keeps the socket open on a closed card — a late claim still lands', () => {
    const doc = render(claimCard({ ...open, status: 'closed', daysLeft: 0 }));
    expect(text(doc)).toContain('STAKE WINDOW CLOSED');
    expect(text(doc)).toContain('YOUR HALF');
    expect(text(doc)).not.toContain('LEFT TO CLAIM');
  });

  it('renders a neutral brand card (no face, no broken image) for an unknown id', () => {
    const doc = render(claimCard({ status: 'unknown' }));
    expect(srcs(doc)).toEqual([]);
    expect(text(doc)).toContain('This half-card doesn’t exist');
    expect(text(doc)).not.toContain('YOUR HALF');
  });

  it('never calls the card dead when the chain could not be read', () => {
    const doc = render(claimCard({ status: 'unavailable' }));
    expect(srcs(doc)).toEqual([]);
    expect(text(doc)).toContain('Someone vouched for you');
    expect(text(doc)).not.toContain('doesn’t exist');
  });
});

describe('loadPng', () => {
  it('reads the intrinsic size from the PNG header', () => {
    expect(loadPng(faceFile('face-01'))).toMatchObject({ w: 148, h: 189 });
  });
});
