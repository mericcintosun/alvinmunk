/* eslint-disable @next/next/no-img-element -- Satori (next/og) renders plain <img>; next/image can't run here */
import { stampArt, shortAddr } from '@alvinmunk/shared';
import { resolveHandle, getMeta } from './registry';
import { getScores, type PeopleCounts } from './reputation';
import { getPeopleCounts } from './constellation';
import { loadPng } from './og-assets';
import {
  faceFile,
  kitFile,
  resolveAvatarId,
  KIT_LAYERS,
  KIT_REF_W,
  type AvatarConfig,
  type KitAvatar,
} from './avatar';

// Shared profile-card renderer for the OG image routes (/u and /v). Resolves the handle
// on-chain and returns Satori-compatible JSX. Literal colors (Satori has no CSS vars).

const BG = '#0B0512';
const VIOLET = '#9945FF';
const CYAN = '#37E0FF';
const GREEN = '#14F195';
const GOLD = '#FFB257';
const LIME = '#C4FA4E';
const FG = '#F4F1FA';
const MUTED = '#8b86a8';

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
  const art = stampArt(address ?? `unclaimed-${handle}`, 7);
  const pts = art.points.split(' ').map((p) => p.split(',').map(Number));
  const polyPoints = [...pts, pts[0]].map((p) => `${p[0]},${p[1]}`).join(' ');
  const face =
    address && avatar?.kind !== 'kit' ? loadPng(faceFile(resolveAvatarId(avatar, address))) : null;
  const kit = address && avatar?.kind === 'kit' ? avatar : null;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: `radial-gradient(120% 120% at 20% 0%, #1a0b2e 0%, ${BG} 60%)`,
        color: FG,
        padding: '64px',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', color: MUTED, fontSize: '24px', letterSpacing: '6px' }}>
          <div style={{ width: '14px', height: '14px', borderRadius: '50%', background: GOLD }} />
          ALVINMUNK
        </div>
        <div style={{ display: 'flex', color: invite ? GOLD : GREEN, fontSize: '22px', letterSpacing: '4px' }}>
          {invite ? 'INVITED YOU' : '● LIVE'}
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, alignItems: 'center', gap: '56px' }}>
        {face || kit ? (
          <div
            style={{
              display: 'flex',
              width: '380px',
              height: '380px',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '50%',
              overflow: 'hidden',
              background: `radial-gradient(circle, ${VIOLET}22 0%, ${BG} 72%)`,
              border: `6px solid ${LIME}`,
            }}
          >
            {kit ? (
              <OgKitFace cfg={kit} size={FACE_BOX} />
            ) : face ? (
              <img
                src={face.uri}
                alt=""
                width={372}
                height={475}
                style={{ objectFit: 'cover', objectPosition: 'top' }}
              />
            ) : null}
          </div>
        ) : (
          <div style={{ display: 'flex', width: '380px', height: '380px' }}>
            <svg width="380" height="380" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="46" fill={VIOLET} fillOpacity="0.08" />
              <polyline points={polyPoints} fill="none" stroke="#9fb0d8" strokeOpacity="0.3" strokeWidth="0.6" />
              {pts.map((p, i) => (
                <circle key={i} cx={p[0]} cy={p[1]} r={i === 0 ? 4 : 2.4} fill={i === 0 ? GOLD : i % 2 ? CYAN : VIOLET} />
              ))}
            </svg>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          {invite && (
            <div style={{ display: 'flex', color: MUTED, fontSize: '26px', marginBottom: '8px' }}>
              join @{handle} on
            </div>
          )}
          <div style={{ display: 'flex', fontSize: '76px', fontWeight: 700, lineHeight: 1 }}>@{handle}</div>
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

/** Inner size of the 380px face circle (its 6px border takes the rest). */
const FACE_BOX = 368;

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
