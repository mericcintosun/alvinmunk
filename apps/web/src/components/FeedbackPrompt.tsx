'use client';

import { useEffect, useState } from 'react';
import { ThumbsDown, ThumbsUp, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { feedbackFormLink, feedbackFormUrl } from '@/lib/feedback';
import { useTranslations } from '@/lib/i18n';
import { getItem, setItem } from '@/lib/storage';
import { track } from '@/lib/track';
import { cn } from '@/lib/utils';

/** The key actions that ask for feedback, each at most once per browser. */
export type FeedbackAction = 'claim' | 'vouch';

export const feedbackSeenKey = (action: FeedbackAction) => `alvinmunk.feedback.${action}`;

/**
 * In-context feedback (#287): right after a claim or the first vouch, a dismissible
 * "how was that?" card — 👍 / 👎 plus "Tell us more", which opens the feedback form with
 * the handle and address prefilled (lib/feedback). It shows once per action: the first
 * time it appears is remembered in localStorage, so the next vouch goes unasked. Renders
 * nothing when no form is configured.
 */
export function FeedbackPrompt({
  action,
  handle,
  address,
  className,
}: {
  action: FeedbackAction;
  handle?: string | null;
  address?: string | null;
  className?: string;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [rated, setRated] = useState(false);

  // After mount: storage is client-only, and a server render must not guess.
  useEffect(() => {
    if (!feedbackFormUrl()) return;
    const key = feedbackSeenKey(action);
    if (getItem(key)) return;
    setItem(key, 'shown');
    setOpen(true);
  }, [action]);

  const href = feedbackFormLink({ handle, address });
  if (!open || !href) return null;

  function rate(rating: 'up' | 'down') {
    track('feedback_rated', { action, rating });
    setRated(true);
  }

  return (
    <section
      aria-label={t('feedback.prompt.label')}
      className={cn(
        'flex items-start justify-between gap-3 rounded-xl border border-border/60 bg-surface/40 p-3',
        className,
      )}
    >
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-foreground/90" aria-live="polite">
          {rated ? t('feedback.prompt.thanks') : t('feedback.prompt.question')}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {!rated && (
            <>
              <Button variant="outline" size="sm" onClick={() => rate('up')} className="gap-1.5 px-3">
                <ThumbsUp className="size-3.5" aria-hidden />
                <span className="text-xs">{t('feedback.prompt.up')}</span>
              </Button>
              <Button variant="outline" size="sm" onClick={() => rate('down')} className="gap-1.5 px-3">
                <ThumbsDown className="size-3.5" aria-hidden />
                <span className="text-xs">{t('feedback.prompt.down')}</span>
              </Button>
            </>
          )}
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              track('feedback_form_opened', { action });
              setRated(true); // keep the link mounted: a detached <a> doesn't navigate
            }}
            className="font-mono text-2xs uppercase tracking-wider text-primary/80 underline underline-offset-2 transition-colors hover:text-primary"
          >
            {t('feedback.prompt.more')}
          </a>
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(false)}
        aria-label={t('feedback.prompt.dismiss')}
        className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
      >
        <X className="size-3.5" />
      </Button>
    </section>
  );
}
