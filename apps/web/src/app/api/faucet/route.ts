/**
 * Test-USDC faucet (TESTNET ONLY). The USDC issuer pays a small amount of test USDC
 * to a wallet that has already established the trustline (`enableUsdc`). This is the
 * second server-side key user after the attester; the issuer secret never reaches
 * the client (belts/08 security). Hard-disabled on mainnet — we never mint real USDC.
 *
 * Gated by a per-IP rate limit + a best-effort once-per-recipient guard + a fixed
 * small drip. Existence of a trustline is required (we can't create it for the user).
 */
import {
  Address,
  Asset,
  Contract,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from '@stellar/stellar-sdk';

export const runtime = 'nodejs';

const HORIZON = process.env.NEXT_PUBLIC_HORIZON_URL ?? 'https://horizon-testnet.stellar.org';
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? 'https://soroban-testnet.stellar.org';
const IS_MAINNET = process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet';
const PASSPHRASE = IS_MAINNET ? Networks.PUBLIC : Networks.TESTNET;
const DRIP = '5'; // test USDC per request
const RATE_MAX = 3;
const RATE_WINDOW_MS = 60_000;

const hits = new Map<string, { n: number; resetAt: number }>();
const funded = new Set<string>(); // best-effort once-per-recipient (resets on cold start)

function rateLimited(ip: string, now: number): boolean {
  const h = hits.get(ip);
  if (!h || now > h.resetAt) {
    hits.set(ip, { n: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  h.n += 1;
  return h.n > RATE_MAX;
}

export async function POST(req: Request): Promise<Response> {
  if (IS_MAINNET) return json({ error: 'faucet is disabled on mainnet' }, 403);

  const secret = process.env.USDC_ISSUER_SECRET_KEY;
  if (!secret) return json({ error: 'faucet not configured (USDC_ISSUER_SECRET_KEY)' }, 500);

  const now = Date.now();
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (rateLimited(ip, now)) return json({ error: 'rate limited, slow down' }, 429);

  let body: { recipient?: string };
  try {
    body = (await req.json()) as { recipient?: string };
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  const recipient = body.recipient ?? '';
  // Accept a classic (G…) account OR a passkey smart-wallet (C…) contract.
  if (!/^[GC][A-Z2-7]{55}$/.test(recipient)) {
    return json({ error: 'recipient (G… or C… address) required' }, 400);
  }
  if (funded.has(recipient)) return json({ error: 'already funded this session' }, 429);

  const issuer = Keypair.fromSecret(secret);

  // Smart wallets (C…) hold the SAC directly and have no classic trustline, and can't receive
  // a classic payment — so the issuer (the SAC admin) mints test USDC straight to the contract
  // via a Soroban call instead.
  if (recipient.startsWith('C')) {
    const sacId = process.env.NEXT_PUBLIC_USDC_SAC_ID;
    if (!sacId) return json({ error: 'faucet not configured (USDC SAC id)' }, 500);
    try {
      const srpc = new rpc.Server(RPC_URL, { allowHttp: RPC_URL.startsWith('http://') });
      const src = await srpc.getAccount(issuer.publicKey());
      const stroops = BigInt(DRIP) * 10_000_000n; // USDC has 7 decimals
      const built = new TransactionBuilder(src, { fee: '1000000', networkPassphrase: PASSPHRASE })
        .addOperation(
          new Contract(sacId).call(
            'mint',
            new Address(recipient).toScVal(),
            nativeToScVal(stroops, { type: 'i128' }),
          ),
        )
        .setTimeout(60)
        .build();
      const prepared = await srpc.prepareTransaction(built);
      prepared.sign(issuer); // source = issuer = SAC admin → satisfies mint's admin auth
      const sent = await srpc.sendTransaction(prepared);
      if (sent.status === 'ERROR') throw new Error(JSON.stringify(sent.errorResult));
      for (let i = 0; i < 30; i++) {
        const r = await srpc.getTransaction(sent.hash);
        if (r.status === 'SUCCESS') break;
        if (r.status === 'FAILED') throw new Error('mint failed on-chain');
        await new Promise((res) => setTimeout(res, 1000));
      }
      funded.add(recipient);
      logEvent({ route: 'faucet', outcome: 'ok', amount: DRIP, kind: 'sac-mint', ms: Date.now() - now });
      return json({ ok: true, hash: sent.hash, amount: DRIP });
    } catch (e) {
      logEvent({ route: 'faucet', outcome: 'error', kind: 'sac-mint', ms: Date.now() - now });
      return json({ error: e instanceof Error ? e.message : 'faucet mint failed' }, 502);
    }
  }

  const asset = new Asset('USDC', issuer.publicKey());
  const server = new Horizon.Server(HORIZON);

  // The recipient must already trust USDC — the issuer can't create the line for them.
  let recipientAccount;
  try {
    recipientAccount = await server.loadAccount(recipient);
  } catch {
    return json({ error: 'recipient account not found on testnet' }, 404);
  }
  const trusts = recipientAccount.balances.some(
    (b) => 'asset_code' in b && b.asset_code === 'USDC' && b.asset_issuer === issuer.publicKey(),
  );
  if (!trusts) return json({ error: 'enable the USDC trustline first' }, 409);

  try {
    const source = await server.loadAccount(issuer.publicKey());
    const tx = new TransactionBuilder(source, { fee: '1000', networkPassphrase: PASSPHRASE })
      .addOperation(Operation.payment({ destination: recipient, asset, amount: DRIP }))
      .setTimeout(60)
      .build();
    tx.sign(issuer);
    const res = await server.submitTransaction(tx);
    funded.add(recipient);
    logEvent({ route: 'faucet', outcome: 'ok', amount: DRIP, ms: Date.now() - now });
    return json({ ok: true, hash: res.hash, amount: DRIP });
  } catch (e) {
    logEvent({ route: 'faucet', outcome: 'error', ms: Date.now() - now });
    return json({ error: e instanceof Error ? e.message : 'faucet payment failed' }, 502);
  }
}

/** Structured one-line log for observability (captured by the platform log drain). */
function logEvent(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ t: new Date().toISOString(), ...fields }));
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
