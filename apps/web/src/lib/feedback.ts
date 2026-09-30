/**
 * The feedback form (#287): `NEXT_PUBLIC_FEEDBACK_FORM_URL`, linked from the footer and from
 * the in-context `FeedbackPrompt`. Unset (or not an http(s) URL) → no link anywhere.
 *
 * Prefill: a Google Form fills a field from its `entry.<id>` query parameter. Set the env var
 * to the form's "Get pre-filled link" with `{handle}` and `{address}` typed as the answers,
 * and each placeholder is swapped for the visitor's value (a missing value drops the
 * parameter). A plain form URL still works; it just opens empty.
 */

/** The configured form URL, or null when it's unset or not http(s). */
export function feedbackFormUrl(): string | null {
  // A literal member expression: Next inlines only those into the client bundle.
  const raw = process.env.NEXT_PUBLIC_FEEDBACK_FORM_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export interface FeedbackPrefill {
  /** Without the leading `@`; the form gets `@handle`. */
  handle?: string | null;
  address?: string | null;
}

const PLACEHOLDER = /\{(handle|address)\}/g;

/** The form link with `{handle}` / `{address}` filled in; null when no form is configured. */
export function feedbackFormLink(prefill: FeedbackPrefill = {}): string | null {
  const base = feedbackFormUrl();
  if (!base) return null;
  const values = {
    handle: prefill.handle ? `@${prefill.handle.replace(/^@/, '')}` : '',
    address: prefill.address ?? '',
  };
  const url = new URL(base);
  const params = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    const filled = value.replace(PLACEHOLDER, (_, field: 'handle' | 'address') => values[field]);
    // A placeholder with nothing to fill it drops the parameter instead of sending it blank.
    if (filled || filled === value) params.append(key, filled);
  }
  url.search = params.toString();
  return url.toString();
}
