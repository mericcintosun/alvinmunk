import { PostHog } from 'posthog-node';

export function getPostHogClient(): PostHog {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

  if (!key && process.env.NODE_ENV !== 'production') {
    console.error(
      'NEXT_PUBLIC_POSTHOG_KEY variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once NEXT_PUBLIC_POSTHOG_KEY is configured',
    );
  }

  return new PostHog(key ?? '', {
    host: host ?? 'https://eu.i.posthog.com',
    // Route handlers are short-lived: flush immediately so events send before the handler returns.
    flushAt: 1,
    flushInterval: 0,
  });
}
