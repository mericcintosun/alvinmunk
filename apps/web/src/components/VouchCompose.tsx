'use client';

import { useState } from 'react';
import { getWallet } from '@/lib/wallet';
import { mintVouch } from '@/lib/reputation';
import { buildClaimUrl } from '@passport/shared';

/**
 * Vouch compose (Yellow belt) — the async half-card mint. You vouch AT someone
 * (by address for now; handle resolution comes later) and get a shareable link =
 * the install funnel. No "two people present" requirement.
 */
export function VouchCompose() {
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validAddr = /^[GC][A-Z2-7]{55}$/.test(to.trim());

  async function onMint() {
    setBusy(true);
    setError(null);
    setLink(null);
    try {
      const wallet = await getWallet();
      const id = await mintVouch(wallet, to.trim(), note.trim() || 'vouched for you');
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      setLink(buildClaimUrl(origin, id));
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
      <h2 className="mb-3 text-sm font-semibold text-white/80">Vouch for someone</h2>
      <input
        value={to}
        onChange={(e) => setTo(e.target.value)}
        placeholder="their address (G… / C…)"
        className="mb-2 w-full rounded-lg bg-white/5 px-3 py-2 text-xs outline-none ring-1 ring-white/10 focus:ring-stellar"
      />
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={60}
        placeholder="one line — e.g. “unblocked me at 2am”"
        className="mb-3 w-full rounded-lg bg-white/5 px-3 py-2 text-sm outline-none ring-1 ring-white/10 focus:ring-stellar"
      />
      <button
        onClick={onMint}
        disabled={busy || !validAddr}
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
