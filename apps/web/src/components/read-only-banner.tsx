'use client';

import { Stamp } from '@/components/fx/stamp';
import { useTranslations } from '@/lib/i18n';

/** Says the page reads another network (the ?network= override), and that nothing can be
 *  sent from it. */
export function ReadOnlyBanner({ network }: { network: string }) {
  const t = useTranslations();
  return (
    <div
      role="status"
      className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-tertiary/40 bg-tertiary/10 px-4 py-3"
    >
      <Stamp accent="tertiary">{t('readOnly.stamp', { network: network.toUpperCase() })}</Stamp>
      <p className="text-xs text-muted-foreground">{t('readOnly.body', { network })}</p>
    </div>
  );
}
