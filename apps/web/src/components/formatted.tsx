'use client';

import { useFormat } from '@/lib/i18n';

/**
 * Locale-aware figures and dates for server components, which can't know the reader's
 * locale (it lives in the browser): these leaves format on the client with useFormat.
 */
export function FormattedNumber({ value }: { value: number }) {
  const format = useFormat();
  return <>{format.number(value)}</>;
}

/** The server renders its own time zone, so the client may correct the day on hydration. */
export function FormattedDate({ value }: { value: Date | number }) {
  const format = useFormat();
  return (
    <time dateTime={new Date(value).toISOString()} suppressHydrationWarning>
      {format.date(value)}
    </time>
  );
}
