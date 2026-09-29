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
import {
  ChannelsClient,
  PluginExecutionError,
  PluginTransportError,
  PluginUnexpectedError,
} from '@openzeppelin/relayer-plugin-channels';
import { Transaction, Keypair, hash as sha256, xdr } from '@stellar/stellar-sdk';
import { json, withRoute } from '../../../lib/api-route';

export const runtime = 'nodejs';
// Read the relayer secrets at REQUEST time, never at build (they're absent then). Same
// reasoning as /api/health.
export const dynamic = 'force-dynamic';

const PASSPHRASE = process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015';

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

export const POST = withRoute('POST /api/passkey-send', async (req: Request): Promise<Response> => {
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

  // Validate input shape before calling relayer
  if (typeof body.func === 'string' && Array.isArray(body.auth)) {
    // Soroban contract call: validate auth array contains only strings
    if (!body.auth.every((a) => typeof a === 'string')) {
      return json({ error: 'auth must be an array of base64 XDR strings.' }, 400);
    }
    // Validate func is valid base64 XDR (will throw if malformed)
    try {
      xdr.SorobanAuthorizedFunction.fromXDR(body.func, 'base64');
    } catch {
      return json({ error: 'func must be valid base64-encoded SorobanAuthorizedFunction XDR.' }, 400);
    }
    // Validate each auth entry is valid XDR
    for (let i = 0; i < body.auth.length; i++) {
      try {
        xdr.SorobanAuthorizationEntry.fromXDR(body.auth[i], 'base64');
      } catch {
        return json({ error: `auth[${i}] must be valid base64-encoded SorobanAuthorizationEntry XDR.` }, 400);
      }
    }
  } else if (typeof body.xdr === 'string') {
    // Deploy transaction: validate and decode XDR before calling relayer
    try {
      const env = xdr.TransactionEnvelope.fromXDR(body.xdr, 'base64');
      // A fee-bump (or v0) envelope has no v1 arm: reading it would throw a generic error.
      if (env.switch() !== xdr.EnvelopeType.envelopeTypeTx()) {
        return json({ error: 'xdr must be a v1 transaction envelope.' }, 400);
      }
      const tx = env.v1().tx();
      const sorobanData = tx.ext().sorobanData();
      if (!sorobanData) {
        return json({ error: 'xdr must be a Soroban transaction with sorobanData.' }, 400);
      }
    } catch {
      return json({ error: 'xdr must be valid base64-encoded TransactionEnvelope XDR.' }, 400);
    }
  } else {
    return json({ error: 'Body must be { func, auth } or { xdr }.' }, 400);
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
    } else {
      // One-time smart-wallet deploy — fee-fix + re-sign, then submit the complete tx.
      result = await client.submitTransaction({ xdr: refeeDeploy(body.xdr as string) });
    }
    if (!result?.hash) throw new Error('relayer returned no tx hash');
    return json({ hash: result.hash }, 200);
  } catch (e) {
    // Never log `e.errorDetails` here: for a transport error it is the axios error, whose
    // request config carries the relayer API key. withRoute already logs the status.
    if (e instanceof PluginExecutionError) {
      // The relayer answered and refused: simulation failure, bad auth, fee limit, …
      return json({ error: e.message || 'Relayer rejected the transaction.', code: 'RELAYER_EXECUTION_ERROR' }, 422);
    }
    if (e instanceof PluginTransportError) {
      // No usable answer. A timeout (axios ECONNABORTED/ETIMEDOUT, or 408/504) is a 504;
      // a dropped connection or an upstream HTTP error with no body is a 502.
      const code = (e.errorDetails as { code?: string } | undefined)?.code;
      const timedOut =
        code === 'ECONNABORTED' || code === 'ETIMEDOUT' || e.statusCode === 408 || e.statusCode === 504;
      const upstream = e.statusCode ? ` (upstream ${e.statusCode})` : '';
      return json(
        { error: timedOut ? `Relayer timed out${upstream}.` : `Relayer unreachable${upstream}.`, code: 'RELAYER_TRANSPORT_ERROR' },
        timedOut ? 504 : 502,
      );
    }
    if (e instanceof PluginUnexpectedError) {
      return json({ error: 'Relayer returned a malformed response.', code: 'RELAYER_UNEXPECTED_ERROR' }, 502);
    }
    // Anything else: refeeDeploy on a malformed deploy, or a missing hash.
    const msg = e instanceof Error ? e.message : 'relayer submit failed';
    return json({ error: msg, code: 'UNKNOWN_ERROR' }, 502);
  }
});
