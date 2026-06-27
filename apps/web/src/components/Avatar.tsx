import { cn } from '@/lib/utils';
import { resolveAvatarId, faceSrc, type AvatarConfig } from '@/lib/avatar';
import { KitFace } from '@/components/KitFace';

/**
 * A profile's face. Renders either a chosen/default portrait sticker (`kind:'face'`) or
 * a remixed portrait-kit composite (`kind:'kit'`), cropped into a circle. Pairs with —
 * never replaces — the geometric Crest, which stays the leaderboard / dev identity.
 */
export function Avatar({
  address,
  avatar,
  handle,
  size = 48,
  ring = true,
  className,
}: {
  address: string;
  avatar?: AvatarConfig;
  handle?: string;
  size?: number;
  ring?: boolean;
  className?: string;
}) {
  const isKit = avatar?.kind === 'kit';
  return (
    <span
      role="img"
      aria-label={handle ? `@${handle}'s profile face` : 'profile face'}
      className={cn(
        'relative inline-block shrink-0 overflow-hidden rounded-full bg-surface-2',
        ring && 'ring-2 ring-lime/40',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {isKit ? (
        <KitFace cfg={avatar} size={size} />
      ) : (
        <img
          src={faceSrc(resolveAvatarId(avatar, address))}
          alt=""
          draggable={false}
          className="absolute inset-0 h-full w-full select-none object-cover object-top"
        />
      )}
    </span>
  );
}
