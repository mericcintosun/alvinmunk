/**
 * Serverless ATTESTER (no standing backend — 00-strategy). Holds the allowlisted attester
 * secret (server-only ATTESTER_SECRET_KEY), VERIFIES a real action, then returns its
 * ed25519 SIGNATURE over the quest_registry's canonical award payload, which names the
 * network, the contract and an expiry QUEST_SIG_TTL_SECS ahead (lib/attest.ts
 * questPayload). It does NOT submit a tx: the wallet submits `award_quest` itself before
 * the expiry, proving ownership on-chain via `recipient.require_auth()`. The attester
 * pubkey must be allowlisted via `quest_registry.add_attester_key`.
 *
 * Only cryptographically / API-verifiable quests are accepted (00-strategy §1):
 *   - github_pr   : evidence.ref = "owner/repo#123" -> PR must be merged
 *   - referral_tx : evidence.ref = a G… or C… address -> must be active (Social score > 0)
 *                   and name the recipient as its inviter: registry `invited_by` (any wallet
 *                   kind), else a classic account's "referral" manageData entry
 *
 * Defense-in-depth (belts/08 §security): on-chain recipient.require_auth() ownership +
 * on-chain replay guard (the hard cap), each quest id bound to one evidence type, per-IP
 * rate limit, bounded body, optional GitHub repo allowlist, self-referral guard. The
 * signature is only redeemable by the recipient (they must satisfy require_auth), so
 * issuing it carries no transfer of funds.
 */
import {
  Account,
  Address,
  Contract,
  Keypair,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  rpc,
} from '@stellar/stellar-sdk';
import {
  MAX_BODY_BYTES,
  QUEST_SIG_TTL_SECS,
  REFERRAL_MARKER_KEY,
  VOUCH_BACK_MIN,
  buildQuestEvidenceMap,
  decodeDataEntry,
  evidenceMatchesQuest,
  isGAddress,
  isValidQuestId,
  judgeReferral,
  parseRepoAllowlist,
  repoAllowed,
  signQuestPayload,
  validateEvidence,
  type AttestEvidence,
} from '../../../lib/attest';
import { json, withRoute } from '../../../lib/api-route';
// The app's one resolved (and validated) network config — no per-route testnet defaults — so
// the attester signs for the same network, passphrase and contracts as the client.
import { config, misconfiguredResponse } from '../../../lib/stellar';

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

const RPC_URL = config.rpcUrl;
const HORIZON = config.horizonUrl;
const PASSPHRASE = config.networkPassphrase;
const QUEST_ID = config.contracts.questRegistry;
const REP_ID = config.contracts.reputation;
const REGISTRY_ID = config.contracts.registry;
const REPO_ALLOWLIST = parseRepoAllowlist(process.env.QUEST_GITHUB_REPOS);
/** Safety cap on cursor-pagination pages for the vouch/claimed scan (1 000 events/page). */
const VOUCH_CLAIMED_MAX_PAGES = 50;

// questId → the one evidence type that may claim it (lib/attest.ts buildQuestEvidenceMap).
const QUEST_EVIDENCE = buildQuestEvidenceMap(process.env);

// Recipient may be a classic (G…) OR a passkey smart-account (C…) address.
const STELLAR_ADDRESS = /^[GC][A-Z2-7]{55}$/;

export const POST = withRoute('POST /api/attest', async (req: Request): Promise<Response> => {
  // Never sign on an inconsistent config (say, a mainnet passphrase with a testnet contract).
  const misconfigured = misconfiguredResponse();
  if (misconfigured) return misconfigured;

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

  // 2) The evidence must be the type bound to this quest id — checked before any network
  // call, else one qualifying action could be signed for every quest.
  if (!evidenceMatchesQuest(body.questId, (body.evidence as AttestEvidence).type, QUEST_EVIDENCE)) {
    const reason = QUEST_EVIDENCE.has(body.questId)
      ? 'evidence type does not match this quest'
      : 'this quest cannot be attested';
    return json({ error: reason }, 422);
  }

  // 3) A quest the recipient already completed can't be awarded again (the contract's
  // replay guard), so stop before verifying evidence: no GitHub/Horizon/RPC quota spent and
  // nothing signed. One read of `is_completed`; if it fails or the deployed contract
  // predates the view, carry on — the on-chain guard still refuses the award.
  if (await questCompleted(body.questId, body.recipient)) {
    return json({ error: 'You’ve already completed this quest.' }, 409);
  }

  // 4) Verify the real-world action (network).
  const verified = await verifyEvidence(body.evidence as AttestEvidence, body.recipient);
  if (!verified.ok) return json({ error: verified.reason }, 422);

  // 5) Sign the award payload, built here (never read from an RPC node). The recipient
  // redeems it on-chain; the contract refuses it after `expiresAt` (unix seconds, compared
  // with the ledger time, which tracks wall-clock time).
  try {
    const expiresAt = Math.floor(Date.now() / 1000) + QUEST_SIG_TTL_SECS;
    const ctx = { contractId: QUEST_ID, passphrase: PASSPHRASE };
    const signed = signQuestPayload(secret, ctx, body.questId, body.recipient, expiresAt);
    return json({ ok: true, ...signed, recipient: body.recipient, questId: body.questId });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'sign failed' }, 500);
  }
});

async function verifyEvidence(
  ev: AttestEvidence,
  recipient: string,
): Promise<{ ok: boolean; reason?: string }> {
  // Invite-converts (growth quest): the person you invited must have claimed a vouch
  // minted by the recipient. A Social score alone is not enough — any vouched wallet
  // could be unrelated to the inviter. The RPC only retains a limited event window, so a
  // no-match result can also mean the claim happened too far back to see.
  if (ev.type === 'invite_converts') {
    if (!REP_ID) return { ok: false, reason: 'reputation contract not configured' };
    try {
      if (await claimedVouchFrom(REP_ID, recipient, ev.ref)) return { ok: true };
      return {
        ok: false,
        reason:
          "that wallet hasn't claimed a vouch from you recently — only claims still inside the network's recent event window can be verified for now",
      };
    } catch {
      return { ok: false, reason: "couldn't read the invite claim history right now — try again" };
    }
  }

  // Vouch-back (retention quest): you have vouched for >= VOUCH_BACK_MIN distinct people.
  //
  // Fix (#165): count distinct CLAIMERS from `vouch/claimed` events where `from` is the
  // recipient — not minted IDs from `vouch/minted`. A minted vouch is only a bearer link
  // that may never be redeemed; the quest promises "vouch for 3 people", which requires a
  // claim. Scan from the RPC's actual oldestLedger so vouches made earlier in the week are
  // not invisible, and follow the cursor until exhausted.
  if (ev.type === 'vouch_back') {
    if (!REP_ID) return { ok: false, reason: 'reputation contract not configured' };
    try {
      const n = await countVouchesClaimedBy(REP_ID, recipient);
      return n >= VOUCH_BACK_MIN
        ? { ok: true }
        : { ok: false, reason: `vouch for ${VOUCH_BACK_MIN} people first (${n} claimed so far)` };
    } catch {
      return { ok: false, reason: "couldn't read your vouch history right now — try again" };
    }
  }

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
    if (!REP_ID) return { ok: false, reason: 'reputation contract not configured' };
    let score: bigint;
    try {
      score = await readU64(REP_ID, 'get_score', ev.ref);
    } catch {
      return { ok: false, reason: 'couldn’t read the referred wallet’s activity right now — try again' };
    }
    const invitedBy = await readInvitedBy(ev.ref);
    // A registry binding decides on its own; the classic marker is only read without one.
    const marker = invitedBy === null && isGAddress(ev.ref) ? await readReferralMarker(ev.ref) : null;
    return judgeReferral({ score, invitedBy, marker }, ev.ref, recipient);
  }

  return { ok: false, reason: 'unknown evidence type' };
}

/** Read a u64-returning view (e.g. get_score) via simulation — no fee, no signature. */
async function readU64(contractId: string, method: string, addr: string): Promise<bigint> {
  const server = new rpc.Server(RPC_URL, { allowHttp: RPC_URL.startsWith('http://') });
  const source = new Account(Keypair.random().publicKey(), '0');
  const tx = new TransactionBuilder(source, { fee: '100', networkPassphrase: PASSPHRASE })
    .addOperation(new Contract(contractId).call(method, new Address(addr).toScVal()))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  const v = sim.result?.retval;
  return v ? BigInt(scValToNative(v) as number | bigint) : 0n;
}

/**
 * `registry.invited_by(addr)` via simulation: the inviter's address, null when unbound (or
 * no registry is configured, or the deployed one predates invite bindings), undefined when
 * the read failed.
 */
async function readInvitedBy(addr: string): Promise<string | null | undefined> {
  if (!REGISTRY_ID) return null;
  try {
    const server = new rpc.Server(RPC_URL, { allowHttp: RPC_URL.startsWith('http://') });
    const source = new Account(Keypair.random().publicKey(), '0');
    const tx = new TransactionBuilder(source, { fee: '100', networkPassphrase: PASSPHRASE })
      .addOperation(new Contract(REGISTRY_ID).call('invited_by', new Address(addr).toScVal()))
      .setTimeout(30)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) {
      return /Error\(WasmVm, MissingValue\)|non-existent contract function/.test(sim.error)
        ? null
        : undefined;
    }
    const v = sim.result?.retval ? scValToNative(sim.result.retval) : null;
    return typeof v === 'string' ? v : null;
  } catch {
    return undefined;
  }
}

/**
 * A classic account's `referral` manageData entry, decoded (Horizon): null when the account
 * or the entry doesn't exist, undefined when Horizon couldn't be read.
 */
async function readReferralMarker(ref: string): Promise<string | null | undefined> {
  try {
    const r = await fetch(`${HORIZON}/accounts/${ref}`);
    if (r.status === 404) return null;
    if (!r.ok) return undefined;
    const acct = (await r.json()) as { data?: Record<string, string> };
    const raw = acct.data?.[REFERRAL_MARKER_KEY];
    return raw ? decodeDataEntry(raw) : null;
  } catch {
    return undefined;
  }
}

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
 * Exported so it can be unit-tested independently of the RPC layer.
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

/** The ledger a stellar-rpc events cursor points at ("<toid>-<n>"; the ledger is the toid's top 32 bits). */
function cursorLedger(cursor: string): number | null {
  const toid = cursor.split('-')[0];
  return /^\d+$/.test(toid) ? Number(BigInt(toid) >> 32n) : null;
}

/**
 * Walk every retained `vouch/claimed` event, oldest first, until `visit` returns true. Starts at
 * the oldest ledger the RPC keeps and follows the cursor: stellar-rpc scans at most 10,000
 * ledgers per request and always returns a cursor, so the walk ends once the cursor reaches
 * the latest ledger (or the RPC returns none), capped at VOUCH_CLAIMED_MAX_PAGES requests.
 */
async function scanVouchClaimed(
  repId: string,
  visit: (claim: { from: string; claimer: string }) => boolean | void,
): Promise<void> {
  const server = new rpc.Server(RPC_URL, { allowHttp: RPC_URL.startsWith('http://') });
  const health = await server.getHealth();
  const startLedger = health.oldestLedger ?? 1;
  // Topic filter: (`vouch`, `claimed`) — only claimed vouches, not mints or slashes.
  const t0 = nativeToScVal('vouch', { type: 'symbol' }).toXDR('base64');
  const t1 = nativeToScVal('claimed', { type: 'symbol' }).toXDR('base64');
  const filters = [{ type: 'contract' as const, contractIds: [repId], topics: [[t0, t1]] }];

  let cursor: string | undefined;
  for (let page = 0; page < VOUCH_CLAIMED_MAX_PAGES; page++) {
    const res = await server.getEvents(
      cursor ? { filters, cursor, limit: 1000 } : { filters, startLedger, limit: 1000 },
    );
    for (const e of res.events) {
      const decoded = decodeVouchClaimedEvent(scValToNative(e.value));
      if (decoded && visit(decoded) === true) return;
    }
    cursor = res.cursor;
    if (!cursor) return;
    const at = cursorLedger(cursor);
    if (at !== null && res.latestLedger && at >= res.latestLedger) return;
  }
}

/** Distinct wallets that claimed a vouch minted by `from`, within the RPC's retention window. */
async function countVouchesClaimedBy(repId: string, from: string): Promise<number> {
  const claimers = new Set<string>();
  await scanVouchClaimed(repId, (c) => {
    if (c.from === from) claimers.add(c.claimer);
  });
  return claimers.size;
}

/** Whether `claimer` claimed a vouch minted by `from` within the RPC's retention window. */
async function claimedVouchFrom(repId: string, from: string, claimer: string): Promise<boolean> {
  let found = false;
  await scanVouchClaimed(repId, (c) => (found = c.from === from && c.claimer === claimer));
  return found;
}

/**
 * `quest_registry.is_completed(quest_id, addr)` via simulation. False when the read fails
 * for any reason (RPC error, or a deployed contract without the view): this is only an
 * early exit, never the guard itself.
 */
async function questCompleted(questId: number, addr: string): Promise<boolean> {
  try {
    const server = new rpc.Server(RPC_URL, { allowHttp: RPC_URL.startsWith('http://') });
    const source = new Account(Keypair.random().publicKey(), '0');
    const tx = new TransactionBuilder(source, { fee: '100', networkPassphrase: PASSPHRASE })
      .addOperation(
        new Contract(QUEST_ID).call(
          'is_completed',
          nativeToScVal(questId, { type: 'u32' }),
          new Address(addr).toScVal(),
        ),
      )
      .setTimeout(30)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) return false;
    const v = sim.result?.retval;
    return v ? scValToNative(v) === true : false;
  } catch {
    return false;
  }
}
