'use client';

import React, { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Client-only QR renderer.
 *
 * Encodes `value` into an inline SVG. The encoder is pulled in with a dynamic
 * `import()` so it stays out of the landing bundle and is fetched only when a QR
 * is actually shown. That matters for the vouch claim QR, which encodes a bearer
 * secret: it must never be part of server HTML or an OG image, so this component
 * renders nothing scannable until it runs in the browser.
 */
export function QrCode({
  value,
  size = 176,
  label,
  className,
}: {
  value: string;
  size?: number;
  label: string;
  className?: string;
}) {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setSvg(null);

    import('qrcode')
      .then(({ default: QRCode }) =>
        QRCode.toString(value, {
          type: 'svg',
          errorCorrectionLevel: 'M',
          margin: 1,
          width: size,
          // High contrast on its own light surface for reliable scanning,
          // independent of the active theme.
          color: { dark: '#0b0b0cff', light: '#ffffffff' },
        }),
      )
      .then((markup) => {
        if (alive) setSvg(markup);
      })
      .catch(() => {
        if (alive) setSvg(null);
      });

    return () => {
      alive = false;
    };
  }, [value, size]);

  return (
    <div
      role="img"
      aria-label={label}
      style={{ width: size, height: size }}
      className={cn(
        'inline-flex items-center justify-center rounded-xl bg-white p-2',
        className,
      )}
    >
      {svg ? (
        <span
          className="block h-full w-full [&>svg]:h-full [&>svg]:w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <span aria-hidden className="text-xs text-black/40">
          …
        </span>
      )}
    </div>
  );
}
