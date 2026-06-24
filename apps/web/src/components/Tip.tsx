'use client';

import { useCallback, useEffect, useState } from 'react';
import { getWallet } from '@/lib/wallet';
import { txExplorerUrl } from '@/lib/stellar';
import {
  enableUsdc,
  getUsdcBalance,
  hasUsdcTrustline,
  requestTestUsdc,
  stroopsToUsdc,
  tip,
  usdcToStroops,
} from '@/lib/rewards';
import { Frame } from '@/components/fx/frame';
import { NumberTicker } from '@/components/fx/number-ticker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

/**
 * USDC tip rail (Green belt). A tip is a real wallet -> wallet USDC transfer. USDC is a
 * classic asset wrapped as a SAC, so a wallet needs a trustline to receive; test USDC
 * comes from the faucet. The cashable, spendable side — distinct from non-cashable Social XP.
 */
export function Tip({ address }: { address: string }) {
  const [balance, setBalance] = useState<bigint | null>(null);
  const [trusts, setTrusts] = useState<boolean | null>(null);
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('1');
  const [busy, setBusy] = useState<null | 'enable' | 'faucet' | 'tip'>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void getUsdcBalance(address, address).then(setBalance).catch(() => setBalance(0n));
    void hasUsdcTrustline(address).then(setTrusts).catch(() => setTrusts(false));
  }, [address]);

  useEffect(refresh, [refresh]);

  async function run(kind: 'enable' | 'faucet' | 'tip', fn: () => Promise<string | void>) {
    setBusy(kind);
    setError(null);
    setHash(null);
    try {
      const h = await fn();
      if (typeof h === 'string' && h) setHash(h);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'action failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Frame label="spend // tip" index="03">
      <div className="p-5">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-base font-semibold">Send a tip</h2>
          <Badge variant="primary">
            {balance === null ? (
              '…'
            ) : (
              <NumberTicker value={Number(stroopsToUsdc(balance))} decimals={2} suffix=" USDC" />
            )}
          </Badge>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          A spendable, cashable rail — send real testnet USDC wallet&nbsp;→&nbsp;wallet.
        </p>

        {trusts === false ? (
          <Button
            onClick={() => run('enable', () => getWallet().then(enableUsdc))}
            disabled={busy !== null}
            className="w-full"
          >
            {busy === 'enable' ? 'Enabling…' : 'Enable USDC (1 tap)'}
          </Button>
        ) : (
          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              onClick={() => run('faucet', () => requestTestUsdc(address))}
              disabled={busy !== null}
              className="w-full"
            >
              {busy === 'faucet' ? 'Requesting…' : 'Get 5 test USDC'}
            </Button>
            <Input
              value={to}
              onChange={(e) => setTo(e.target.value.trim())}
              placeholder="Recipient G… address"
              className="font-mono text-xs"
            />
            <div className="flex gap-2">
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="1.0"
                className="w-24"
              />
              <Button
                onClick={() =>
                  run('tip', async () => {
                    const wallet = await getWallet();
                    await tip(wallet, to, usdcToStroops(amount));
                  })
                }
                disabled={busy !== null || !/^G[A-Z2-7]{55}$/.test(to)}
                className="flex-1"
              >
                {busy === 'tip' ? 'Sending…' : 'Send tip'}
              </Button>
            </div>
          </div>
        )}

        {hash && (
          <a
            href={txExplorerUrl(hash)}
            target="_blank"
            rel="noreferrer"
            className="mt-2 block text-center text-xs text-secondary underline"
          >
            confirmed on-chain →
          </a>
        )}
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </div>
    </Frame>
  );
}
