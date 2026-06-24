import { KIT_LAYERS, KIT_REF_W, kitSrc, type KitAvatar } from '@/lib/avatar';

/**
 * Renders a remixed portrait-kit avatar by stacking its layers (bg → skin → hair → eyes
 * → mouth → accessory) at calibrated anchors. Geometry comes from KIT_LAYERS (a 200px
 * reference), scaled by size/200 — so every combination lands as a coherent face.
 */
export function KitFace({ cfg, size }: { cfg: KitAvatar; size: number }) {
  const k = size / KIT_REF_W;
  return (
    <div className="relative overflow-hidden" style={{ width: size, height: size }}>
      {KIT_LAYERS.map((layer, z) => {
        const idx = cfg[layer.field] as number | null;
        if (!idx) return null;
        if (layer.cover) {
          return (
            <img
              key={layer.cat}
              src={kitSrc(layer.cat, idx)}
              alt=""
              draggable={false}
              className="absolute inset-0 h-full w-full select-none object-cover"
              style={{ zIndex: z }}
            />
          );
        }
        return (
          <img
            key={layer.cat}
            src={kitSrc(layer.cat, idx)}
            alt=""
            draggable={false}
            className="absolute select-none"
            style={{
              width: layer.wRef * k,
              left: '50%',
              top: layer.topRef * k,
              transform: 'translateX(-50%)',
              zIndex: z,
            }}
          />
        );
      })}
    </div>
  );
}
