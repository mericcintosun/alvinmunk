'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { getWallet } from '@/lib/wallet';
import { mintVouch } from '@/lib/reputation';
import { addMyVouch } from '@/lib/myvouches';
import { buildClaimUrl } from '@passport/shared';
import { Frame } from '@/components/fx/frame';
import { BorderBeam } from '@/components/fx/border-beam';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

/**
 * Vouch compose — the async half-card mint. You write one line and get a shareable link
 * bound to a claim-secret; no recipient address needed (cold-start fix). Whoever opens
 * the link claims it and their star ignites.
 */
export function VouchCompose() {
  const [note, setNote] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onMint() {
    setBusy(true);
    setError(null);
    setLink(null);
    try {
      const wallet = await getWallet();
      const noteText = note.trim() || 'vouched for you';
      const { id, secret } = await mintVouch(wallet, noteText);
      // remember it locally so the dashboard can resurface it if it stays unclaimed
      addMyVouch({ id, secret, note: noteText, created: Math.floor(Date.now() / 1000) });
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      setLink(`${buildClaimUrl(origin, id)}?s=${secret}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'mint failed');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Frame label="vouch // mint" index="01">
      <div className="p-5">
        <h2 className="text-base font-semibold">Vouch for someone you trust</h2>
        <p className="mb-3 mt-1 text-sm text-muted-foreground">
          Why them? One line. No address needed — share the link, their star ignites.
        </p>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={60}
          rows={2}
          placeholder="unblocked me at 2am"
          className="mb-3"
        />
        <div className="relative w-full overflow-hidden rounded-full">
          <Button variant="flow" onClick={onMint} disabled={busy} className="w-full">
            {busy ? 'Lighting their star…' : 'Light their star'}
          </Button>
          {!busy && <BorderBeam size={56} duration={6} colorTo="hsl(var(--tertiary))" />}
        </div>

        {link && (
          <div className="mt-3 rounded-xl border border-secondary/30 bg-secondary/10 p-3">
            <p className="mb-2 text-xs text-muted-foreground">Share their half of the sky:</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate font-mono text-xs text-secondary">{link}</code>
              <Button variant="secondary" size="icon" onClick={copy} aria-label="Copy link">
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
          </div>
        )}

        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </div>
    </Frame>
  );
}
