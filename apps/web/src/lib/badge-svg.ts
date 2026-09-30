/**
 * Embeddable reputation badge (#283) — the PURE SVG renderer behind
 * `GET /api/badge/[handle]`.
 *
 * Nothing here reads the network or the clock, so one view always renders the same bytes:
 * a CDN-cached badge, and any crawler or image proxy that re-fetches it, can never be served
 * a half-drawn or non-deterministic image. Every piece of text goes through `esc` — a handle
 * reaches this file straight from a URL path segment, so it must never be able to close a
 * tag. The fonts are a system monospace stack, and the only artwork is inline geometry: an
 * embedded badge has to render with no external font, image or script request.
 *
 * Two shapes:
 *   - `flat`: the compact one-line badge (logo, @handle, people vouched, Earned XP, tick).
 *   - `card`: the full panel, with both stats labelled and the verified stamp.
 */

import { BRAND_DARK } from './brand-palette';

/** The flat badge canvas: shields-style height, so it lines up with other README badges. */
const FLAT_H = 28;

/** Monospace, single-word families only: a quoted family would need `&quot;` inside the
 *  attribute. Monospace also makes `textWidth` exact instead of a guess. */
const FONT = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
/** Width of one glyph, in em — monospace advances are uniform. */
const ADVANCE = 0.6;

// The design tokens as hex (lib/brand-palette, like the OG cards): an embedded SVG has no
// CSS variables, and it is always the dark theme.
const {
  background: BG,
  nebula: PANEL,
  violet: VIOLET,
  gold: GOLD,
  green: GREEN,
  lime: LIME,
  foreground: FG,
  muted: MUTED,
} = BRAND_DARK;

/**
 * What the badge says about the handle:
 *   - `claimed`: someone holds it — the stats below are theirs;
 *   - `unclaimed`: nobody holds it;
 *   - `unavailable`: the chain didn't answer, so nothing is claimed about the handle either way;
 *   - `invalid`: the path can never be a handle, so the badge names no one.
 */
export type BadgeStatus = 'claimed' | 'unclaimed' | 'unavailable' | 'invalid';

/** Everything the badge shows. The stats are only drawn for a `claimed` handle. */
export interface BadgeView {
  status: BadgeStatus;
  /** The registry handle ('' for an `invalid` path, which is never echoed). */
  handle: string;
  /** Distinct people who vouched (the on-chain counters; Social XP where they predate it). */
  vouchedBy: number;
  /** Earned XP — the only USDC-eligible track. */
  earned: number;
  verified: boolean;
}

export type BadgeStyle = 'flat' | 'card';

/** The `?style=` value: `card` opts in, anything else (including absent) is the flat default. */
export function badgeStyle(value: string | null | undefined): BadgeStyle {
  return value === 'card' ? 'card' : 'flat';
}

/** Escape text for XML character data and attributes. */
function esc(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

/** A stat as text: a whole, non-negative number, whatever the read produced. */
function count(value: number): string {
  return Number.isFinite(value) && value > 0 ? String(Math.floor(value)) : '0';
}

/** Rendered width of `text` at `size`, in px. */
function textWidth(text: string, size: number): number {
  return Math.round(text.length * size * ADVANCE);
}

/** The brand mark — the same deterministic constellation as `app/icon.svg`, scaled. */
function logo(x: number, y: number, size: number, color = FG): string {
  const s = size / 32;
  return (
    `<g transform="translate(${x} ${y}) scale(${s})">` +
    `<polyline points="7,11 16,7 24,15 12,24" fill="none" stroke="${color}" stroke-opacity="0.35" stroke-width="1.6" stroke-linejoin="round"/>` +
    `<circle cx="16" cy="7" r="2.8" fill="${GOLD}"/>` +
    `<circle cx="7" cy="11" r="2" fill="${color}"/>` +
    `<circle cx="24" cy="15" r="2" fill="${color}"/>` +
    `<circle cx="12" cy="24" r="2" fill="${color}"/>` +
    `</g>`
  );
}

/** The verified tick, drawn (never a glyph: the font stack may not have ✓). */
function tick(x: number, y: number, size: number, color: string): string {
  return (
    `<g transform="translate(${x} ${y}) scale(${size / 10})">` +
    `<path d="M0 5.2 L3.4 8.6 L9 1.6" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</g>`
  );
}

function svg(title: string, width: number, height: number, body: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">` +
    `<title>${esc(title)}</title>${body}</svg>`
  );
}

/** The alt/title text both shapes share. */
function titleOf(view: BadgeView): string {
  switch (view.status) {
    case 'claimed':
      return `@${view.handle} on alvinmunk — ${count(view.vouchedBy)} vouched, ${count(view.earned)} earned XP${
        view.verified ? ', verified' : ''
      }`;
    case 'unclaimed':
      return `@${view.handle} is unclaimed on alvinmunk`;
    case 'unavailable':
      return `@${view.handle} on alvinmunk — reputation unavailable right now`;
    case 'invalid':
      return 'Not an alvinmunk handle';
  }
}

/** The flat badge's right-hand text. */
function flatText(view: BadgeView): string {
  const who = `@${view.handle}`;
  switch (view.status) {
    case 'claimed':
      return `${who} · ${count(view.vouchedBy)} vouched · ${count(view.earned)} earned`;
    case 'unclaimed':
      return `${who} · unclaimed`;
    case 'unavailable':
      return `${who} · unavailable`;
    case 'invalid':
      return 'not a handle';
  }
}

/** The compact one-line badge. */
function flat(view: BadgeView): string {
  const pad = 10;
  const size = 11;
  const logoSize = 14;
  const gap = 6;

  const leftText = 'alvinmunk';
  const leftW = pad + logoSize + gap + textWidth(leftText, size) + pad;

  const claimed = view.status === 'claimed';
  const verified = claimed && view.verified;
  const rightText = flatText(view);
  const tickW = verified ? 14 : 0;
  const rightW = pad + textWidth(rightText, size) + tickW + pad;
  const width = leftW + rightW;

  const rightBg = claimed ? VIOLET : PANEL;
  const rightFg = claimed ? BG : MUTED;
  const baseline = FLAT_H / 2 + 4;
  const textX = leftW + pad;

  const body =
    `<rect width="${width}" height="${FLAT_H}" rx="8" fill="${PANEL}"/>` +
    `<rect x="${leftW}" width="${rightW}" height="${FLAT_H}" rx="8" fill="${rightBg}"/>` +
    // Square off the right segment's left edge so only the outer corners stay rounded.
    `<rect x="${leftW}" width="8" height="${FLAT_H}" fill="${rightBg}"/>` +
    logo(pad, (FLAT_H - logoSize) / 2, logoSize) +
    `<text x="${pad + logoSize + gap}" y="${baseline}" font-family="${FONT}" font-size="${size}" fill="${FG}">${esc(leftText)}</text>` +
    `<text x="${textX}" y="${baseline}" font-family="${FONT}" font-size="${size}" font-weight="700" fill="${rightFg}">${esc(rightText)}</text>` +
    (verified ? tick(textX + textWidth(rightText, size) + 2, FLAT_H / 2 - 5, 10, rightFg) : '');

  return svg(titleOf(view), width, FLAT_H, body);
}

/** The full panel: both stats labelled, plus the verified stamp. */
function card(view: BadgeView): string {
  const width = 360;
  const height = 150;
  const pad = 20;

  const claimed = view.status === 'claimed';
  const verified = claimed && view.verified;
  const name = view.status === 'invalid' ? 'not a handle' : `@${view.handle}`;
  const tickW = verified ? 22 : 0;
  const nameSize = Math.min(
    26,
    Math.max(12, Math.floor((width - pad * 2 - tickW) / (name.length * ADVANCE))),
  );

  const divider = `<line x1="${pad}" y1="96" x2="${width - pad}" y2="96" stroke="${FG}" stroke-opacity="0.08"/>`;

  const note =
    view.status === 'unclaimed'
      ? 'unclaimed — this handle is free'
      : view.status === 'unavailable'
        ? 'reputation unavailable — try again soon'
        : 'this link does not name a handle';
  const stats = claimed
    ? `<text x="${pad}" y="114" font-family="${FONT}" font-size="9" letter-spacing="1.5" fill="${MUTED}">VOUCHED BY</text>` +
      `<text x="${pad}" y="138" font-family="${FONT}" font-size="22" font-weight="700" fill="${GOLD}">${count(view.vouchedBy)}</text>` +
      `<text x="150" y="114" font-family="${FONT}" font-size="9" letter-spacing="1.5" fill="${MUTED}">EARNED XP</text>` +
      `<text x="150" y="138" font-family="${FONT}" font-size="22" font-weight="700" fill="${GREEN}">${count(view.earned)}</text>` +
      (verified
        ? `<rect x="258" y="118" width="82" height="22" rx="6" fill="none" stroke="${LIME}"/>` +
          `<text x="299" y="133" text-anchor="middle" font-family="${FONT}" font-size="9" letter-spacing="2" fill="${LIME}">VERIFIED</text>`
        : '')
    : `<text x="${pad}" y="124" font-family="${FONT}" font-size="13" fill="${MUTED}">${esc(note)}</text>`;

  const body =
    `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="14" fill="${BG}" stroke="${VIOLET}" stroke-opacity="0.45"/>` +
    logo(pad, 16, 16) +
    `<text x="${pad + 22}" y="29" font-family="${FONT}" font-size="10" letter-spacing="3" fill="${MUTED}">ALVINMUNK</text>` +
    `<text x="${pad}" y="78" font-family="${FONT}" font-size="${nameSize}" font-weight="700" fill="${FG}">${esc(name)}</text>` +
    (verified
      ? tick(pad + textWidth(name, nameSize) + 8, 78 - Math.round(nameSize * 0.45) - 6, 16, LIME)
      : '') +
    divider +
    stats;

  return svg(titleOf(view), width, height, body);
}

/** Render `view` in `style`. Always valid SVG, whatever the view holds. */
export function badgeSvg(view: BadgeView, style: BadgeStyle = 'flat'): string {
  return style === 'card' ? card(view) : flat(view);
}
