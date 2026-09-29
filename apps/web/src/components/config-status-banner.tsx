'use client';

import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { useTranslations } from '@/lib/i18n';

/**
 * Misconfiguration banner. Asks /api/health once on mount and, when it reports config
 * problems (a half-applied mainnet cutover: a mainnet passphrase with a testnet RPC, a
 * missing mainnet contract id, …), pins an unmissable alert listing each reason. Renders
 * nothing when the config is consistent, and stays quiet when the probe itself fails, so a
 * network blip never takes the app over.
 *
 * The health route validates the same resolved config the client uses (lib/stellar), and
 * the client refuses to hand out a wallet on it (`assertNetworkConfig`) — this banner is
 * what tells the user why.
 */
export function ConfigStatusBanner() {
  const t = useTranslations();
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/health', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data: { configErrors?: unknown }) => {
        if (cancelled) return;
        setErrors(
          Array.isArray(data?.configErrors)
            ? data.configErrors.filter((e): e is string => typeof e === 'string')
            : [],
        );
      })
      .catch(() => {
        // Probe unreachable — don't block the app on a transient failure. The health
        // endpoint still returns 503 for uptime monitors/ops.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (errors.length === 0) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="config-status-banner"
      className="fixed inset-x-0 top-0 z-[200] border-b border-destructive/60 bg-destructive px-4 py-3 text-destructive-foreground shadow-lg"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-1">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          {t('configBanner.title')}
        </p>
        <ul className="list-disc pl-5 text-xs">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
