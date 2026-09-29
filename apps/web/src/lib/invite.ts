/**
 * Invite binding — turns the `/v/<handle>` recruiting link into an on-chain
 * "who invited whom" edge (registry `set_inviter`). The inviter handle is stashed in
 * sessionStorage by the invite page (`alvinmunk.ref`); after a successful `claimHandle`
 * we resolve it to the inviter's registered address and bind it, one-shot, for ANY wallet
 * kind — the passkey smart wallet (C…) calls the registry through its `invoke` path exactly
 * like a classic G… wallet does. One inviter per invitee, forever; binding again reverts,
 * so re-onboarding with an old link is a harmless no-op.
 */
import { resolveHandle, setInviter } from './registry';
import type { Wallet } from './wallet';

/** Where the invite page stashes the inviter's handle for the onboarding flow. */
export const REF_STORAGE_KEY = 'alvinmunk.ref';

/** Read the inviter handle a `/v/<handle>` visit stashed, if any (never throws). */
export function readRefHandle(): string | null {
  try {
    return sessionStorage.getItem(REF_STORAGE_KEY);
  } catch {
    return null; // storage unavailable (private mode, SSR)
  }
}

/** Forget the stashed inviter — the binding (or a deliberate skip) closes the loop. */
export function clearRefHandle(): void {
  try {
    sessionStorage.removeItem(REF_STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}

/**
 * If the visitor arrived via an invite link and just claimed their handle, bind the
 * inviter on-chain. Best-effort: a missing/unresolvable ref, an unregistered inviter, or
 * an already-bound wallet logs and moves on — onboarding must never fail because of it.
 * Always clears the stashed ref once handled. True when a binding was written.
 */
export async function bindInviter(wallet: Wallet): Promise<boolean> {
  const handle = readRefHandle();
  clearRefHandle();
  if (!handle) return false;
  try {
    const inviterAddress = await resolveHandle(handle);
    if (!inviterAddress || inviterAddress === wallet.address) return false;
    await setInviter(wallet, inviterAddress);
    return true;
  } catch (e) {
    console.warn('🔗 invite binding skipped →', e);
    return false;
  }
}
