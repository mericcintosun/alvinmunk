'use client';

import { useEffect, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useTranslations } from '@/lib/i18n';

/**
 * Share row — a Tweet-intent button + copy-link, in the technical voice. The OG image
 * does the visual heavy lifting on unfurl; this just gets the link out.
 *
 * The origin is read after mount, never during render: the server has no `window`, so a
 * render-time read made the server HTML and the hydrated client disagree, and React kept
 * the server's relative `url=` in the tweet link (#222).
 */
export function ShareRow({ path, text, className }: { path: string; text: string; className?: string }) {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);

  const url = `${origin}${path}`;
  const tweet = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <a
        href={tweet}
        target="_blank"
        rel="noreferrer"
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'glass font-mono')}
      >
        𝕏&nbsp; {t('shareRow.tweet')}
      </a>
      <button
        onClick={copy}
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'glass font-mono')}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        {copied ? t('shareRow.copied') : t('shareRow.copyLink')}
      </button>
    </div>
  );
}
