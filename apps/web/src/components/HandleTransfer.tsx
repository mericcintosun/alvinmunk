'use client';

import React, { useEffect, useState } from 'react';
import { storedDevWallet, type Wallet } from '@/lib/wallet';
import { reverseHandle, transferHandle, TRANSFER_ERRORS } from '@/lib/registry';
import { txExplorerUrl } from '@/lib/stellar';
import { useTranslations, type TFn } from '@/lib/i18n';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { shortAddr } from '@alvinmunk/shared';
import { humanizeError } from '@/lib/utils';

// Registry codes `transfer_handle` can revert with → i18n messages.
function transferErrors(t: TFn): Record<number, string> {
  return {
    [TRANSFER_ERRORS.NoHandle]: t('handleTransfer.error.noHandle'),
    [TRANSFER_ERRORS.AlreadyHasHandle]: t('handleTransfer.error.targetHasHandle'),
  };
}

interface Holdings {
  from: Wallet;
  handle: string;
  /** The handle `wallet` already holds, if any — a wallet holds one, so it blocks the move. */
  held: string | null;
}

/**
 * Wallet-settings entry point for `transfer_handle`: when this browser's in-app (dev) wallet
 * holds an @handle, offer to move it to the connected `wallet` in one transaction. The dev
 * key co-signs here and `wallet` signs as usual. Renders nothing when there is no in-app
 * wallet, it holds no handle, or it IS the connected wallet.
 */
export function HandleTransfer({ wallet }: { wallet: Wallet }) {
  const t = useTranslations();
  const [holdings, setHoldings] = useState<Holdings | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ handle: string; hash: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const from = storedDevWallet();
    setHoldings(null);
    setDone(null);
    setError(null);
    if (!from || from.address === wallet.address) return;
    let alive = true;
    void Promise.all([reverseHandle(from.address), reverseHandle(wallet.address)]).then(
      ([handle, held]) => {
        if (alive && handle) setHoldings({ from, handle, held });
      },
    );
    return () => {
      alive = false;
    };
  }, [wallet.address]);

  if (!holdings && !done) return null;

  async function move() {
    if (!holdings) return;
    setBusy(true);
    setError(null);
    try {
      const hash = await transferHandle(holdings.from, wallet);
      setDone({ handle: holdings.handle, hash });
      setHoldings(null);
    } catch (e) {
      setError(humanizeError(e, transferErrors(t)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <h2 className="text-sm font-semibold">{t('handleTransfer.title')}</h2>
        {holdings && (
          <>
            <p className="text-xs text-muted-foreground">
              {t('handleTransfer.body', {
                handle: holdings.handle,
                from: shortAddr(holdings.from.address),
              })}
            </p>
            <p className="text-xs text-muted-foreground">{t('handleTransfer.xpNote')}</p>
            {holdings.held ? (
              <p className="text-xs text-destructive">
                {t('handleTransfer.targetHasHandle', { handle: holdings.held })}
              </p>
            ) : (
              <Button onClick={move} disabled={busy}>
                {busy
                  ? t('handleTransfer.submitting')
                  : t('handleTransfer.submit', { handle: holdings.handle })}
              </Button>
            )}
          </>
        )}
        {done && (
          <div className="rounded-xl bg-success/10 p-3 text-xs text-success ring-1 ring-success/30">
            <p className="font-semibold">{t('handleTransfer.done', { handle: done.handle })}</p>
            <a
              href={txExplorerUrl(done.hash)}
              target="_blank"
              rel="noreferrer"
              className="break-all underline"
            >
              {done.hash}
            </a>
          </div>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
