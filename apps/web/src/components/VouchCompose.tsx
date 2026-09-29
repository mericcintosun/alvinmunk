'use client';

import React, { useState } from 'react';
import { Copy, Check, Share2, QrCode as QrCodeIcon } from 'lucide-react';
import { getWallet } from '@/lib/wallet';
import { clampVouchNote, claimLink, mintVouch, VOUCH_NOTE_MAX_CHARS } from '@/lib/reputation';
import { addMyVouch, subscribeToVouchPush } from '@/lib/myvouches';
import { Frame } from '@/components/fx/frame';
import { BorderBeam } from '@/components/fx/border-beam';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { StateArt } from '@/components/ui/state-art';
import { Sticker } from '@/components/ui/sticker';
import { QrCode } from '@/components/fx/qr-code';
import { humanizeError } from '@/lib/utils';
import { useTranslations, type TFn } from '@/lib/i18n';
import { track, trackError } from '@/lib/track';
import { toast } from '@/components/ui/toaster';

// Reputation contract error codes that can surface on mint_vouch_signed (mirrors the Error enum).
// Keys map to i18n keys so they're translated too.
function buildVouchErrors(t: TFn): Record<number, string> {
  return {
    6: t('vouch.error.self'),
    9: t('vouch.error.limit'),
    11: t('vouch.error.xp'),
    12: t('vouch.error.noteTooLong', { max: String(VOUCH_NOTE_MAX_CHARS) }),
  };
}

export function VouchCompose() {
  const t = useTranslations();
  const [note, setNote] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);

  async function onMint() {
    setBusy(true);
    setError(null);
    setLink(null);
    setShowQr(false);
    try {
      const wallet = await getWallet();
      const noteText = note.trim() || t('vouch.compose.defaultNote');
      const { id, seed } = await mintVouch(wallet, noteText);
      addMyVouch({ id, seed, note: noteText, created: Math.floor(Date.now() / 1000), walletAddress: wallet.address });
      // Fire-and-forget push subscription — silently ignored if VAPID not configured or
      // permission denied. User will be prompted by VouchClaimedNotice banner otherwise.
      subscribeToVouchPush(wallet.address, id).catch(() => {});
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      setLink(claimLink(origin, id, { kind: 'key', code: seed }));
      track('vouch_minted', { hasNote: note.trim().length > 0, walletKind: wallet.kind });
      toast.success(t('vouch.compose.toast.success'));
    } catch (e) {
      const msg = humanizeError(e, buildVouchErrors(t));
      trackError(e, { flow: 'vouch_mint' });
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError(t('vouch.compose.copyFail'));
    }
  }

  async function share() {
    if (!link) return;
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: t('vouch.compose.shareTitle'),
          text: note.trim() || undefined,
          url: link,
        });
        return;
      } catch {
        /* user dismissed the sheet — no-op */
      }
    }
    void copy();
  }

  const canNativeShare = typeof navigator !== 'undefined' && 'share' in navigator;

  return (
    <Frame label={t('vouch.compose.frame')} index="01" tape="tl">
      <div className="p-5">
        <h2 className="text-base font-semibold">{t('vouch.compose.title')}</h2>
        <p className="mb-3 mt-1 text-sm text-muted-foreground">
          {t('vouch.compose.subtitle')}
        </p>
        <Textarea
          value={note}
          onChange={(e) => setNote(clampVouchNote(e.target.value))}
          rows={2}
          placeholder={t('vouch.compose.placeholder')}
          className="mb-3"
        />
        <div className="relative w-full overflow-hidden rounded-full">
          <Button variant="flow" onClick={onMint} disabled={busy} className="w-full">
            {busy ? t('vouch.compose.buttonBusy') : t('vouch.compose.button')}
          </Button>
          {!busy && <BorderBeam size={56} duration={6} colorTo="hsl(var(--tertiary))" />}
        </div>

        {link && (
          <div className="mt-3 rounded-xl border border-secondary/30 bg-secondary/10 p-3">
            <div className="mb-2 flex items-center gap-3">
              <StateArt kind="vouch-sent" size={92} className="shrink-0 motion-safe:animate-ignite" />
              <p className="text-sm font-medium text-foreground">{t('vouch.compose.sent.msg')}</p>
            </div>
            <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Sticker name="doodle-arrow" size={22} className="h-4 w-auto" />
              {t('vouch.compose.sent.shareLabel')}
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate font-mono text-xs text-secondary">{link}</code>
              <Button variant="secondary" size="icon" onClick={copy} aria-label={t('vouch.compose.copy')}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
              {canNativeShare && (
                <Button variant="flow" size="icon" onClick={share} aria-label={t('vouch.compose.share')}>
                  <Share2 className="size-4" />
                </Button>
              )}
            </div>
            <a
              href={`https://twitter.com/intent/tweet?${new URLSearchParams({
                text: `${note.trim() || t('vouch.compose.shareXText')} ${t('vouch.compose.shareXSuffix')}`,
                url: link,
              }).toString()}`}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block font-mono text-[10px] uppercase tracking-wider text-tertiary hover:underline"
            >
              {t('vouch.compose.shareOnX')}
            </a>

            {/* The claim QR encodes the bearer secret in `link`, so it stays
                hidden until the user explicitly reveals it. */}
            <div className="mt-3 border-t border-secondary/20 pt-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowQr((v) => !v)}
                aria-expanded={showQr}
                aria-controls="vouch-claim-qr"
              >
                <QrCodeIcon className="size-4" />
                {showQr ? t('vouch.compose.qr.hide') : t('vouch.compose.qr.show')}
              </Button>
              {showQr && (
                <div id="vouch-claim-qr" className="mt-3 flex flex-col items-center gap-2">
                  <QrCode value={link} label={t('vouch.compose.qr.alt')} />
                  <p className="max-w-xs text-center text-xs text-destructive">
                    {t('vouch.compose.qr.warning')}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </div>
    </Frame>
  );
}
