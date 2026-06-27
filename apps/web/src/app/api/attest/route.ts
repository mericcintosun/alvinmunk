/**
 * Serverless ATTESTER (no standing backend — 00-strategy). Holds the allowlisted attester
 * secret (server-only ATTESTER_SECRET_KEY), VERIFIES a real action, then returns its
 * ed25519 SIGNATURE over the quest_registry's canonical payload. It does NOT submit a tx:
 * the wallet submits `award_quest` itself, proving ownership on-chain via
 * `recipient.require_auth()`. The attester pubkey must be allowlisted via
 * `quest_registry.add_attester_key`.
 *
 * Only cryptographically / API-verifiable quests are accepted (00-strategy §1):
 *   - github_pr   : evidence.ref = "owner/repo#123" -> PR must be merged
 *   - referral_tx : evidence.ref = "G..." address   -> must have ≥1 on-chain tx
 *
 * Defense-in-depth (belts/08 §security): on-chain recipient.require_auth() ownership +
 * on-chain replay guard (the hard cap), per-IP rate limit, bounded body, optional GitHub
 * repo allowlist, self-referral guard. The signature is only redeemable by the recipient
 * (they must satisfy require_auth), so issuing it carries no transfer of funds.
 */
import {
  Account,
  Address,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  rpc,
} from '@stellar/stellar-sdk';
import {
  MAX_BODY_BYTES,
  isValidQuestId,
  parseRepoAllowlist,
  repoAllowed,
  validateEvidence,
  type AttestEvidence,
} from '../../../lib/attest';

export const runtime = 'nodejs';

interface AttestRequest {
  questId: number;
  recipient: string;
  evidence?: AttestEvidence;
}

const RATE_MAX = 6; // requests per window per IP
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, { n: number; resetAt: number }>();

function rateLimited(ip: string, now: number): boolean {
  if (hits.size > 500) {
    for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k);
  }
  const h = hits.get(ip);
  if (!h || now > h.resetAt) {
    hits.set(ip, { n: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  h.n += 1;
  return h.n > RATE_MAX;
}

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? 'https://soroban-testnet.stellar.org';
const HORIZON = process.env.NEXT_PUBLIC_HORIZON_URL ?? 'https://horizon-testnet.stellar.org';
const PASSPHRASE =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
const QUEST_ID = process.env.NEXT_PUBLIC_QUEST_REGISTRY_CONTRACT_ID ?? '';
const REPO_ALLOWLIST = parseRepoAllowlist(process.env.QUEST_GITHUB_REPOS);

// Recipient may be a classic (G…) OR a passkey smart-account (C…) address.
const STELLAR_ADDRESS = /^[GC][A-Z2-7]{55}$/;

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.ATTESTER_SECRET_KEY;
  if (!secret || !QUEST_ID) {
    return json({ error: 'attester not configured (ATTESTER_SECRET_KEY / quest id)' }, 500);
  }

  const len = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(len) && len > MAX_BODY_BYTES) {
    return json({ error: 'request too large' }, 413);
  }

  const now = Date.now();
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (rateLimited(ip, now)) return json({ error: 'rate limited, slow down' }, 429);

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return json({ error: 'invalid body' }, 400);
  }
  if (raw.length > MAX_BODY_BYTES) return json({ error: 'request too large' }, 413);

  let body: AttestRequest;
  try {
    body = JSON.parse(raw) as AttestRequest;
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  if (!isValidQuestId(body.questId) || !STELLAR_ADDRESS.test(body.recipient ?? '')) {
    return json({ error: 'questId (number) and recipient (G/C address) required' }, 400);
  }

  // 1) Evidence shape (cheap, network-free) — format, length, self-referral.
  const shape = validateEvidence(body.evidence, body.recipient);
  if (!shape.ok) return json({ error: shape.reason }, 422);

  // 2) Verify the real-world action (network).
  const verified = await verifyEvidence(body.evidence as AttestEvidence);
  if (!verified.ok) return json({ error: verified.reason }, 422);

  // 3) Sign the contract's canonical payload — the recipient redeems it on-chain.
  try {
    const signed = await signQuestPayload(secret, body.questId, body.recipient);
    logEvent({ route: 'attest', outcome: 'ok', questId: body.questId, ms: Date.now() - now });
    return json({ ok: true, ...signed, recipient: body.recipient, questId: body.questId });
  } catch (e) {
    logEvent({ route: 'attest', outcome: 'error', questId: body.questId, ms: Date.now() - now });
    return json({ error: e instanceof Error ? e.message : 'sign failed' }, 502);
  }
}

function logEvent(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ t: new Date().toISOString(), ...fields }));
}

async function verifyEvidence(ev: AttestEvidence): Promise<{ ok: boolean; reason?: string }> {
  if (ev.type === 'github_pr') {
    const m = ev.ref.match(/^([\w.-]+)\/([\w.-]+)#(\d+)$/);
    if (!m) return { ok: false, reason: 'ref must be owner/repo#number' };
    const [, owner, repo, num] = m;
    if (!repoAllowed(REPO_ALLOWLIST, owner, repo)) {
      return { ok: false, reason: 'repo not eligible for this quest' };
    }
    const headers: Record<string, string> = { accept: 'application/vnd.github+json' };
    if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${num}`, {
      headers,
    });
    if (!r.ok) return { ok: false, reason: `github ${r.status}` };
    const pr = (await r.json()) as { merged?: boolean };
    return pr.merged ? { ok: true } : { ok: false, reason: 'PR not merged' };
  }

  if (ev.type === 'referral_tx') {
    // KNOWN LIMITATION (belts/08, deferred to Blue): proves the referred account is active,
    // NOT that a real referral relationship exists. Intentional at <50 users.
    const r = await fetch(`${HORIZON}/accounts/${ev.ref}/transactions?limit=1`);
    if (!r.ok) return { ok: false, reason: 'referred account not found' };
    const data = (await r.json()) as { _embedded?: { records?: unknown[] } };
    return (data._embedded?.records?.length ?? 0) > 0
      ? { ok: true }
      : { ok: false, reason: 'no on-chain activity' };
  }

  return { ok: false, reason: 'unknown evidence type' };
}

/**
 * Read the contract's canonical payload (so we sign EXACTLY what it verifies — no
 * byte-mismatch risk) and ed25519-sign it with the attester key.
 */
async function signQuestPayload(
  secret: string,
  questId: number,
  recipient: string,
): Promise<{ attester: string; sig: string }> {
  const kp = Keypair.fromSecret(secret);
  const server = new rpc.Server(RPC_URL, { allowHttp: RPC_URL.startsWith('http://') });
  const source = new Account(Keypair.random().publicKey(), '0');
  const tx = new TransactionBuilder(source, { fee: '100', networkPassphrase: PASSPHRASE })
    .addOperation(
      new Contract(QUEST_ID).call(
        'quest_payload',
        nativeToScVal(questId, { type: 'u32' }),
        new Address(recipient).toScVal(),
      ),
    )
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`payload read failed: ${sim.error}`);
  }
  const retval = sim.result?.retval;
  if (!retval) throw new Error('payload read returned nothing');
  const payload = scValToNative(retval) as Uint8Array;
  const sig = kp.sign(Buffer.from(payload));
  return { attester: kp.rawPublicKey().toString('hex'), sig: sig.toString('base64') };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
