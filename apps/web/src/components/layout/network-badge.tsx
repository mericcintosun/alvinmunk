'use client';

import Link from 'next/link';
import { useTranslations } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export type StellarNetwork = 'mainnet' | 'testnet';

/**
 * Resolve the active Stellar network from the public env.
 *
 * Reads `NEXT_PUBLIC_STELLAR_NETWORK` **directly** — not through `lib/stellar.ts`
 * — so the Stellar SDK never gets pulled into the marketing bundle for the sake
 * of a label. Normalisation mirrors `config/csp.mjs` / `readNetworkConfig`:
 * default to testnet, and treat the value as mainnet only when it is exactly
 * `"mainnet"` (trimmed, case-insensitive).
 */
export function resolveNetwork(
  raw: string | undefined = process.env.NEXT_PUBLIC_STELLAR_NETWORK,
): StellarNetwork {
  return raw !== undefined && raw.trim().toLowerCase() === 'mainnet' ? 'mainnet' : 'testnet';
}

/**
 * A pill that states which Stellar network the app is pointed at, linking to
 * `/api/health` for live status. Testnet and mainnet differ in **text** (not
 * colour alone) so they are never confused: a warning-gold "Testnet · test funds" vs a
 * distinct secondary-green "Mainnet". Rendered in both the navbar and the footer.
 * Token colours only: text-* reads the AA text variants, so both themes stay legible.
 */
export function NetworkBadge({ className }: { className?: string }) {
  const t = useTranslations();
  const isMainnet = resolveNetwork() === 'mainnet';
  const label = t(isMainnet ? 'network.badge.mainnet' : 'network.badge.testnet');

  return (
    <Link
      href="/api/health"
      aria-label={t('network.badge.aria', { network: isMainnet ? 'Mainnet' : 'Testnet' })}
      title={t('network.badge.title')}
      className={cn(
        'inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
        isMainnet
          ? 'border-secondary/40 bg-secondary/10 text-secondary hover:bg-secondary/20'
          : 'border-warning/40 bg-warning/10 text-warning hover:bg-warning/20',
        className,
      )}
      data-network={isMainnet ? 'mainnet' : 'testnet'}
    >
      <span
        aria-hidden
        className={cn('size-1.5 rounded-full', isMainnet ? 'bg-secondary' : 'bg-warning')}
      />
      {label}
    </Link>
  );
}
