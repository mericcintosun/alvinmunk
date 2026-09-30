'use client';

import { useState } from 'react';
import { type Wallet } from '@/lib/wallet';
import { connectViaKit } from '@/lib/wallet-kit';
import { getXlmBalance, txExplorerUrl } from '@/lib/stellar';
import { sendXlm, type PaymentResult } from '@/lib/payments';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { HandleTransfer } from '@/components/HandleTransfer';
import { useTranslations, type TFn } from '@/lib/i18n';
import { isStellarAddress, shortAddr } from '@alvinmunk/shared';

/**
 * Connect a Stellar wallet, show the balance, and send a testnet XLM payment with
 * pending/success/failure + tx-hash feedback. Also where a user outgrowing the in-app
 * key moves its @handle to the connected wallet. Errors render next to the button that
 * caused them (Connect, or Send), and an invalid field explains the disabled Send once
 * it has been left.
 */
export default function WalletPage() {
  const t = useTranslations();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('1');
  const [result, setResult] = useState<PaymentResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addrTouched, setAddrTouched] = useState(false);
  const [amountTouched, setAmountTouched] = useState(false);

  const validAddr = isStellarAddress(to.trim(), { allowContract: false });
  const validAmount = Number(amount) > 0;
  const showAddrError = addrTouched && !validAddr;
  const showAmountError = amountTouched && !validAmount;
  const sendHints = [showAddrError && 'wallet-to-error', showAmountError && 'wallet-amount-error']
    .filter(Boolean)
    .join(' ');

  async function connect() {
    setError(null);
    setConnecting(true);
    try {
      const w = await connectViaKit();
      setWallet(w);
      setBalance(await getXlmBalance(w.address).catch(() => '0'));
    } catch (e) {
      setError(msg(e, t));
    } finally {
      setConnecting(false);
    }
  }

  async function refresh() {
    if (wallet) setBalance(await getXlmBalance(wallet.address));
  }

  async function pay() {
    if (!wallet) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await sendXlm(wallet, to.trim(), amount);
      setResult(r);
      await refresh();
    } catch (e) {
      setError(msg(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container max-w-md py-12">
      <h1 className="mb-1 text-2xl font-semibold">{t('walletPage.title')}</h1>
      <p className="mb-8 text-sm text-muted-foreground">{t('walletPage.subtitle')}</p>

      {!wallet ? (
        <div className="flex flex-col items-start gap-3">
          <Button size="lg" onClick={connect} disabled={connecting}>
            {connecting ? t('walletPage.connecting') : t('walletPage.connect')}
          </Button>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Card>
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <p className="text-xs text-muted-foreground">{t('walletPage.connected')}</p>
                <p className="font-mono text-sm">{shortAddr(wallet.address)}</p>
                <p className="mt-2 text-sm">
                  {t('walletPage.balance')}{' '}
                  <span className="font-semibold text-primary">
                    {balance ? `${Number(balance).toFixed(2)} XLM` : '…'}
                  </span>
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  // A payment error belongs to this wallet; don't carry it over to Connect.
                  setWallet(null);
                  setError(null);
                  setResult(null);
                }}
              >
                {t('wallet.disconnect')}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col gap-3 p-5">
              <h2 className="text-sm font-semibold">{t('walletPage.sendTitle')}</h2>
              <Input
                value={to}
                onChange={(e) => setTo(e.target.value)}
                onBlur={() => setAddrTouched(true)}
                placeholder={t('walletPage.toPlaceholder')}
                aria-invalid={showAddrError || undefined}
                aria-describedby={showAddrError ? 'wallet-to-error' : undefined}
                className="font-mono text-xs"
              />
              {showAddrError && (
                <p id="wallet-to-error" className="text-xs text-destructive">
                  {t('walletPage.invalidTo')}
                </p>
              )}
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onBlur={() => setAmountTouched(true)}
                inputMode="decimal"
                placeholder={t('walletPage.amountPlaceholder')}
                aria-invalid={showAmountError || undefined}
                aria-describedby={showAmountError ? 'wallet-amount-error' : undefined}
              />
              {showAmountError && (
                <p id="wallet-amount-error" className="text-xs text-destructive">
                  {t('walletPage.invalidAmount')}
                </p>
              )}
              <Button
                onClick={pay}
                disabled={busy || !validAddr || !validAmount}
                aria-describedby={sendHints || undefined}
              >
                {busy ? t('walletPage.sending') : t('walletPage.send')}
              </Button>

              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}

              {result && (
                <div
                  className={
                    result.status === 'SUCCESS'
                      ? 'rounded-xl bg-success/10 p-3 text-xs text-success ring-1 ring-success/30'
                      : result.status === 'FAILED'
                        ? 'rounded-xl bg-destructive/10 p-3 text-xs text-destructive ring-1 ring-destructive/30'
                        : 'rounded-xl bg-muted p-3 text-xs text-muted-foreground'
                  }
                >
                  <p className="font-semibold">
                    {result.status === 'SUCCESS'
                      ? t('walletPage.confirmed')
                      : result.status === 'FAILED'
                        ? t('walletPage.failed')
                        : t('walletPage.pending')}
                  </p>
                  <a
                    href={txExplorerUrl(result.hash)}
                    target="_blank"
                    rel="noreferrer"
                    className="break-all underline"
                  >
                    {result.hash}
                  </a>
                </div>
              )}
            </CardContent>
          </Card>

          <HandleTransfer wallet={wallet} />
        </div>
      )}
    </div>
  );
}

function msg(e: unknown, t: TFn): string {
  return e instanceof Error ? e.message : t('walletPage.error');
}
