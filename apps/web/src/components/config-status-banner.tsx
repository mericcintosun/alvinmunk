'use client';

import React, { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';

/**
 * Blocking config banner. Probes /api/health once on mount and, when the server reports
 * config problems (e.g. a half-applied mainnet cutover: mainnet passphrase + testnet RPC),
 * renders an unmissable fixed alert listing each specific reason. Renders nothing when the
 * config is healthy, and stays quiet on a transient probe failure so a network blip never
 * blocks the whole app.
 *
 * The server routes and this client share one resolved config, so whatever /api/health
 * reports is exactly what every transaction would use.
 */
export function ConfigStatusBanner() {
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
          This deployment is misconfigured — network actions are unavailable.
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
