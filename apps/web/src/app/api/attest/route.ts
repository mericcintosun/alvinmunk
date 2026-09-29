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
 * Repeatable quests (#154, `quest_registry.set_quest_period`): the signature names the
 * current period, and only evidence dated inside it counts — a PR merged, a vouch claimed
 * this period. A referral can't be dated, so a repeatable quest can't take one.
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
  xdr,
} from '@stellar/stellar-sdk';
import {
  FRESH_EVIDENCE,
  MAX_BODY_BYTES,
  REFERRAL_MARKER_KEY,
  VOUCH_BACK_MIN,
  buildQuestEvidenceMap,
  decodeDataEntry,
  evidenceMatchesQuest,
  isGAddress,
  isValidQuestId,
  judgeReferral,
  parseRepoAllowlist,
  questWindow,
  repoAllowed,
  signQuestPayload,
  signatureExpiry,
  validateEvidence,
  WEEK_SECS,
  type AttestEvidence,
  type QuestWindow,
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
/** GitHub / Horizon reads give up after this long: a stalled connection can't hang the route. */
const UPSTREAM_TIMEOUT_MS = 8_000;

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

  // 3) A repeatable quest's signature names the current period, and its evidence must be
  // dated inside it. A failed read signs as one-shot: for a repeatable quest that payload
  // can't verify on-chain, so the mistake costs a retry, never an award.
  const evidence = body.evidence as AttestEvidence;
  const nowSecs = Math.floor(now / 1000);
  const window = questWindow(nowSecs, await questPeriod(body.questId));
  if (window && !FRESH_EVIDENCE.has(evidence.type)) {
    return json({ error: 'this quest repeats, and a referral can’t be dated to this round' }, 422);
  }
  const round = window?.periodSecs === WEEK_SECS ? ' this week' : window ? ' this round' : '';

  // 4) A quest the recipient already completed (this period, for a repeatable one) can't be
  // awarded again (the contract's replay guard), so stop before verifying evidence: no
  // GitHub/Horizon/RPC quota spent and nothing signed. One read of `is_completed`; if it
  // fails or the deployed contract predates the view, carry on — the on-chain guard still
  // refuses the award.
  if (await questCompleted(body.questId, body.recipient)) {
    return json({ error: `You’ve already completed this quest${round}.` }, 409);
  }

  // 5) Verify the real-world action (network).
  const verified = await verifyEvidence(evidence, body.recipient, window);
  if (!verified.ok) {
    // 422 means the evidence itself failed. GitHub or Horizon being slow, down or
    // rate-limiting keeps its own 5xx status and says a retry can work.
    return 'status' in verified
      ? json({ error: verified.reason, retryable: true }, verified.status)
      : json({ error: verified.reason }, 422);
  }

  // 6) Sign the award payload, built here (never read from an RPC node). The recipient
  // redeems it on-chain; the contract refuses it after `expiresAt` (unix seconds, compared
  // with the ledger time, which tracks wall-clock time), which never passes the end of a
  // repeatable quest's period.
  try {
    const expiresAt = signatureExpiry(nowSecs, window);
    const ctx = { contractId: QUEST_ID, passphrase: PASSPHRASE };
    const signed = signQuestPayload(secret, ctx, body.questId, body.recipient, expiresAt, window);
    return json({ ok: true, ...signed, recipient: body.recipient, questId: body.questId });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'sign failed' }, 500);
  }
});

/**
 * Check the real action behind `ev`. For a repeatable quest (`window`), only an action dated
 * inside the current period counts, so the same PR or vouches can't be redeemed every period.
 */
async function verifyEvidence(
  ev: AttestEvidence,
  recipient: string,
  window: QuestWindow | null,
): Promise<{ ok: true } | { ok: false; reason: string } | UpstreamFailure> {
  const since = window?.start ?? null;
  // Invite-converts (growth quest): the person you invited must have claimed a vouch
  // minted by the recipient. A Social score alone is not enough — any vouched wallet
  // could be unrelated to the inviter. The RPC only retains a limited event window, so a
  // no-match result can also mean the claim happened too far back to see.
  if (ev.type === 'invite_converts') {
    if (!REP_ID) return { ok: false, reason: 'reputation contract not configured' };
    try {
      if (await claimedVouchFrom(REP_ID, recipient, ev.ref, since)) return { ok: true };
      return {
        ok: false,
        reason:
          since === null
            ? "that wallet hasn't claimed a vouch from you recently — only claims still inside the network's recent event window can be verified for now"
            : "that wallet hasn't claimed a vouch from you this round — this quest needs a new one each time",
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
      const n = await countVouchesClaimedBy(REP_ID, recipient, since);
      const when = since === null ? 'so far' : 'this round';
      return n >= VOUCH_BACK_MIN
        ? { ok: true }
        : { ok: false, reason: `vouch for ${VOUCH_BACK_MIN} people first (${n} claimed ${when})` };
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
    const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${num}`;
    const r = await getJson('github', url, headers);
    if (!r.ok) return r;
    if (!r.found) return { ok: false, reason: 'github 404' };
    const pr = r.body as { merged?: boolean; merged_at?: string | null } | null;
    if (pr?.merged !== true) return { ok: false, reason: 'PR not merged' };
    if (since !== null && !(Date.parse(pr.merged_at ?? '') / 1000 >= since)) {
      return { ok: false, reason: 'that PR was merged before this round — this quest needs a new one' };
    }
    return { ok: true };
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
    const read = invitedBy === null && isGAddress(ev.ref) ? await readReferralMarker(ev.ref) : null;
    const failed = typeof read === 'object' && read !== null;
    // A Horizon failure only decides where the marker would: a wallet with no score is
    // refused on that alone (judgeReferral checks the score first).
    if (failed && score > 0n) return read;
    const marker = failed ? undefined : read;
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
 * or the entry doesn't exist, an UpstreamFailure when Horizon couldn't be read.
 */
async function readReferralMarker(ref: string): Promise<string | null | UpstreamFailure> {
  const r = await getJson('horizon', `${HORIZON}/accounts/${ref}`);
  if (!r.ok) return r;
  if (!r.found) return null;
  const raw = (r.body as { data?: Record<string, unknown> } | null)?.data?.[REFERRAL_MARKER_KEY];
  return typeof raw === 'string' ? decodeDataEntry(raw) : null;
}

/**
 * GitHub or Horizon failing to answer. That says nothing about the evidence, so it is
 * never a 422: 504 on a timeout, 503 when unreachable, rate-limited (403/429) or down
 * (5xx), 502 on any other status or a body that isn't JSON.
 */
interface UpstreamFailure {
  ok: false;
  reason: string;
  status: 502 | 503 | 504;
}

/**
 * GET `url` as JSON, giving up after UPSTREAM_TIMEOUT_MS. A 404 (no such PR or account) is
 * an answer, `found: false`, not a failure. Never throws.
 */
async function getJson(
  upstream: 'github' | 'horizon',
  url: string,
  headers?: Record<string, string>,
): Promise<
  { ok: true; found: false } | { ok: true; found: true; body: unknown } | UpstreamFailure
> {
  const fail = (status: UpstreamFailure['status'], reason: string): UpstreamFailure => ({
    ok: false,
    reason: `${reason} — try again`,
    status,
  });
  const timedOut = () => fail(504, `${upstream} timed out`);
  let r: Response;
  try {
    r = await fetch(url, { headers, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  } catch (e) {
    // Not only the timeout: a DNS failure or a connection reset rejects too.
    return isTimeout(e) ? timedOut() : fail(503, `couldn’t reach ${upstream} right now`);
  }
  if (r.status === 404) return { ok: true, found: false };
  if (!r.ok) {
    // 403 is GitHub's unauthenticated rate limit (GITHUB_TOKEN unset), 429 its other one.
    const busy = r.status === 403 || r.status === 429 || r.status >= 500;
    return fail(busy ? 503 : 502, `${upstream} unavailable (${r.status})`);
  }
  try {
    return { ok: true, found: true, body: await r.json() };
  } catch (e) {
    // The timeout also covers reading the body.
    return isTimeout(e) ? timedOut() : fail(502, `${upstream} sent an unreadable answer`);
  }
}

function isTimeout(e: unknown): boolean {
  return (e as { name?: unknown } | null)?.name === 'TimeoutError';
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
  visit: (claim: { from: string; claimer: string; at: number }) => boolean | void,
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
      const at = Date.parse(e.ledgerClosedAt) / 1000; // NaN when the RPC omits it
      if (decoded && visit({ ...decoded, at }) === true) return;
    }
    cursor = res.cursor;
    if (!cursor) return;
    const at = cursorLedger(cursor);
    if (at !== null && res.latestLedger && at >= res.latestLedger) return;
  }
}

/** Whether a claim at `at` (unix seconds) counts: any time, or from `since` on. An undated
 *  claim never counts for a period. */
const inRound = (at: number, since: number | null) => since === null || at >= since;

/** Distinct wallets that claimed a vouch minted by `from`, within the RPC's retention window
 *  (and from `since` on, when given). */
async function countVouchesClaimedBy(repId: string, from: string, since: number | null): Promise<number> {
  const claimers = new Set<string>();
  await scanVouchClaimed(repId, (c) => {
    if (c.from === from && inRound(c.at, since)) claimers.add(c.claimer);
  });
  return claimers.size;
}

/** Whether `claimer` claimed a vouch minted by `from` within the RPC's retention window (and
 *  from `since` on, when given). */
async function claimedVouchFrom(
  repId: string,
  from: string,
  claimer: string,
  since: number | null,
): Promise<boolean> {
  let found = false;
  await scanVouchClaimed(
    repId,
    (c) => (found = c.from === from && c.claimer === claimer && inRound(c.at, since)),
  );
  return found;
}

/**
 * `quest_registry.get_quest_periods([quest_id])` via simulation: the quest's repeat period
 * in seconds, `0` for a one-shot quest — and when the read fails for any reason (RPC error,
 * or a deployed contract that predates repeatable quests). Signing a repeatable quest as
 * one-shot is safe: the contract rebuilds the other payload and the signature fails.
 */
async function questPeriod(questId: number): Promise<number> {
  try {
    const server = new rpc.Server(RPC_URL, { allowHttp: RPC_URL.startsWith('http://') });
    const source = new Account(Keypair.random().publicKey(), '0');
    const ids = xdr.ScVal.scvVec([nativeToScVal(questId, { type: 'u32' })]);
    const tx = new TransactionBuilder(source, { fee: '100', networkPassphrase: PASSPHRASE })
      .addOperation(new Contract(QUEST_ID).call('get_quest_periods', ids))
      .setTimeout(30)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim) || !sim.result?.retval) return 0;
    const v = scValToNative(sim.result.retval) as unknown;
    const period = Array.isArray(v) && v.length === 1 ? Number(v[0]) : 0;
    return Number.isSafeInteger(period) && period > 0 ? period : 0;
  } catch {
    return 0;
  }
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
