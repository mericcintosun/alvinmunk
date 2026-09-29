'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Share row — a Tweet-intent button + copy-link, in the technical voice. The OG image
 * does the visual heavy lifting on unfurl; this just gets the link out.
 */
export function ShareRow({ path, text, className }: { path: string; text: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  function getAbsoluteUrl() {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}${path}`;
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(getAbsoluteUrl());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  function tweet() {
    const url = getAbsoluteUrl();
    const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    window.open(tweetUrl, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <button
        onClick={tweet}
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'glass font-mono')}
      >
        𝕏&nbsp; tweet
      </button>
      <button
        onClick={copy}
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'glass font-mono')}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        {copied ? 'copied' : 'copy_link'}
      </button>
    </div>
  );
}
