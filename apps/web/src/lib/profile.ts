/**
 * Local profile persistence (Sprint 1). Handle + address + art seed survive reloads.
 * On-chain handle binding happens via the Genesis tx (recordGenesis); this is the
 * client-side cache so returning users skip onboarding.
 */
import type { AvatarConfig } from './avatar';
import { readJSON, writeJSON, remove } from './storage';

export interface Profile {
  handle: string;
  address: string;
  createdAt: number;
  genesisTx?: string;
  /** Chosen profile face. Absent → a deterministic default is derived from address. */
  avatar?: AvatarConfig;
  /** Short plain-text bio (see `sanitizeBio`), mirrored from the registry's `set_meta`. */
  bio?: string;
  /** Where the profile was created from, e.g. `claim`. Used for analytics. */
  source?: string;
}

const KEY = 'alvinmunk.profile';

export function loadProfile(): Profile | null {
  return readJSON<Profile | null>(KEY, null);
}

export function saveProfile(p: Profile): void {
  writeJSON(KEY, p);
}

export function clearProfile(): void {
  remove(KEY);
}

/** Handle length bounds: the registry takes 3–20 characters of `a–z`, `0–9` and `_`. */
export const HANDLE_MIN_CHARS = 3;
export const HANDLE_MAX_CHARS = 20;

/** Normalize a user-typed handle: lowercase, alnum + underscore, <= 20 chars. */
export function normalizeHandle(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, HANDLE_MAX_CHARS);
}

/** The characters `normalizeHandle` drops from `input` (after lowercasing), each once and in
 *  typing order, so a form can say why "Ayşe K" became "@ayek". */
export function removedHandleChars(input: string): string[] {
  const removed: string[] = [];
  for (const ch of input.toLowerCase()) {
    if (!/[a-z0-9_]/.test(ch) && !removed.includes(ch)) removed.push(ch);
  }
  return removed;
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
