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
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const url = `${origin}${path}`;
  const tweet = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
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
        𝕏&nbsp; tweet
      </a>
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
