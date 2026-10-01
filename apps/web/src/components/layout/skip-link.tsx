'use client';

import { useTranslations } from '@/lib/i18n';

export function SkipLink() {
  const t = useTranslations();
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[201] focus:rounded-xl focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-lg focus:border focus:border-border"
    >
      {t('nav.skipToContent')}
    </a>
  );
}
