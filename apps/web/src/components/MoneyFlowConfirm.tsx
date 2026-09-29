'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/Avatar';
import { getItem, setItem } from '@/lib/storage';
import { config } from '@/lib/stellar';
import { useTranslations } from '@/lib/i18n';

/** Mainnet USDC is real and irreversible; testnet flows skip the confirmation (#291). */
export const isRealMoney = (): boolean => config.network === 'mainnet';

/** How long a confirmed tip waits, cancellable, before the wallet is asked to sign. */
export const UNDO_MS = 5_000;

const TIPPED_KEY = 'alvinmunk.mainnet.tipped';
/** Has this device sent a mainnet tip? The first one needs an explicit acknowledgement. */
export const hasTippedOnMainnet = (): boolean => getItem(TIPPED_KEY) === '1';
export const rememberMainnetTip = (): void => {
  setItem(TIPPED_KEY, '1');
};

export interface MoneyConfirmRequest {
  kind: 'tip' | 'claim';
  /** Where the USDC goes: the RESOLVED address, never just what was typed. */
  to: string;
  /** Its @handle, when the recipient was picked by one. */
  handle?: string | null;
  /** The amount in USDC, as shown to the user. */
  amount: string;
}

/**
 * The real-money confirmation for a mainnet tip or reward claim: who receives it (face,
 * @handle and the full address), how much, and that it can't be reversed. A tip then waits
 * UNDO_MS with an Undo button before `onConfirm` — the call that reaches the wallet — so a
 * cancelled tip never touches it; a claim runs `onConfirm` straight away. Mount it per
 * request: unmounting (cancel, or leaving the page) drops a pending send.
 */
export function MoneyFlowConfirm({
  request,
  requireAck = false,
  onCancel,
  onConfirm,
}: {
  request: MoneyConfirmRequest;
  /** The first mainnet tip on this device: confirming needs the checkbox ticked. */
  requireAck?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations();
  const titleId = useId();
  const [ack, setAck] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(UNDO_MS / 1000);
  const onConfirmRef = useRef(onConfirm);
  onConfirmRef.current = onConfirm;
  const tip = request.kind === 'tip';

  useEffect(() => {
    if (!undoing) return;
    const started = Date.now();
    const tick = setInterval(
      () => setSecondsLeft(Math.max(0, Math.ceil((UNDO_MS - (Date.now() - started)) / 1000))),
      250,
    );
    const send = setTimeout(() => {
      clearInterval(tick);
      onConfirmRef.current();
    }, UNDO_MS);
    return () => {
      clearInterval(tick);
      clearTimeout(send);
    };
  }, [undoing]);

  const confirm = () => (tip ? setUndoing(true) : onConfirm());

  return (
    <Dialog open onClose={onCancel} labelledBy={titleId}>
      <div className="flex flex-col gap-4">
        <div>
          <h2 id={titleId} className="text-lg font-semibold">
            {tip ? t('moneyFlowConfirm.tipTitle') : t('moneyFlowConfirm.claimTitle')}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {tip ? t('moneyFlowConfirm.tipSubtitle') : t('moneyFlowConfirm.claimSubtitle')}
          </p>
        </div>

        <div className="flex items-center gap-3 rounded-xl border border-border bg-background/60 p-4">
          <Avatar address={request.to} size={48} />
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              {tip ? t('moneyFlowConfirm.to') : t('moneyFlowConfirm.claimTo')}
            </p>
            <p className="font-medium">
              {request.handle ? `@${request.handle}` : tip ? t('moneyFlowConfirm.noHandle') : null}
            </p>
            <p className="break-all font-mono text-xs text-muted-foreground" data-testid="money-confirm-address">
              {request.to}
            </p>
          </div>
        </div>

        <p className="text-center text-2xl font-bold text-primary">{request.amount} USDC</p>

        <p className="rounded-lg bg-destructive/10 p-3 text-sm font-medium text-destructive">
          {t('moneyFlowConfirm.realMoneyWarning')}
        </p>

        {undoing ? (
          <div className="flex flex-col gap-2">
            <p className="text-center text-sm font-medium" aria-live="polite">
              {t('moneyFlowConfirm.sendingIn', { seconds: String(secondsLeft) })}
            </p>
            <Button variant="outline" size="lg" className="w-full" onClick={onCancel} autoFocus>
              {t('moneyFlowConfirm.undo')}
            </Button>
          </div>
        ) : (
          <>
            {requireAck && (
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 size-5 shrink-0 rounded border-border"
                  checked={ack}
                  onChange={(e) => setAck(e.target.checked)}
                />
                <span className="text-sm text-muted-foreground">{t('moneyFlowConfirm.firstTipCheckbox')}</span>
              </label>
            )}
            <div className="flex gap-2">
              <Button variant="outline" size="lg" className="flex-1" onClick={onCancel}>
                {t('moneyFlowConfirm.cancel')}
              </Button>
              <Button size="lg" className="flex-1" onClick={confirm} disabled={requireAck && !ack}>
                {tip ? t('moneyFlowConfirm.confirmTip') : t('moneyFlowConfirm.confirmClaim')}
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
