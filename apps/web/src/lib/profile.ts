/**
 * Local profile persistence (Sprint 1). Handle + address + art seed survive reloads.
 * On-chain handle binding happens via the Genesis tx (recordGenesis); this is the
 * client-side cache so returning users skip onboarding.
 */
import type { AvatarConfig } from './avatar';

export interface Profile {
  handle: string;
  address: string;
  createdAt: number;
  genesisTx?: string;
  /** Chosen profile face. Absent → a deterministic default is derived from address. */
  avatar?: AvatarConfig;
  /** Short plain-text bio (see `sanitizeBio`), mirrored from the registry's `set_meta`. */
  bio?: string;
}

const KEY = 'alvinmunk.profile';

export function loadProfile(): Profile | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Profile;
  } catch {
    return null;
  }
}

export function saveProfile(p: Profile): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(KEY, JSON.stringify(p));
}

export function clearProfile(): void {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY);
}

/** Normalize a user-typed handle: lowercase, alnum + underscore, <= 20 chars. */
export function normalizeHandle(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 20);
}

/** The registry's bio cap. It counts UTF-8 BYTES, so `ş` costs 2 and most emoji 4. */
export const BIO_MAX_BYTES = 80;

const utf8 = new TextEncoder();

/** UTF-8 length of `s` — what the registry's `String::len` checks against. */
export function bioBytes(s: string): number {
  return utf8.encode(s).length;
}

// What the registry rejects in a bio (`BadBio`): control characters (C0, DEL, C1), the
// line/paragraph separators, and bidi embedding/override/isolate marks — plus lone
// surrogates, which can't be encoded as UTF-8 at all.
const BANNED = /[\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069]|\p{Cs}/gu;

/**
 * Make `input` a bio the registry accepts, the way it is shown everywhere: one line of
 * plain text, whitespace collapsed, cut to `BIO_MAX_BYTES` bytes on a character boundary.
 * Pass `{ trim: false }` while the user is still typing so a trailing space survives.
 */
export function sanitizeBio(input: string, { trim = true }: { trim?: boolean } = {}): string {
  let s = String(input ?? '')
    .replace(/\s/g, ' ')
    .replace(BANNED, '')
    .replace(/ {2,}/g, ' ');
  if (trim) s = s.trim();
  let out = '';
  let bytes = 0;
  for (const ch of s) {
    bytes += bioBytes(ch);
    if (bytes > BIO_MAX_BYTES) break;
    out += ch;
  }
  return trim ? out.trimEnd() : out;
}
