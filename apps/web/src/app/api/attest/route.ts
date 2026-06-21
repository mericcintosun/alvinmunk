/**
 * Serverless ATTESTER (no standing backend — 00-strategy). Holds the allowlisted
 * attester secret (server-only ATTESTER_SECRET_KEY), VERIFIES a real action, then
 * signs + submits `quest_registry.award_quest` on-chain. The attester's public key
 * must be allowlisted via `quest_registry.add_attester` (see scripts/deploy-testnet.sh).
 *
 * Only cryptographically / API-verifiable quests are accepted (00-strategy §1):
 *   - github_pr   : evidence.ref = "owner/repo#123" -> PR must be merged
 *   - referral_tx : evidence.ref = "G..." address   -> must have ≥1 on-chain tx
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

export const runtime = 'nodejs';

interface AttestRequest {
  questId: number;
  recipient: string;
  evidence?: { type: 'github_pr' | 'referral_tx'; ref: string };
}

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? 'https://soroban-testnet.stellar.org';
const HORIZON = process.env.NEXT_PUBLIC_HORIZON_URL ?? 'https://horizon-testnet.stellar.org';
const PASSPHRASE =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
const QUEST_ID = process.env.NEXT_PUBLIC_QUEST_REGISTRY_CONTRACT_ID ?? '';

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.ATTESTER_SECRET_KEY;
  if (!secret || !QUEST_ID) {
    return json({ error: 'attester not configured (ATTESTER_SECRET_KEY / quest id)' }, 500);
  }

  let body: AttestRequest;
  try {
    body = (await req.json()) as AttestRequest;
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  if (typeof body.questId !== 'number' || !/^[GC][A-Z2-7]{55}$/.test(body.recipient ?? '')) {
    return json({ error: 'questId (number) and recipient (G/C address) required' }, 400);
  }

  // 1) Verify the real-world action.
  const verified = await verifyEvidence(body);
  if (!verified.ok) return json({ error: verified.reason }, 422);

  // 2) Sign + submit award_quest as the attester.
  try {
    const hash = await submitAwardQuest(secret, body.questId, body.recipient);
    return json({ ok: true, hash, recipient: body.recipient, questId: body.questId });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'submit failed' }, 502);
  }
}

async function verifyEvidence(body: AttestRequest): Promise<{ ok: boolean; reason?: string }> {
  const ev = body.evidence;
  if (!ev) return { ok: false, reason: 'evidence required' };

  if (ev.type === 'github_pr') {
    const m = ev.ref.match(/^([\w.-]+)\/([\w.-]+)#(\d+)$/);
    if (!m) return { ok: false, reason: 'ref must be owner/repo#number' };
    const [, owner, repo, num] = m;
    const headers: Record<string, string> = { accept: 'application/vnd.github+json' };
    if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${num}`, { headers });
    if (!r.ok) return { ok: false, reason: `github ${r.status}` };
    const pr = (await r.json()) as { merged?: boolean };
    return pr.merged ? { ok: true } : { ok: false, reason: 'PR not merged' };
  }

  if (ev.type === 'referral_tx') {
    if (!/^G[A-Z2-7]{55}$/.test(ev.ref)) return { ok: false, reason: 'ref must be a G address' };
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
