/**
 * Passkey relayer submit — the ONLY server-side piece of the passkey path.
 *
 * A passkey smart-wallet (C…) can't be a classic tx source, so its transactions go through
 * the OpenZeppelin Relayer Channels service, which fee-bumps them from a fund account — the
 * user never needs XLM. The Channels API key is a SERVER-ONLY secret; it lives here (never
 * NEXT_PUBLIC) and never reaches the client. Two job shapes (see docs/PASSKEY_HANDOFF.md):
 *
 *   • { func, auth }  — a Soroban CONTRACT CALL. Submitted via `submitSorobanTransaction`:
 *       the relayer sources it on a channel account (unique sequence → no races), sets the
 *       fee to the resource fee, and fee-bumps. The passkey-signed auth entries authorize the
 *       C… smart wallet, independent of the tx source, so channel-sourcing is safe.
 *   • { xdr }         — the one-time smart-wallet DEPLOY (a complete, deployer-signed tx).
 *       It can't be channel-sourced (the contract address + deployer auth are bound to the
 *       deployer source), so it goes via `submitTransaction`. Soroban requires a fee-bumped
 *       inner tx's fee to EQUAL its resource fee, but passkey-kit builds the deploy with an
 *       extra inclusion fee — so we lower the fee to the resource fee and re-sign with the
 *       (public, well-known) deployer key before submitting.
 */
import { ChannelsClient } from '@openzeppelin/relayer-plugin-channels';
import { Transaction, Keypair, hash as sha256, xdr } from '@stellar/stellar-sdk';

export const runtime = 'nodejs';
// Read the relayer secrets at REQUEST time, never at build (they're absent then). Same
// reasoning as /api/health.
export const dynamic = 'force-dynamic';

const PASSPHRASE = process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * passkey-kit deploys every smart wallet from a single shared deployer account whose seed is
 * the literal `hash("kalepail")` (see passkey-kit `kit.ts`) — public, not a secret. We rebuild
 * that keypair to re-sign the deploy tx after lowering its fee.
 */
function deployerKeypair(): Keypair {
  return Keypair.fromRawEd25519Seed(sha256(Buffer.from('kalepail')));
}

/**
 * Lower a deployer-signed Soroban deploy tx's fee to exactly its resource fee (the Channels
 * fund account supplies the inclusion fee via the fee bump) and re-sign with the deployer key.
 */
function refeeDeploy(xdrStr: string): string {
  const env = xdr.TransactionEnvelope.fromXDR(xdrStr, 'base64');
  const v1 = env.v1();
  const tx = v1.tx();
  const resourceFee = tx.ext().sorobanData().resourceFee(); // xdr Int64
  tx.fee(Number(resourceFee.toString())); // fee == resource fee (Soroban fee-bump rule)
  v1.signatures([]); // drop the now-stale deployer signature over the old fee
  const rebuilt = new Transaction(env.toXDR('base64'), PASSPHRASE);
  rebuilt.sign(deployerKeypair());
  return rebuilt.toXDR();
}

export async function POST(req: Request): Promise<Response> {
  const relayerUrl = process.env.PASSKEY_RELAYER_URL;
  const relayerApiKey = process.env.PASSKEY_RELAYER_API_KEY;
  if (!relayerUrl || !relayerApiKey) {
    return json(
      { error: 'Passkey relayer not configured (set PASSKEY_RELAYER_URL + PASSKEY_RELAYER_API_KEY).' },
      503,
    );
  }

  let body: { func?: unknown; auth?: unknown; xdr?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: 'Body must be valid JSON.' }, 400);
  }

  try {
    const client = new ChannelsClient({ baseUrl: relayerUrl, apiKey: relayerApiKey });
    let result: { hash?: string | null };
    if (typeof body.func === 'string' && Array.isArray(body.auth)) {
      // Soroban contract call (the common path) — channel-sourced, relayer handles fees.
      result = await client.submitSorobanTransaction({
        func: body.func,
        auth: body.auth as string[],
      });
    } else if (typeof body.xdr === 'string') {
      // One-time smart-wallet deploy — fee-fix + re-sign, then submit the complete tx.
      result = await client.submitTransaction({ xdr: refeeDeploy(body.xdr) });
    } else {
      return json({ error: 'Body must be { func, auth } or { xdr }.' }, 400);
    }
    if (!result?.hash) throw new Error('relayer returned no tx hash');
    return json({ hash: result.hash }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'relayer submit failed';
    return json({ error: msg }, 502);
  }
}
