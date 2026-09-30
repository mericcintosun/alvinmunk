'use client';

import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Frame } from '@/components/fx/frame';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useTranslations } from '@/lib/i18n';

/**
 * "Embed your badge" (#283) — the copyable Markdown and HTML for
 * `GET /api/badge/<handle>`. Every embedded badge links back to `/u/<handle>`, so this is
 * the acquisition surface the route exists for.
 *
 * Absolute URLs, like ShareRow: the origin is read after mount, never during render, so the
 * server HTML and the hydrated client agree.
 */

/** The two snippets, given an origin ('' before mount → the paths stay relative). */
export function badgeSnippets(origin: string, handle: string) {
  const badge = `${origin}/api/badge/${handle}`;
  const profile = `${origin}/u/${handle}`;
  const alt = `@${handle} on alvinmunk`;
  return {
    markdown: `[![${alt}](${badge})](${profile})`,
    html: `<a href="${profile}"><img src="${badge}" alt="${alt}" /></a>`,
  };
}

export function EmbedBadge({ handle }: { handle: string }) {
  const t = useTranslations();
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);
  const { markdown, html } = badgeSnippets(origin, handle);

  return (
    <Frame label={`embed // @${handle}`} index="SVG">
      <div className="space-y-4 p-6">
        <div>
          <h2 className="font-display text-lg font-semibold">{t('embed.title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground text-balance">
            {t('embed.body', { handle })}
          </p>
        </div>
        <Snippet label={t('embed.label.markdown')} code={markdown} />
        <Snippet label={t('embed.label.html')} code={html} />
        <p className="font-mono text-2xs leading-relaxed text-muted-foreground">
          {t('embed.styleHint')}
        </p>
      </div>
    </Frame>
  );
}

function Snippet({ label, code }: { label: string; code: string }) {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="eyebrow-mono">
          {label}
        </span>
        <button
          type="button"
          onClick={copy}
          aria-label={`${t('embed.copy')} — ${label}`}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'glass font-mono')}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? t('embed.copied') : t('embed.copy')}
        </button>
      </div>
      <code className="block overflow-x-auto whitespace-pre rounded-md border border-border/60 bg-muted/30 p-3 font-mono text-xs">
        {code}
      </code>
    </div>
  );
}
