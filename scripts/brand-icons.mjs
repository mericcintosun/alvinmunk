// Regenerates every brand icon from the navbar logo mark (apps/web/src/components/brand/logo.tsx),
// in the dark-theme token colours (BRAND_DARK in apps/web/src/lib/brand-palette.ts), so the
// favicon, the Apple tile, the PWA icons and the notification badge are one set (#504).
//
// Usage: node scripts/brand-icons.mjs   (after `pnpm install`; writes into apps/web)
// Rasterized with next/og (Satori + resvg), the renderer the OG cards already use.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web');
const require = createRequire(join(WEB, 'package.json'));
const { ImageResponse } = require('next/og');
const { createElement: h } = require('react');

// BRAND_DARK: --background, --starlight, --primary (brand-icons.test.ts keeps them in sync).
const BACKGROUND = '#0A0611';
const STARLIGHT = '#F2F0FF';
const VIOLET = '#9A52FF';

// The logo mark in its 24×24 space: a faint line through four stars, the first one violet.
const LINE = '5,8 12,5 18,11 9,18';
const STARS = [
  { x: 12, y: 5, r: 2, violet: true },
  { x: 5, y: 8, r: 1.4 },
  { x: 18, y: 11, r: 1.4 },
  { x: 9, y: 18, r: 1.4 },
];
// Centre of the mark's bounding box, and the distance from it to the farthest star edge.
const CX = 11.5;
const CY = 11.2;
const REACH = Math.max(...STARS.map((s) => Math.hypot(s.x - CX, s.y - CY) + s.r));

/**
 * One icon as SVG on a size×size canvas. `reach` is how far the mark extends from the centre,
 * as a fraction of the size (a maskable icon keeps it inside the 40% safe-zone radius).
 * `radius` rounds the background (0 = full bleed); `background: null` leaves it transparent.
 */
function iconSvg({ size, reach, radius = 0, background = BACKGROUND, mono = null }) {
  const k = (reach * size) / REACH;
  const tx = size / 2 - CX * k;
  const ty = size / 2 - CY * k;
  const star = (s) => mono ?? (s.violet ? VIOLET : STARLIGHT);
  const bg = background
    ? `<rect width="${size}" height="${size}" rx="${round(radius * size)}" fill="${background}"/>`
    : '';
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">`,
    ...(bg ? [`  ${bg}`] : []),
    `  <g transform="translate(${round(tx)} ${round(ty)}) scale(${round(k)})">`,
    `    <polyline points="${LINE}" fill="none" stroke="${mono ?? STARLIGHT}" stroke-opacity="0.3" stroke-width="1" stroke-linejoin="round"/>`,
    ...STARS.map((s) => `    <circle cx="${s.x}" cy="${s.y}" r="${s.r}" fill="${star(s)}"/>`),
    '  </g>',
    '</svg>',
  ].join('\n');
}

const round = (n) => Math.round(n * 1000) / 1000;

/** Rasterize an SVG string to a PNG of the same size. */
async function png(svg, size) {
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const res = new ImageResponse(h('img', { src, width: size, height: size }), {
    width: size,
    height: size,
  });
  return Buffer.from(await res.arrayBuffer());
}

/** A .ico holding PNG images (every current browser reads PNG entries). */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size % 256, e); // 0 means 256
    header.writeUInt8(size % 256, e + 1);
    header.writeUInt8(0, e + 2); // no palette
    header.writeUInt8(0, e + 3);
    header.writeUInt16LE(1, e + 4); // colour planes
    header.writeUInt16LE(32, e + 6); // bits per pixel
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.data)]);
}

// Rounded tile for tabs and install prompts; full bleed where the OS applies its own mask.
const favicon = (size) => iconSvg({ size, reach: 0.38, radius: 0.22 });
const tile = (size) => iconSvg({ size, reach: 0.34, radius: 0.22 });
const apple = (size) => iconSvg({ size, reach: 0.32 });
const maskable = (size) => iconSvg({ size, reach: 0.3 });
// Android paints a notification badge from its alpha channel alone: a white mark, no tile.
const badge = (size) => iconSvg({ size, reach: 0.46, background: null, mono: '#FFFFFF' });

const out = (rel, data) => {
  fs.writeFileSync(join(WEB, rel), data);
  console.log(`wrote apps/web/${rel} (${data.length} bytes)`);
};

out('src/app/icon.svg', `${favicon(32)}\n`);
out(
  'src/app/favicon.ico',
  ico(
    await Promise.all(
      [16, 32, 48].map(async (size) => ({ size, data: await png(favicon(size), size) })),
    ),
  ),
);
out('src/app/apple-icon.png', await png(apple(180), 180));
out('public/assets/brand/alvinmunk-icon-192.png', await png(tile(192), 192));
out('public/assets/brand/alvinmunk-icon-512.png', await png(tile(512), 512));
out('public/assets/brand/alvinmunk-icon-maskable-512.png', await png(maskable(512), 512));
out('public/assets/brand/alvinmunk-badge-96.png', await png(badge(96), 96));
