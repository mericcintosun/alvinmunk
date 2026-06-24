'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, Shuffle } from 'lucide-react';
import { KIT_COUNTS, defaultKit, type KitAvatar, type KitCategory } from '@/lib/avatar';
import { KitFace } from '@/components/KitFace';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const CATS: { field: KitCategory; label: string; optional?: boolean }[] = [
  { field: 'skin', label: 'Skin' },
  { field: 'hair', label: 'Hair' },
  { field: 'eyes', label: 'Eyes' },
  { field: 'mouth', label: 'Mouth' },
  { field: 'acc', label: 'Hat', optional: true },
  { field: 'bg', label: 'Backdrop', optional: true },
];

/**
 * "Remix your face" — build an avatar from the layered portrait kit. Each category cycles
 * with ◀ ▶ (optional categories include an off state); a shuffle seeds a fresh combo.
 * Live preview via <KitFace>. Pick-don't-type: no free input, every combo is valid.
 */
export function AvatarRemix({
  seed,
  initial,
  onSave,
  onCancel,
}: {
  seed: string;
  initial?: KitAvatar;
  onSave: (cfg: KitAvatar) => void;
  onCancel?: () => void;
}) {
  const [cfg, setCfg] = useState<KitAvatar>(initial ?? defaultKit(seed));

  function cycle(field: KitCategory, dir: 1 | -1) {
    const max = KIT_COUNTS[field];
    const optional = field === 'acc' || field === 'bg';
    setCfg((c) => {
      const cur = (c[field] as number | null) ?? 0; // null → 0 (off)
      let n = cur + dir;
      const lo = optional ? 0 : 1;
      if (n < lo) n = max;
      if (n > max) n = lo;
      return { ...c, [field]: n === 0 ? null : n };
    });
  }

  function valueLabel(field: KitCategory): string {
    const v = cfg[field] as number | null;
    if ((field === 'acc' || field === 'bg') && v === null) return 'off';
    return `${v}/${KIT_COUNTS[field]}`;
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="rounded-full ring-2 ring-lime/40">
        <KitFace cfg={cfg} size={128} />
      </div>

      <div className="grid w-full max-w-xs grid-cols-1 gap-1.5">
        {CATS.map(({ field, label }) => (
          <div key={field} className="flex items-center justify-between gap-2 rounded-lg bg-surface/40 px-2 py-1">
            <span className="w-16 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              {label}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => cycle(field, -1)}
                className="grid size-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                aria-label={`Previous ${label}`}
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="w-10 text-center font-mono text-[10px] text-foreground/80">
                {valueLabel(field)}
              </span>
              <button
                onClick={() => cycle(field, 1)}
                className="grid size-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                aria-label={`Next ${label}`}
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex w-full max-w-xs items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCfg(defaultKit(`${seed}-${Math.floor(Math.random() * 1e9)}`))}
          className={cn('glass shrink-0')}
          aria-label="Shuffle"
        >
          <Shuffle className="size-4" />
        </Button>
        <Button variant="flow" size="sm" onClick={() => onSave(cfg)} className="flex-1">
          Save my face
        </Button>
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
