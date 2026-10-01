/**
 * The `vouch/claimed` event decoder the attester's vouch_back and invite_converts checks use.
 * It lives outside `app/api/attest/route.ts` because a Next.js route file may export only its
 * HTTP handlers and route config — any other export fails `next build`.
 */

/**
 * A decoded `vouch/claimed` event value: (vouch_id, from, claimer).
 * Mirrors contracts/reputation/src/lib.rs claim_vouch emit at line ~293.
 */
export interface VouchClaimedEvent {
  vouchId: string; // stringified u64
  from: string;    // G/C address — the voucher
  claimer: string; // G/C address — the person who claimed
}

/**
 * Decode one raw `vouch/claimed` event value (a 3-tuple ScVal) into a typed record.
 * Returns null for any event that cannot be decoded — callers skip those silently.
 */
export function decodeVouchClaimedEvent(
  raw: unknown, // scValToNative output for one event's value
): VouchClaimedEvent | null {
  if (!Array.isArray(raw) || raw.length !== 3) return null;
  const [id, from, claimer] = raw;
  if (
    (typeof id !== 'number' && typeof id !== 'bigint') ||
    typeof from !== 'string' ||
    typeof claimer !== 'string'
  ) {
    return null;
  }
  return { vouchId: String(id), from, claimer };
}
