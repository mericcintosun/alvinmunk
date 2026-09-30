'use client';

import { HANDLE_MAX_CHARS, HANDLE_MIN_CHARS, removedHandleChars } from '@/lib/profile';
import { useTranslations } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * The line under a handle field (landing, /app onboarding, /claim): the handle rules before
 * anything is typed, and — once `normalizeHandle` drops characters — which ones and why, so
 * "Ayşe K" turning into "@ayek" is never silent (#479). A polite live region, and `min-h-4`
 * rather than `h-4`, so a wrapped line pushes the next control down instead of covering it.
 */
export function HandleHint({ id, value, className }: { id: string; value: string; className?: string }) {
  const t = useTranslations();
  const removed = removedHandleChars(value);
  const bounds = { min: String(HANDLE_MIN_CHARS), max: String(HANDLE_MAX_CHARS) };
  return (
    <p
      id={id}
      aria-live="polite"
      className={cn('min-h-4 text-xs', removed.length ? 'text-foreground' : 'text-muted-foreground', className)}
    >
      {removed.length
        ? t('handle.removed', {
            ...bounds,
            chars: removed.map((c) => (c === ' ' ? t('handle.space') : `“${c}”`)).join(', '),
          })
        : t('handle.rules', bounds)}
    </p>
  );
}
