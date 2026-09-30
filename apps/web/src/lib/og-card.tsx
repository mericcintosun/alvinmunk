/* eslint-disable @next/next/no-img-element -- Satori (next/og) renders plain <img>; next/image can't run here */
import type { CSSProperties } from 'react';
import { stampArt, shortAddr } from '@alvinmunk/shared';
import { resolveHandle, getMeta } from './registry';
import { getScores, type PeopleCounts } from './reputation';
import { getPeopleCounts } from './constellation';
import { loadPng } from './og-assets';
import { BRAND_DARK } from './brand-palette';
import {
  faceFile,
  kitFile,
  resolveAvatarId,
  KIT_LAYERS,
  KIT_REF_W,
  type AvatarConfig,
  type KitAvatar,
} from './avatar';

// Shared card renderers for the OG image routes: the profile card (/u and /v, resolved from
// the handle on-chain) and the half-card (/claim). Satori-compatible JSX with literal colors
// (Satori has no CSS vars): the dark-theme brand palette, resolved from the design tokens.

/** Calculate font size for handle based on length to fit within OG card width. */
export function handleFontSize(handleLength: number): number {
  const MAX_SIZE = 76;
  const MIN_SIZE = 40;
  const MAX_CHARS = 12;
  
  if (handleLength <= MAX_CHARS) return MAX_SIZE;
  
  // Linear interpolation from MAX_SIZE to MIN_SIZE as length increases
  // At 12 chars: 76px, at 32 chars: 40px
  const scaleFactor = (handleLength - MAX_CHARS) / (32 - MAX_CHARS);
  return Math.max(MIN_SIZE, MAX_SIZE - scaleFactor * (MAX_SIZE - MIN_SIZE));
}

const {
  background: BG,
  violet: VIOLET,
  cyan: CYAN,
  green: GREEN,
  gold: GOLD,
  lime: LIME,
  foreground: FG,
  muted: MUTED,
  starlight: STARLIGHT,
  nebula: NEBULA,
} = BRAND_DARK;

/** XP tracks + the people counts the card shows. */
export type OgScores = { social: number; earned: number } & PeopleCounts;

export async function ogResolve(handle: string): Promise<{
  address: string | null;
  scores: OgScores;
  /** The published face (undefined → the deterministic default for `address`). */
  avatar?: AvatarConfig;
  /** The published bio, already sanitized to one plain line ('' when none). */
  bio: string;
}> {
  let address: string | null = null;
  let scores: OgScores = { social: 0, earned: 0, vouchedBy: 0, backed: 0 };
  let avatar: AvatarConfig | undefined;
  let bio = '';
  try {
    address = await resolveHandle(handle);
    if (address) {
      const [s, p, meta] = await Promise.all([
        getScores(address).catch(() => ({ social: 0, earned: 0 })),
        getPeopleCounts(address).catch(() => ({ vouchedBy: 0, backed: 0 })),
        getMeta(address), // null on a registry without get_meta → default face, no bio
      ]);
      scores = { ...s, ...p };
      avatar = meta?.avatar;
      bio = meta?.bio ?? '';
    }
  } catch {
    /* unclaimed / rpc miss → render a neutral card */
  }
  return { address, scores, avatar, bio };
}

export function ogCard(opts: {
  handle: string;
  address: string | null;
  scores: OgScores;
  invite?: boolean;
  /** The published face; a claimed handle without one shows its deterministic default.
   *  An unclaimed handle (no address) shows the constellation instead. */
  avatar?: AvatarConfig;
  /** One plain line under the address (sanitized by getMeta; rendered as text). */
  bio?: string;
}) {
  const { handle, address, scores, invite, avatar, bio } = opts;

  return (
    <div style={SHELL}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Brand />
        <div style={{ display: 'flex', color: invite ? GOLD : GREEN, fontSize: '22px', letterSpacing: '4px' }}>
          {invite ? 'INVITED YOU' : '● LIVE'}
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, alignItems: 'center', gap: '56px' }}>
        {address ? (
          <OgFace address={address} avatar={avatar} size={380} ring={LIME} />
        ) : (
          <Constellation seed={`unclaimed-${handle}`} size={380} />
        )}

        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          {invite && (
            <div style={{ display: 'flex', color: MUTED, fontSize: '26px', marginBottom: '8px' }}>
              join @{handle} on
            </div>
          )}
          <div style={{ display: 'flex', fontSize: handleFontSize(handle.length), fontWeight: 700, lineHeight: 1, wordBreak: 'break-all' }}>@{handle}</div>
          <div style={{ display: 'flex', marginTop: '14px', color: MUTED, fontSize: '26px' }}>
            {address ? shortAddr(address) : 'available — claim it'}
          </div>
          {address && bio && (
            <div
              style={{
                display: 'block',
                marginTop: '14px',
                maxWidth: '640px',
                lineClamp: 2,
                wordBreak: 'break-word',
                color: FG,
                opacity: 0.85,
                fontSize: '26px',
                lineHeight: 1.35,
              }}
            >
              {bio}
            </div>
          )}
          <div style={{ display: 'flex', marginTop: '40px', gap: '44px' }}>
            <Stat label="VOUCHED BY" value={scores.vouchedBy} color={GOLD} />
            <Stat label="BACKED" value={scores.backed} color={VIOLET} />
            <Stat label="EARNED XP" value={scores.earned} color={GREEN} />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', color: MUTED, fontSize: '20px', letterSpacing: '8px', opacity: 0.5 }}>
        {`A<ALVINMUNK<<${handle.toUpperCase()}<<COLLECT<PEOPLE<NOT<POINTS<<<<<<<<`.slice(0, 62)}
      </div>
    </div>
  );
}

/** Alt text for the site-wide card: it describes what the image shows. */
export const SITE_CARD_ALT = 'The alvinmunk logo and a constellation, with the line “Collect people, not points.”';

/**
 * The site-wide card: what every route without its own opengraph-image unfurls into (the
 * root `opengraph-image`, which Next also uses for twitter:image). The logo, the tagline
 * and a constellation.
 */
export function siteCard() {
  return (
    <div style={SHELL}>
      <div style={{ display: 'flex', flex: 1, alignItems: 'center', gap: '40px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <Logo size={88} />
          <div style={{ display: 'flex', marginTop: '48px', fontSize: '76px', fontWeight: 700, lineHeight: 1.05 }}>
            Collect people, not points.
          </div>
          <div style={{ display: 'flex', marginTop: '24px', color: MUTED, fontSize: '28px', lineHeight: 1.35 }}>
            A social proof-of-people reputation game on Stellar.
          </div>
        </div>
        <Constellation seed="alvinmunk" size={340} />
      </div>

      <div style={{ display: 'flex', color: MUTED, fontSize: '20px', letterSpacing: '8px', opacity: 0.5 }}>
        {'A<ALVINMUNK<<COLLECT<PEOPLE<NOT<POINTS<<<<<<<<<<<<<<<<<<<<<<<<<<<'.slice(0, 62)}
      </div>
    </div>
  );
}

/**
 * What a `/claim/<id>` link unfurls into, as far as the PUBLIC id reveals. The claim route
 * builds it from `getVouch(id)` alone — never from the link's claim code, which lives in the
 * URL fragment and never reaches a server.
 * - `unknown`: no half-card has this id (or the id can never be one).
 * - `unavailable`: the chain didn't answer. It says nothing about the card, so an unfurl
 *   cached during an RPC blip never tells the recipient a live link is dead.
 */
export type ClaimCardView =
  | { status: 'unknown' }
  | { status: 'unavailable' }
  | {
      /** `closed`: the voucher's stake window has passed — the card itself still claims. */
      status: 'open' | 'claimed' | 'closed';
      vouchId: number;
      from: string;
      /** The voucher's @handle (null → their short address). */
      handle: string | null;
      /** The voucher's published face (undefined → their deterministic default). */
      avatar?: AvatarConfig;
      /** The one-line note, rendered as text ('' when none). */
      note: string;
      daysLeft: number;
    };

/** Font size that keeps the voucher's name on one line under the face: 40px up to 20
 *  characters, then scaled down so the longest handle (`@` + 32) still fits the column. */
export function claimNameSize(chars: number): number {
  return Math.min(40, Math.floor(820 / Math.max(chars, 1)));
}

/**
 * The half-card unfurl for `/claim/<id>` — the install funnel: the voucher's face and
 * @handle, their note, and the glowing empty socket waiting for the recipient.
 */
export function claimCard(view: ClaimCardView) {
  if (view.status === 'unknown' || view.status === 'unavailable') {
    const [title, line] =
      view.status === 'unknown'
        ? ['This half-card doesn’t exist', 'The link may be old or mistyped — ask for a fresh one.']
        : ['Someone vouched for you', 'Open the link to claim your half of the sky.'];
    return (
      <div style={SHELL}>
        <Brand />
        <div style={{ display: 'flex', flex: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="180" height="180" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="44" fill={VIOLET} fillOpacity="0.08" />
            <circle cx="50" cy="50" r="6" fill={GOLD} />
          </svg>
          <div style={{ display: 'flex', marginTop: '28px', fontSize: '56px', fontWeight: 700 }}>{title}</div>
          <div style={{ display: 'flex', marginTop: '16px', color: MUTED, fontSize: '28px' }}>{line}</div>
        </div>
      </div>
    );
  }

  const { status, vouchId, from, handle, avatar, note, daysLeft } = view;
  const name = handle ? `@${handle}` : shortAddr(from);
  const lit = status === 'claimed';
  const statusText =
    status === 'open'
      ? `${daysLeft} ${daysLeft === 1 ? 'DAY' : 'DAYS'} LEFT TO CLAIM`
      : lit
        ? 'THIS STAR IS LIT'
        : 'STAKE WINDOW CLOSED';
  const statusColor = status === 'open' ? GOLD : lit ? GREEN : MUTED;
  const socket = lit ? GREEN : GOLD;

  return (
    <div style={SHELL}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Brand />
        <div style={{ display: 'flex', color: statusColor, fontSize: '22px', letterSpacing: '4px' }}>{statusText}</div>
      </div>

      <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', gap: '48px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '18px' }}>
          <OgFace address={from} avatar={avatar} size={260} ring={GOLD} />
          <div style={{ display: 'flex', fontSize: claimNameSize(name.length), fontWeight: 700, maxWidth: '520px', wordBreak: 'break-all' }}>
            {name}
          </div>
        </div>

        {/* An SVG arrow: Noto Sans has no → glyph. */}
        <svg width="64" height="32" viewBox="0 0 64 32">
          <path d="M2 16h56M44 4l14 12-14 12" fill="none" stroke={MUTED} strokeWidth="4" />
        </svg>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '18px' }}>
          <div
            style={{
              display: 'flex',
              width: '260px',
              height: '260px',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '36px',
              background: `radial-gradient(circle, ${socket}22 0%, ${BG} 74%)`,
              border: `5px ${lit ? 'solid' : 'dashed'} ${socket}`,
              boxShadow: `0 0 42px 6px ${socket}55`,
            }}
          >
            <div style={{ display: 'flex', color: socket, fontSize: '26px', letterSpacing: '3px' }}>
              {lit ? 'LIT' : 'YOUR HALF'}
            </div>
          </div>
          <div style={{ display: 'flex', color: MUTED, fontSize: '26px' }}>{lit ? 'claimed' : 'waiting for you'}</div>
        </div>
      </div>

      {note ? (
        <div
          style={{
            display: 'block',
            alignSelf: 'center',
            maxWidth: '760px',
            lineClamp: 2,
            wordBreak: 'break-word',
            textAlign: 'center',
            color: FG,
            opacity: 0.88,
            fontSize: '30px',
            lineHeight: 1.35,
          }}
        >
          {`“${note}”`}
        </div>
      ) : null}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '24px', color: MUTED, fontSize: '20px', letterSpacing: '4px', opacity: 0.55 }}>
        <div style={{ display: 'flex' }}>{`HALF-CARD // #${vouchId}`}</div>
        <div style={{ display: 'flex' }}>COLLECT PEOPLE, NOT POINTS</div>
      </div>
    </div>
  );
}

/** The canvas every card renders into. */
const SHELL: CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  background: `radial-gradient(120% 120% at 20% 0%, ${NEBULA} 0%, ${BG} 60%)`,
  color: FG,
  padding: '64px',
  // Must match the `name` of every font entry passed to `ImageResponse` (see the
  // opengraph-image.tsx routes) — Satori only falls back to a font whose CSS family
  // matches this name; nothing here declares its own fontFamily.
  fontFamily: 'Noto Sans',
};

function Brand() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '14px', color: MUTED, fontSize: '24px', letterSpacing: '6px' }}>
      <div style={{ width: '14px', height: '14px', borderRadius: '50%', background: GOLD }} />
      ALVINMUNK
    </div>
  );
}

/**
 * The navbar logo (components/brand/logo.tsx) in palette colours: the constellation mark
 * and the lowercase wordmark. `size` is the mark's height in px.
 */
function Logo({ size }: { size: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: `${Math.round(size / 4)}px` }}>
      <svg width={size} height={size} viewBox="0 0 24 24">
        <polyline points="5,8 12,5 18,11 9,18" fill="none" stroke={STARLIGHT} strokeOpacity="0.3" strokeWidth="1" />
        <circle cx="12" cy="5" r="2" fill={VIOLET} />
        <circle cx="5" cy="8" r="1.4" fill={STARLIGHT} />
        <circle cx="18" cy="11" r="1.4" fill={STARLIGHT} />
        <circle cx="9" cy="18" r="1.4" fill={STARLIGHT} />
      </svg>
      <div style={{ display: 'flex', fontSize: `${Math.round(size * 0.8)}px`, fontWeight: 700, letterSpacing: '-1px' }}>
        alvinmunk
      </div>
    </div>
  );
}

/** A seeded seven-star constellation (the same art an unclaimed profile card shows). */
function Constellation({ seed, size }: { seed: string; size: number }) {
  const art = stampArt(seed, 7);
  const pts = art.points.split(' ').map((p) => p.split(',').map(Number));
  const polyPoints = [...pts, pts[0]].map((p) => `${p[0]},${p[1]}`).join(' ');
  return (
    <div style={{ display: 'flex', width: `${size}px`, height: `${size}px` }}>
      <svg width={size} height={size} viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="46" fill={VIOLET} fillOpacity="0.08" />
        <polyline points={polyPoints} fill="none" stroke={MUTED} strokeOpacity="0.3" strokeWidth="0.6" />
        {pts.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r={i === 0 ? 4 : 2.4} fill={i === 0 ? GOLD : i % 2 ? CYAN : VIOLET} />
        ))}
      </svg>
    </div>
  );
}

/** Width of the ring around a face circle. */
const RING = 6;
/** Height-to-width of the box a face sticker is cropped into. */
const FACE_TALL = 475 / 372;

/**
 * A ringed face circle: the published face sticker, a remixed kit face, or — with none
 * published — the deterministic default for `address` (the same resolution <Avatar> uses).
 */
function OgFace({
  address,
  avatar,
  size,
  ring,
}: {
  address: string;
  avatar?: AvatarConfig;
  size: number;
  ring: string;
}) {
  const inner = size - 2 * RING;
  const face = avatar?.kind === 'kit' ? null : loadPng(faceFile(resolveAvatarId(avatar, address)));
  // A portrait box a little wider than the circle, so `cover` leaves no sliver at the ring
  // and crops the sticker from the bottom (`objectPosition: top`).
  const w = inner + 4;
  return (
    <div
      style={{
        display: 'flex',
        width: `${size}px`,
        height: `${size}px`,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '50%',
        overflow: 'hidden',
        background: `radial-gradient(circle, ${VIOLET}22 0%, ${BG} 72%)`,
        border: `${RING}px solid ${ring}`,
      }}
    >
      {avatar?.kind === 'kit' ? (
        <OgKitFace cfg={avatar} size={inner} />
      ) : face ? (
        <img
          src={face.uri}
          alt=""
          width={w}
          height={Math.round(w * FACE_TALL)}
          style={{ objectFit: 'cover', objectPosition: 'top' }}
        />
      ) : null}
    </div>
  );
}

/**
 * Satori twin of <KitFace>: stacks the kit layers at the same calibrated anchors (a 200px
 * reference scaled by size/200), each at an explicit pixel position and size.
 */
function OgKitFace({ cfg, size }: { cfg: KitAvatar; size: number }) {
  const k = size / KIT_REF_W;
  return (
    <div style={{ display: 'flex', position: 'relative', width: size, height: size }}>
      {KIT_LAYERS.map((layer) => {
        const idx = cfg[layer.field] as number | null;
        if (!idx) return null;
        const png = loadPng(kitFile(layer.cat, idx));
        if (layer.cover) {
          return (
            <img
              key={layer.cat}
              src={png.uri}
              alt=""
              width={size}
              height={size}
              style={{ position: 'absolute', left: 0, top: 0, objectFit: 'cover' }}
            />
          );
        }
        const w = layer.wRef * k;
        const h = (w * png.h) / png.w;
        return (
          <img
            key={layer.cat}
            src={png.uri}
            alt=""
            width={w}
            height={h}
            style={{ position: 'absolute', left: (size - w) / 2, top: layer.topRef * k }}
          />
        );
      })}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', fontSize: '54px', fontWeight: 700, color }}>{value}</div>
      <div style={{ display: 'flex', marginTop: '6px', color: MUTED, fontSize: '20px', letterSpacing: '3px' }}>{label}</div>
    </div>
  );
}
