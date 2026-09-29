import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge conditional class names + dedupe Tailwind conflicts. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Extract a Soroban contract error code from a thrown error/message, if present. */
export function contractErrorCode(e: unknown): number | null {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  const m = msg.match(/Error\(Contract,\s*#?(\d+)\)/);
  return m ? Number(m[1]) : null;
}

/** The flows that move USDC through the token SAC, where its balance / trustline errors mean something. */
export type ErrorFlow = 'tip' | 'reward';

/**
 * Turn a raw chain/network error into one calm human sentence (brand voice). Pass a
 * `codeMap` of contract error codes → messages for the contract being called; falls back
 * to the first line of the message (never the scary diagnostic-event dump). `flow` opts a
 * USDC-moving caller into the SAC balance / trustline copy; every other flow never sees it.
 */
export function humanizeError(
  e: unknown,
  codeMap: Record<number, string> = {},
  flow?: ErrorFlow,
): string {
  const raw = e instanceof Error ? e.message : String(e ?? 'Something went wrong');
  // Host-level signals first — they're clearer than a contract code AND dodge code
  // collisions (e.g. a token SAC's own #10 "insufficient balance" vs a contract's #10).
  const lower = raw.toLowerCase();

  // A classic tx rejected for its XLM fee names its result code (lib/contracts.ts).
  if (lower.includes('txinsufficientbalance') || lower.includes('txinsufficientfee')) {
    return 'You need a little more XLM to cover the network fee.';
  }

  if (flow) {
    // The token SAC's balance errors ("balance is not sufficient to spend", "zero balance…").
    if (
      lower.includes('balanceerror') ||
      lower.includes('insufficient balance') ||
      lower.includes('not sufficient') ||
      lower.includes('zero balance')
    ) {
      return "You don't have enough USDC to cover that — claim a reward or get test USDC first.";
    }
    if (lower.includes('trustline')) {
      return flow === 'tip'
        ? "The recipient hasn't enabled this USDC, so they can't receive the tip yet. Try another passkey wallet, or someone who's enabled USDC."
        : "You haven't enabled USDC yet, so you can't receive the reward. Enable it in your wallet first.";
    }
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

/**
 * Share one in-flight read per `key`: widgets that mount together (stat strip, badge row,
 * activity feed) and ask for the same RPC read get the same promise instead of each firing
 * their own round-trip. The entry is dropped once it settles, so a later call (a poll, a
 * refresh after a write) always reads fresh — this is request coalescing, not a cache.
 */
export function shareInFlight<T>(
  pending: Map<string, Promise<T>>,
  key: string,
  run: () => Promise<T>,
): Promise<T> {
  const hit = pending.get(key);
  if (hit) return hit;
  const p = run().finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}
