import { stampArt, shortAddr } from '@alvinmunk/shared';
import { resolveHandle } from './registry';
import { getScores } from './reputation';
import { loadPngDataUri } from './og-assets';
import { faceFile, type FaceId } from './avatar';

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

export async function ogResolve(handle: string): Promise<{
  address: string | null;
  scores: { social: number; earned: number };
}> {
  let address: string | null = null;
  let scores = { social: 0, earned: 0 };
  try {
    address = await resolveHandle(handle);
    if (address) scores = await getScores(address);
  } catch {
    /* unclaimed / rpc miss → render a neutral card */
  }
  return { address, scores };
}

export function ogCard(opts: {
  handle: string;
  address: string | null;
  scores: { social: number; earned: number };
  invite?: boolean;
  /** The profile face to render. When set (claimed handle), shows the portrait sticker;
   *  otherwise falls back to the deterministic constellation. */
  avatarId?: FaceId;
}) {
  const { handle, address, scores, invite, avatarId } = opts;
  const art = stampArt(address ?? `unclaimed-${handle}`, 7);
  const pts = art.points.split(' ').map((p) => p.split(',').map(Number));
  const polyPoints = [...pts, pts[0]].map((p) => `${p[0]},${p[1]}`).join(' ');
  const stars = Math.max(1, Math.round(scores.social / 10));
  const faceUri = avatarId && address ? loadPngDataUri(faceFile(avatarId)) : null;

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
        {faceUri ? (
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
            <img src={faceUri} width={372} height={475} style={{ objectFit: 'cover', objectPosition: 'top' }} />
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
          <div style={{ display: 'flex', marginTop: '40px', gap: '44px' }}>
            <Stat label="STARS" value={address ? stars : 0} color={GOLD} />
            <Stat label="SOCIAL XP" value={scores.social} color={VIOLET} />
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

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', fontSize: '54px', fontWeight: 700, color }}>{value}</div>
      <div style={{ display: 'flex', marginTop: '6px', color: MUTED, fontSize: '20px', letterSpacing: '3px' }}>{label}</div>
    </div>
  );
}
