/**
 * Serverless ATTESTER (no standing backend — 00-strategy). Holds the allowlisted
 * attester secret (server-only ATTESTER_SECRET_KEY), VERIFIES a real action, then
 * signs + submits `quest_registry.award_quest` on-chain. The attester's public key
 * must be allowlisted via `quest_registry.add_attester` (see scripts/deploy-testnet.sh).
 *
 * Only cryptographically / API-verifiable quests are accepted (00-strategy §1):
 *   - github_pr   : evidence.ref = "owner/repo#123" -> PR must be merged
 *   - referral_tx : evidence.ref = "G..." address   -> must have ≥1 on-chain tx
 *
 * Defense-in-depth (belts/08 §security): wallet-ownership proof bound to this
 * deployment (v2 message), ±2 min freshness, per-signature in-window replay guard,
 * per-IP rate limit, bounded request body, optional GitHub repo allowlist, and a
 * self-referral guard. The on-chain replay guard is the hard cap.
 */
import {
  Address,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from '@stellar/stellar-sdk';
import {
  FRESHNESS_MS,
  MAX_BODY_BYTES,
  isGAddress,
  isValidQuestId,
  makeReplayGuard,
  ownershipMessage,
  parseRepoAllowlist,
  repoAllowed,
  validateEvidence,
  withinFreshness,
  type AttestClaim,
  type AttestEvidence,
} from '../../../lib/attest';

export const runtime = 'nodejs';

interface AttestRequest extends AttestClaim {
  /** base64 ed25519 signature of the canonical message, by the recipient wallet. */
  signature: string;
}

const RATE_MAX = 6; // requests per window per IP
const RATE_WINDOW_MS = 60_000;

// Best-effort in-memory rate limit (resets on cold start; on-chain replay guard is
// the hard limit — each (quest, recipient) can only ever be awarded once).
const hits = new Map<string, { n: number; resetAt: number }>();

// Best-effort per-signature replay guard within the freshness window.
const replay = makeReplayGuard(FRESHNESS_MS);

function rateLimited(ip: string, now: number): boolean {
  // Bound memory: drop expired buckets before they accumulate across a warm instance.
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
// Optional: restrict github_pr quests to specific repos so a user can't point at a
// random famous merged PR. Unset = any repo (backward compatible).
const REPO_ALLOWLIST = parseRepoAllowlist(process.env.QUEST_GITHUB_REPOS);

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.ATTESTER_SECRET_KEY;
  if (!secret || !QUEST_ID) {
    return json({ error: 'attester not configured (ATTESTER_SECRET_KEY / quest id)' }, 500);
  }

  // Bound the request body before reading it.
  const len = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(len) && len > MAX_BODY_BYTES) {
    return json({ error: 'request too large' }, 413);
  }

  // Rate limit (best-effort; the on-chain replay guard is the hard cap).
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
  if (!isValidQuestId(body.questId) || !isGAddress(body.recipient)) {
    return json({ error: 'questId (number) and recipient (G address) required' }, 400);
  }
  if (typeof body.signature !== 'string' || body.signature.length === 0) {
    return json({ error: 'signature required' }, 400);
  }

  // 1) Freshness — reject stale/future-dated requests outside the window.
  if (!withinFreshness(now, body.timestamp)) {
    return json({ error: 'stale or missing timestamp' }, 401);
  }

  // 2) Evidence shape (cheap, network-free) — format, length, self-referral.
  const shape = validateEvidence(body.evidence, body.recipient);
  if (!shape.ok) return json({ error: shape.reason }, 422);

  // 3) Wallet-ownership proof — only the owner of `recipient` can request a grant
  //    for it. We verify the ed25519 signature over the canonical (v2) message.
  if (!verifyOwnership(body)) {
    return json({ error: 'ownership signature invalid' }, 401);
  }

  // 4) Verify the real-world action (network) BEFORE consuming the replay slot. If we
  //    burned the signature here and GitHub/Horizon returned a transient 5xx, the user
  //    would be locked out for the whole freshness window despite a valid signature.
  //    The on-chain `award_quest` replay guard is the hard idempotency cap regardless.
  const verified = await verifyEvidence(body.evidence as AttestEvidence);
  if (!verified.ok) return json({ error: verified.reason }, 422);

  // 5) Replay guard — a valid, verified signature can be used at most once in-window.
  if (!replay.accept(body.signature, now)) {
    return json({ error: 'duplicate request (replay)' }, 409);
  }

  // 6) Sign + submit award_quest as the attester.
  try {
    const hash = await submitAwardQuest(secret, body.questId, body.recipient);
    logEvent({ route: 'attest', outcome: 'ok', questId: body.questId, ms: Date.now() - now });
    return json({ ok: true, hash, recipient: body.recipient, questId: body.questId });
  } catch (e) {
    // A reverting contract (e.g. the replay guard) is a business condition, not a
    // gateway failure — map known quest_registry error codes to 4xx so callers get a
    // clear signal instead of an alarming 502. Genuine infra errors stay 502.
    const mapped = mapSubmitError(e);
    logEvent({
      route: 'attest',
      outcome: 'error',
      status: mapped.status,
      questId: body.questId,
      ms: Date.now() - now,
    });
    return json({ error: mapped.error }, mapped.status);
  }
}

/** Structured one-line log for observability (captured by the platform log drain). */
function logEvent(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ t: new Date().toISOString(), ...fields }));
}

/** quest_registry Error enum (contracts/quest_registry/src/lib.rs) → HTTP. */
const CONTRACT_ERRORS: Record<number, { status: number; error: string }> = {
  1: { status: 503, error: 'quest registry not initialized' },
  3: { status: 403, error: 'attester not authorized for this quest' },
  4: { status: 404, error: 'quest not found' },
  5: { status: 409, error: 'this wallet has already completed this quest' },
  6: { status: 409, error: 'quest is not active' },
};

function mapSubmitError(e: unknown): { status: number; error: string } {
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.match(/Error\(Contract,\s*#?(\d+)\)/);
  if (m) {
    const code = Number(m[1]);
    return (
      CONTRACT_ERRORS[code] ?? { status: 409, error: `quest rejected (contract error ${code})` }
    );
  }
  return { status: 502, error: msg };
}

function verifyOwnership(body: AttestRequest): boolean {
  try {
    const kp = Keypair.fromPublicKey(body.recipient);
    const message = ownershipMessage(body, { contractId: QUEST_ID, passphrase: PASSPHRASE });
    const msg = Buffer.from(message, 'utf8');
    const sig = Buffer.from(body.signature, 'base64');
    return kp.verify(msg, sig);
  } catch {
    return false;
  }
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
    // KNOWN LIMITATION (belts/08, deferred to Blue): this proves the referred account is
    // active, NOT that a real referral relationship exists between it and the recipient.
    // A genuine binding needs an on-chain edge (e.g. a recorded vouch/payment between the
    // two) — intentionally not enforced at <50 users to avoid premature anti-sybil cost.
    const r = await fetch(`${HORIZON}/accounts/${ev.ref}/transactions?limit=1`);
    if (!r.ok) return { ok: false, reason: 'referred account not found' };
    const data = (await r.json()) as { _embedded?: { records?: unknown[] } };
    return (data._embedded?.records?.length ?? 0) > 0
      ? { ok: true }
      : { ok: false, reason: 'no on-chain activity' };
  }

  return { ok: false, reason: 'unknown evidence type' };
}

async function submitAwardQuest(
  secret: string,
  questId: number,
  recipient: string,
): Promise<string> {
  const kp = Keypair.fromSecret(secret);
  const server = new rpc.Server(RPC_URL, { allowHttp: RPC_URL.startsWith('http://') });
  const account = await server.getAccount(kp.publicKey());

  const tx = new TransactionBuilder(account, { fee: '1000000', networkPassphrase: PASSPHRASE })
    .addOperation(
      new Contract(QUEST_ID).call(
        'award_quest',
        new Address(kp.publicKey()).toScVal(),
        nativeToScVal(questId, { type: 'u32' }),
        new Address(recipient).toScVal(),
      ),
    )
    .setTimeout(60)
    .build();

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(kp);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === 'ERROR') {
    throw new Error(`send failed: ${JSON.stringify(sent.errorResult)}`);
  }
  // Best-effort confirmation; the tx is accepted at this point. Swallow transient
  // decode/RPC hiccups so a successful submission never reports as a failure.
  for (let i = 0; i < 20; i++) {
    try {
      const res = await server.getTransaction(sent.hash);
      if (res.status === 'SUCCESS') return sent.hash;
      if (res.status === 'FAILED') throw new Error('tx failed on-chain');
    } catch (e) {
      if (e instanceof Error && e.message === 'tx failed on-chain') throw e;
      // decode/transient error — keep polling
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return sent.hash;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
