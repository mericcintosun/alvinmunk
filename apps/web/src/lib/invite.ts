/**
 * Invite binding — turns the `/v/<handle>` recruiting link into an on-chain
 * "who invited whom" edge (registry `set_inviter`). The inviter handle is stashed in
 * sessionStorage by the invite page (`alvinmunk.ref`); after a successful `claimHandle`
 * we resolve it to the inviter's registered address and bind it, one-shot, for ANY wallet
 * kind — the passkey smart wallet (C…) calls the registry through its `invoke` path exactly
 * like a classic G… wallet does.
 *
 * One inviter per invitee, forever. Re-onboarding with an old link is a harmless no-op:
 * `invited_by` is read first, and an already-bound wallet skips the `set_inviter`
 * transaction entirely — no signature prompt, no revert.
 *
 * The stashed ref is intentionally NOT cleared here: `InviteNudge` reads it to show the
 * vouch-back prompt and clears it only when the user dismisses it. The nudge hides itself
 * once the on-chain binding exists, so the ref is cleared by user action, not by binding.
 */
import { resolveHandle, setInviter, getInvitedBy } from './registry';
import type { Wallet } from './wallet';

/**
 * If the visitor arrived via an invite link and just claimed their handle, bind the
 * inviter on-chain. Best-effort: a missing/unresolvable ref, an unregistered inviter, a
 * broken RPC, or an already-bound wallet all log and move on — onboarding must never fail
 * because of it. Does NOT clear the ref (InviteNudge does that on dismiss). Returns true
 * when a new binding was written.
 */
export async function bindInviter(wallet: Wallet): Promise<boolean> {
  const { loadInviteRef } = await import('./invite-ref');
  const handle = loadInviteRef();
  if (!handle) return false;
  try {
    // Skip the transaction entirely if already bound — avoids a pointless signature prompt
    // that can only revert with AlreadyInvited (#12).
    const existing = await getInvitedBy(wallet.address);
    if (existing) return false;

    const inviterAddress = await resolveHandle(handle);
    if (!inviterAddress || inviterAddress === wallet.address) return false;

    await setInviter(wallet, inviterAddress);
    return true;
  } catch (e) {
    console.warn('🔗 invite binding skipped →', e);
    return false;
  }
}
