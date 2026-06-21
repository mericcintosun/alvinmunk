/**
 * Serverless ATTESTER (no standing backend — 00-strategy backend decision).
 *
 * Holds the allowlisted attester secret (server-only env ATTESTER_SECRET_KEY) and
 * signs a claim after verifying a real action off-chain. The on-chain QuestRegistry
 * trusts this attester (added via add_attester). This runs as a Next.js route =
 * one Vercel deploy, no separate host.
 *
 * Quest verification examples (Orange belt):
 *   - GitHub PR merged  -> check via GitHub API (GITHUB_TOKEN)
 *   - referral wallet did a real tx -> check via RPC
 * Only CRYPTOGRAPHICALLY / API-verifiable quests get signed (00-strategy §1).
 */
import { Keypair } from '@stellar/stellar-sdk';

export const runtime = 'nodejs'; // needs the secret; never expose to the client bundle

interface AttestRequest {
  questId: number;
  recipient: string; // G... / C... address
  evidence?: { type: 'github_pr' | 'referral_tx'; ref: string };
}

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.ATTESTER_SECRET_KEY;
  if (!secret) {
    return json({ error: 'attester not configured' }, 500);
  }

  let body: AttestRequest;
  try {
    body = (await req.json()) as AttestRequest;
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  if (typeof body.questId !== 'number' || !body.recipient) {
    return json({ error: 'questId and recipient required' }, 400);
  }

  // 1. Verify the real-world action. STUB — implement per quest type at Orange belt.
  const verified = await verifyEvidence(body);
  if (!verified) {
    return json({ error: 'evidence not verified' }, 422);
  }

  // 2. Sign the claim. The QuestRegistry award_quest is gated on this attester's
  //    on-chain auth; here we return the attester pubkey so the client builds the tx
  //    with the attester as a co-signer (or the attester submits directly).
  const kp = Keypair.fromSecret(secret);

  // NOTE: In the current contract, award_quest is called BY the attester
  // (attester.require_auth()). Simplest path: have this route build+sign+submit the
  // award_quest tx itself. Returning the pubkey here keeps the skeleton transport-agnostic.
  return json({
    ok: true,
    attester: kp.publicKey(),
    questId: body.questId,
    recipient: body.recipient,
  });
}

async function verifyEvidence(body: AttestRequest): Promise<boolean> {
  if (!body.evidence) return false;
  switch (body.evidence.type) {
    case 'github_pr':
      // TODO(Orange): GET https://api.github.com/repos/.../pulls/<n> -> merged === true
      return false;
    case 'referral_tx':
      // TODO(Orange): RPC getTransactions / Horizon -> recipient did a real tx
      return false;
    default:
      return false;
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
