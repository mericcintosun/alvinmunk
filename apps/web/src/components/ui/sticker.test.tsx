import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StateArt } from './state-art';
import { Sticker, Tape } from './sticker';

/** Render one element and return its <img> (each of these components renders exactly one). */
function img(node: ReactElement): HTMLImageElement {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(node);
  const el = host.querySelector('img');
  if (!el) throw new Error('no <img> rendered');
  return el;
}

describe('decorative art loads lazily by default (#506)', () => {
  it('<Sticker> is lazy and async-decoded', () => {
    const el = img(<Sticker name="star-lime" size={48} />);
    expect(el.getAttribute('loading')).toBe('lazy');
    expect(el.getAttribute('decoding')).toBe('async');
  });

  it('<StateArt> is lazy and async-decoded', () => {
    const el = img(<StateArt kind="vouch-sent" size={140} />);
    expect(el.getAttribute('loading')).toBe('lazy');
    expect(el.getAttribute('decoding')).toBe('async');
  });

  it('<Tape> is lazy and async-decoded', () => {
    const el = img(<Tape corner="tl" />);
    expect(el.getAttribute('loading')).toBe('lazy');
    expect(el.getAttribute('decoding')).toBe('async');
  });

  it('`priority` opts above-the-fold art out of lazy loading', () => {
    for (const el of [img(<Sticker name="star-lime" priority />), img(<StateArt kind="vouch-sent" priority />)]) {
      expect(el.getAttribute('loading')).toBe('eager');
      expect(el.getAttribute('decoding')).toBe('async');
    }
  });

  it('keeps the intrinsic-size and alt behaviour', () => {
    const sticker = img(<Sticker name="star-lime" size={56} />);
    expect(sticker.getAttribute('width')).toBe('56');
    expect(sticker.getAttribute('height')).toBe('53');
    expect(sticker.getAttribute('alt')).toBe('');
    expect(sticker.getAttribute('aria-hidden')).toBe('true');

    const art = img(<StateArt kind="vouch-sent" size={9999} />);
    expect(art.getAttribute('width')).toBe('441');
    expect(art.getAttribute('alt')).toMatch(/Vouch sent/);
  });
});
