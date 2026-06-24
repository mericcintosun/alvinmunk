import { cn } from '@/lib/utils';
import { STICKER, TAPE, asset, type StickerName, type TapeCorner } from '@/lib/assets';

/**
 * A decorative sticker from the asset kit. Rendered as a plain <img> (unoptimized →
 * lossless), non-interactive and unselectable. Height is derived from the intrinsic
 * aspect ratio; `size` is the rendered WIDTH and should stay at or below intrinsic.
 */
export function Sticker({
  name,
  size,
  rotate,
  pixelated = false,
  alt = '',
  className,
}: {
  name: StickerName;
  size?: number;
  rotate?: number;
  pixelated?: boolean;
  alt?: string;
  className?: string;
}) {
  const m = STICKER[name];
  const width = size ?? m.w;
  const height = Math.round((width / m.w) * m.h);
  return (
    <img
      src={asset(m.file)}
      alt={alt}
      width={width}
      height={height}
      draggable={false}
      aria-hidden={alt === '' ? true : undefined}
      style={rotate ? { transform: `rotate(${rotate}deg)` } : undefined}
      className={cn(
        'pointer-events-none select-none',
        pixelated && '[image-rendering:pixelated]',
        className,
      )}
    />
  );
}

/** A washi-tape corner decal — absolutely positioned onto a card corner. */
export function Tape({
  corner,
  size = 60,
  className,
}: {
  corner: TapeCorner;
  size?: number;
  className?: string;
}) {
  const m = TAPE[corner];
  const width = size;
  const height = Math.round((width / m.w) * m.h);
  const pos: Record<TapeCorner, string> = {
    tl: '-left-2 -top-2',
    tr: '-right-2 -top-2',
    bl: '-bottom-2 -left-2',
    br: '-bottom-2 -right-2',
  };
  return (
    <img
      src={asset(m.file)}
      alt=""
      aria-hidden
      width={width}
      height={height}
      draggable={false}
      className={cn('pointer-events-none absolute select-none opacity-90', pos[corner], className)}
    />
  );
}
