'use client';

/**
 * FeedbackPrompt — a lightweight thumbs-up / thumbs-down card shown once after a key
 * action (claim or first vouch). Behaviour:
 *
 *  • Hidden entirely when NEXT_PUBLIC_FEEDBACK_FORM_URL is unset.
 *  • Shown at most once per `storageKey`; dismissal (any button) is persisted in
 *    localStorage so it never reappears on the same device.
 *  • "Tell us more" opens the Google Form with `handle` and `address` pre-filled via
 *    `entry.*` query params passed in through `prefill`.
 *  • Thumbs up/down fire first, then automatically open the form.
 */

import { useState, useEffect } from 'react';
import { ThumbsUp, ThumbsDown, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getItem, setItem } from '@/lib/storage';
import { useTranslations } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const FORM_URL = process.env.NEXT_PUBLIC_FEEDBACK_FORM_URL ?? '';

export interface FeedbackPromptProps {
  /**
   * Unique localStorage key for dismissal state, e.g. "feedback:claim" or
   * "feedback:vouch". The component is shown at most once per key per device.
   */
  storageKey: string;
  /**
   * Optional query-param pairs that pre-fill the Google Form.
   * Keys must match the form's `entry.*` field names.
   * Example: { 'entry.123': '@beko', 'entry.456': 'GABC…' }
   */
  prefill?: Record<string, string>;
  className?: string;
}

export function FeedbackPrompt({ storageKey, prefill, className }: FeedbackPromptProps) {
  const t = useTranslations();

  // Don't render at all when the env var is unset.
  const [mounted, setMounted] = useState(false);
  const [dismissed, setDismissed] = useState(true); // safe default: hidden on SSR

  useEffect(() => {
    setMounted(true);
    setDismissed(getItem(storageKey) === 'dismissed');
  }, [storageKey]);

  if (!FORM_URL || !mounted || dismissed) return null;

  function dismiss() {
    setItem(storageKey, 'dismissed');
    setDismissed(true);
  }

  function buildFormUrl(sentiment?: 'up' | 'down'): string {
    const params = new URLSearchParams(prefill ?? {});
    if (sentiment) params.set('entry.sentiment', sentiment === 'up' ? '👍' : '👎');
    const qs = params.toString();
    return qs ? `${FORM_URL}?${qs}` : FORM_URL;
  }

  function onThumb(sentiment: 'up' | 'down') {
    dismiss();
    window.open(buildFormUrl(sentiment), '_blank', 'noopener,noreferrer');
  }

  function onTellUsMore() {
    dismiss();
    window.open(buildFormUrl(), '_blank', 'noopener,noreferrer');
  }

  return (
    <div
      role="region"
      aria-label={t('feedback.prompt.ariaLabel')}
      className={cn(
        'flex items-start justify-between gap-3 rounded-xl border border-border/60 bg-surface/40 p-3',
        className,
      )}
    >
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-foreground/90">{t('feedback.prompt.question')}</p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onThumb('up')}
            aria-label={t('feedback.prompt.thumbsUp')}
            className="gap-1.5 px-3"
          >
            <ThumbsUp className="size-3.5" />
            <span className="text-xs">{t('feedback.prompt.thumbsUp')}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onThumb('down')}
            aria-label={t('feedback.prompt.thumbsDown')}
            className="gap-1.5 px-3"
          >
            <ThumbsDown className="size-3.5" />
            <span className="text-xs">{t('feedback.prompt.thumbsDown')}</span>
          </Button>
          <button
            onClick={onTellUsMore}
            className="font-mono text-[10px] uppercase tracking-wider text-primary/70 underline underline-offset-2 transition-colors hover:text-primary"
          >
            {t('feedback.prompt.tellUsMore')}
          </button>
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={dismiss}
        aria-label={t('feedback.prompt.dismiss')}
        className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
