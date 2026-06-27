import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge conditional class names + dedupe Tailwind conflicts. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Middle-truncate a Stellar address: GABC…WXYZ */
export function shortAddress(addr: string, lead = 4, tail = 4): string {
  if (!addr || addr.length <= lead + tail + 1) return addr;
  return `${addr.slice(0, lead)}…${addr.slice(-tail)}`;
}

/** Extract a Soroban contract error code from a thrown error/message, if present. */
export function contractErrorCode(e: unknown): number | null {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  const m = msg.match(/Error\(Contract,\s*#?(\d+)\)/);
  return m ? Number(m[1]) : null;
}

/**
 * Turn a raw chain/network error into one calm human sentence (brand voice). Pass a
 * `codeMap` of contract error codes → messages for the contract being called; falls back
 * to the first line of the message (never the scary diagnostic-event dump).
 */
export function humanizeError(e: unknown, codeMap: Record<number, string> = {}): string {
  const raw = e instanceof Error ? e.message : String(e ?? 'Something went wrong');
  // Host-level signals first — they're clearer than a contract code AND dodge code
  // collisions (e.g. a token SAC's own #10 "insufficient balance" vs a contract's #10).
  const lower = raw.toLowerCase();
  if (
    lower.includes('not sufficient') ||
    lower.includes('insufficient') ||
    lower.includes('zero balance')
  ) {
    return "You don't have enough USDC to cover that — claim a reward or get test USDC first.";
  }
  if (lower.includes('trustline')) {
    return "The recipient hasn't enabled this USDC, so they can't receive the tip yet. Try another passkey wallet, or someone who's enabled USDC.";
  }
  const code = contractErrorCode(e);
  if (code != null && codeMap[code]) return codeMap[code];
  // Drop Soroban's "Event log (newest first): …" diagnostic tail and take the first line.
  const firstLine = raw.split(/Event log|\n/)[0].trim();
  // Unknown contract code → always give the user a next step, never a dead end.
  if (code != null) return `That didn't go through (chain error ${code}). Try again in a moment.`;
  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine || 'Something went wrong';
}

/**
 * Race a promise against a timeout so a hung RPC/Horizon read can't leave the UI stuck
 * in a loading state at an action point (claim, tip, reward). Rejects with a recoverable
 * message on timeout; the caller surfaces a visible retry.
 */
export function withTimeout<T>(p: Promise<T>, ms = 15_000, label = 'request'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`The ${label} timed out — the network is slow. Try again.`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
