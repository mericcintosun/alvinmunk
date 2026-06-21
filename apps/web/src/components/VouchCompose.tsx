'use client';

import { useState } from 'react';
import { getWallet } from '@/lib/wallet';
import { mintVouch } from '@/lib/reputation';
import { buildClaimUrl } from '@passport/shared';

/**
 * Vouch compose (Yellow belt) — the async half-card mint. You write one line and get
 * a shareable link bound to a claim-secret; you do NOT need the recipient's address
 * (cold-start fix). Whoever opens the link claims it and their side blooms.
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
      const { id, secret } = await mintVouch(wallet, note.trim() || 'vouched for you');
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
    <section className="w-full rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <h2 className="mb-1 text-sm font-semibold text-white/80">Vouch for someone</h2>
      <p className="mb-3 text-[11px] text-white/40">
        No address needed — share the link with anyone. They claim, their side blooms.
      </p>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={60}
        placeholder="one line — e.g. “unblocked me at 2am”"
        className="mb-3 w-full rounded-lg bg-white/5 px-3 py-2 text-sm outline-none ring-1 ring-white/10 focus:ring-stellar"
      />
      <button
        onClick={onMint}
        disabled={busy}
        className="w-full rounded-full bg-stellar py-2.5 text-sm font-semibold text-ink active:scale-95 disabled:opacity-50"
      >
        {busy ? 'Minting…' : 'Mint half-card'}
      </button>

      {link && (
        <div className="mt-3 rounded-lg bg-sigil/10 p-3 ring-1 ring-sigil/30">
          <p className="mb-1 text-[11px] text-white/50">Share this — their side blooms when they claim:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate text-xs text-sigil">{link}</code>
            <button onClick={copy} className="rounded bg-white/10 px-2 py-1 text-[11px]">
              {copied ? 'copied' : 'copy'}
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </section>
  );
}
