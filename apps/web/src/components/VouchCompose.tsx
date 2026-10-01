'use client';

import React, { useId, useState } from 'react';
import { Copy, Check, Share2, Plus, X, QrCode as QrCodeIcon } from 'lucide-react';
import { getWallet } from '@/lib/wallet';
import {
  clampVouchNote,
  claimLink,
  mintVouch,
  mintVouches,
  VOUCH_BATCH_MAX,
  VOUCH_NOTE_MAX_CHARS,
  vouchNoteChars,
} from '@/lib/reputation';
import { addMyVouch, subscribeToVouchPush } from '@/lib/myvouches';
import { Frame } from '@/components/fx/frame';
import { BorderBeam } from '@/components/fx/border-beam';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { StateArt } from '@/components/ui/state-art';
import { Sticker } from '@/components/ui/sticker';
import { QrCode } from '@/components/fx/qr-code';
import { humanizeError } from '@/lib/utils';
import { useTranslations, type TFn } from '@/lib/i18n';
import { track, trackError } from '@/lib/track';
import { toast } from '@/components/ui/toaster';
import { useWallet } from '@/components/wallet/wallet-provider';
import { FeedbackPrompt } from '@/components/FeedbackPrompt';

// Reputation contract error codes that can surface on mint_vouch_signed / mint_vouches
// (mirrors the Error enum). Keys map to i18n keys so they're translated too.
function buildVouchErrors(t: TFn): Record<number, string> {
  return {
    6: t('vouch.error.self'),
    9: t('vouch.error.limit'),
    11: t('vouch.error.xp'),
    12: t('vouch.error.noteTooLong', { max: String(VOUCH_NOTE_MAX_CHARS) }),
    15: t('vouch.error.batchSize', { max: String(VOUCH_BATCH_MAX) }),
  };
}

/** Rows the "several people" form opens with — fewer is the one-person form. */
const BATCH_MIN_ROWS = 2;

/** From this many characters left, the counter speaks up (aria-live) as you type. */
const NOTE_NEAR_LIMIT = 10;

/** True when the note cap cut something off `raw` (a long paste, or typing past the cap). */
const wasCut = (raw: string) => clampVouchNote(raw) !== raw;

/** One card of a batch, as the result list shows it. */
interface BatchCard {
  id: number;
  note: string;
  link: string;
}

export function VouchCompose() {
  const t = useTranslations();
  const { profile } = useWallet();
  const [mode, setMode] = useState<'one' | 'many'>('one');
  const [note, setNote] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>(() => Array(BATCH_MIN_ROWS).fill(''));
  const [cards, setCards] = useState<BatchCard[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [noteCut, setNoteCut] = useState(false);
  const noteId = useId();

  function switchMode(next: 'one' | 'many') {
    if (busy || next === mode) return;
    setMode(next);
    setError(null);
  }

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

  /** One signature for the whole cohort: every row becomes its own card and link. */
  async function onMintBatch() {
    setBusy(true);
    setError(null);
    setCards([]);
    try {
      const wallet = await getWallet();
      const noteTexts = notes.map((n) => n.trim() || t('vouch.compose.defaultNote'));
      const minted = await mintVouches(wallet, noteTexts);
      const created = Math.floor(Date.now() / 1000);
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const out = minted.map(({ id, seed }, i) => {
        addMyVouch({ id, seed, note: noteTexts[i], created, walletAddress: wallet.address });
        return { id, note: noteTexts[i], link: claimLink(origin, id, { kind: 'key', code: seed }) };
      });
      setCards(out);
      // Fire-and-forget, one card at a time so the permission prompt and the push
      // subscription are set up once, not raced by every card.
      void (async () => {
        for (const { id } of out) await subscribeToVouchPush(wallet.address, id).catch(() => {});
      })();
      track('vouch_batch_minted', {
        count: out.length,
        withNotes: notes.filter((n) => n.trim()).length,
        walletKind: wallet.kind,
      });
      toast.success(t('vouch.compose.batch.toast', { count: String(out.length) }));
    } catch (e) {
      const msg = humanizeError(e, buildVouchErrors(t));
      trackError(e, { flow: 'vouch_mint_batch' });
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  function setRow(i: number, value: string) {
    setNotes((rows) => rows.map((r, j) => (j === i ? clampVouchNote(value) : r)));
  }

  /** Copy `text` and flash the check on the button keyed `key`. */
  async function copyText(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      setError(t('vouch.compose.copyFail'));
    }
  }

  async function copy() {
    if (link) await copyText(link, 'single');
  }

  function copyAll() {
    const text = cards
      .map((c, i) => `${t('vouch.compose.batch.cardLabel', { n: String(i + 1) })} — ${c.note}\n${c.link}`)
      .join('\n\n');
    void copyText(text, 'all');
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
        <div role="group" aria-label={t('vouch.compose.mode')} className="mb-3 flex gap-2">
          {(['one', 'many'] as const).map((m) => (
            <Button
              key={m}
              variant={mode === m ? 'secondary' : 'ghost'}
              size="sm"
              aria-pressed={mode === m}
              disabled={busy}
              onClick={() => switchMode(m)}
            >
              {t(m === 'one' ? 'vouch.compose.mode.one' : 'vouch.compose.mode.many')}
            </Button>
          ))}
        </div>

        {mode === 'many' ? (
          <BatchForm
            t={t}
            notes={notes}
            busy={busy}
            cards={cards}
            copied={copied}
            onRow={setRow}
            onAdd={() => setNotes((rows) => (rows.length < VOUCH_BATCH_MAX ? [...rows, ''] : rows))}
            onRemove={(i) => setNotes((rows) => rows.filter((_, j) => j !== i))}
            onMint={onMintBatch}
            onCopy={(c) => void copyText(c.link, `card-${c.id}`)}
            onCopyAll={copyAll}
          />
        ) : (
          <>
            <label htmlFor={noteId} className="mb-1 block text-sm font-medium">
              {t('vouch.compose.note.label')}
            </label>
            <Textarea
              id={noteId}
              value={note}
              onChange={(e) => {
                setNoteCut(wasCut(e.target.value));
                setNote(clampVouchNote(e.target.value));
              }}
              rows={2}
              placeholder={t('vouch.compose.placeholder')}
              aria-describedby={`${noteId}-count`}
              className="mb-1"
            />
            <NoteMeta id={noteId} t={t} value={note} cut={noteCut} className="mb-3" />
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
                    {copied === 'single' ? <Check className="size-4" /> : <Copy className="size-4" />}
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
                  className="mt-2 inline-block font-mono text-2xs uppercase tracking-wider text-tertiary hover:underline"
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
          </>
        )}

        {/* After the first vouch — a single card or a cohort — ask once (#287). */}
        {(mode === 'one' ? link !== null : cards.length > 0) && (
          <FeedbackPrompt
            action="vouch"
            handle={profile?.handle}
            address={profile?.address}
            className="mt-3"
          />
        )}

        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </div>
    </Frame>
  );
}

/**
 * Under a note field: the live `n/60` counter (announced politely once the note nears the
 * cap, silent before that so every keystroke isn't read out), and a status line that says
 * when the cap cut text off. The status element is always mounted so its message is
 * announced when it appears.
 */
function NoteMeta({
  id,
  t,
  value,
  cut,
  className,
}: {
  id: string;
  t: TFn;
  value: string;
  cut: boolean;
  className?: string;
}) {
  const count = vouchNoteChars(value);
  const near = count >= VOUCH_NOTE_MAX_CHARS - NOTE_NEAR_LIMIT;
  const vars = { count: String(count), max: String(VOUCH_NOTE_MAX_CHARS) };
  return (
    <div className={`flex items-center justify-between gap-2 text-xs ${className ?? ''}`}>
      <p role="status" className="text-destructive">
        {cut ? t('vouch.compose.note.truncated', { max: vars.max }) : ''}
      </p>
      <p
        id={`${id}-count`}
        aria-live={near ? 'polite' : 'off'}
        className={`shrink-0 font-mono ${near ? 'text-foreground' : 'text-muted-foreground'}`}
      >
        <span aria-hidden="true">
          {count}/{VOUCH_NOTE_MAX_CHARS}
        </span>
        <span className="sr-only">{t('vouch.compose.note.count', vars)}</span>
      </p>
    </div>
  );
}

/** The cohort form: one note per person, minted together, then every link listed. */
function BatchForm({
  t,
  notes,
  busy,
  cards,
  copied,
  onRow,
  onAdd,
  onRemove,
  onMint,
  onCopy,
  onCopyAll,
}: {
  t: TFn;
  notes: string[];
  busy: boolean;
  cards: BatchCard[];
  copied: string | null;
  onRow: (i: number, value: string) => void;
  onAdd: () => void;
  onRemove: (i: number) => void;
  onMint: () => void;
  onCopy: (card: BatchCard) => void;
  onCopyAll: () => void;
}) {
  const rowId = useId();
  /** The row whose last edit the cap cut, if any. */
  const [cutRow, setCutRow] = useState<number | null>(null);
  return (
    <>
      <p className="mb-2 text-xs text-muted-foreground">
        {t('vouch.compose.batch.hint', { max: String(VOUCH_BATCH_MAX) })}
      </p>
      <ol className="mb-3 flex flex-col gap-2">
        {notes.map((n, i) => {
          const label = t('vouch.compose.batch.cardLabel', { n: String(i + 1) });
          const id = `${rowId}-${i}`;
          return (
            <li key={i} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="w-6 shrink-0 font-mono text-xs text-muted-foreground">{i + 1}</span>
                <Input
                  value={n}
                  onChange={(e) => {
                    setCutRow(wasCut(e.target.value) ? i : null);
                    onRow(i, e.target.value);
                  }}
                  placeholder={t('vouch.compose.placeholder')}
                  aria-label={label}
                  aria-describedby={`${id}-count`}
                  disabled={busy}
                />
                {notes.length > BATCH_MIN_ROWS && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setCutRow(null); // rows below shift up; the notice would land on another
                      onRemove(i);
                    }}
                    disabled={busy}
                    aria-label={t('vouch.compose.batch.remove', { n: String(i + 1) })}
                  >
                    <X className="size-4" />
                  </Button>
                )}
              </div>
              <NoteMeta id={id} t={t} value={n} cut={cutRow === i} className="pl-8" />
            </li>
          );
        })}
      </ol>
      <Button
        variant="outline"
        size="sm"
        onClick={onAdd}
        disabled={busy || notes.length >= VOUCH_BATCH_MAX}
        className="mb-3"
      >
        <Plus className="size-4" />
        {t('vouch.compose.batch.add')}
      </Button>
      <div className="relative w-full overflow-hidden rounded-full">
        <Button variant="flow" onClick={onMint} disabled={busy} className="w-full">
          {busy
            ? t('vouch.compose.batch.buttonBusy')
            : t('vouch.compose.batch.button', { count: String(notes.length) })}
        </Button>
        {!busy && <BorderBeam size={56} duration={6} colorTo="hsl(var(--tertiary))" />}
      </div>

      {cards.length > 0 && (
        <div className="mt-3 rounded-xl border border-secondary/30 bg-secondary/10 p-3">
          <div className="mb-2 flex items-center gap-3">
            <StateArt kind="vouch-sent" size={92} className="shrink-0 motion-safe:animate-ignite" />
            <p className="text-sm font-medium text-foreground">
              {t('vouch.compose.batch.sent', { count: String(cards.length) })}
            </p>
          </div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Sticker name="doodle-arrow" size={22} className="h-4 w-auto" />
              {t('vouch.compose.batch.shareLabel')}
            </p>
            <Button variant="secondary" size="sm" onClick={onCopyAll}>
              {copied === 'all' ? <Check className="size-4" /> : <Copy className="size-4" />}
              {t('vouch.compose.batch.copyAll')}
            </Button>
          </div>
          <ol className="flex flex-col gap-2">
            {cards.map((c, i) => (
              <li key={c.id} className="rounded-lg border border-border/40 bg-background/40 p-2">
                <p className="mb-1 truncate text-xs font-medium text-foreground">
                  {t('vouch.compose.batch.cardLabel', { n: String(i + 1) })} — {c.note}
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate font-mono text-xs text-secondary">{c.link}</code>
                  <Button
                    variant="secondary"
                    size="icon"
                    onClick={() => onCopy(c)}
                    aria-label={t('vouch.compose.batch.copyOne', { n: String(i + 1) })}
                  >
                    {copied === `card-${c.id}` ? <Check className="size-4" /> : <Copy className="size-4" />}
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </>
  );
}
