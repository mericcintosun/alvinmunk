'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { connectViaKit } from '@/lib/wallet-kit';
import type { Wallet } from '@/lib/wallet';
import { FOCUS_MODE } from '@/lib/focus';
import { txExplorerUrl } from '@/lib/stellar';
import { shortAddr } from '@alvinmunk/shared';
import {
  addReward,
  getAllRewards,
  getDailyCap,
  setRewardActive,
  setRewardSupply,
  stroopsToUsdc,
  type RewardEntry,
} from '@/lib/rewards';
import { createGate, readGates, setGateActive, TRACK, type Gate } from '@/lib/gate';
import {
  createQuest,
  getQuestPeriods,
  readQuest,
  setQuestActive,
  setQuestPeriod,
  type QuestConfig,
} from '@/lib/quests';
import { WEEK_SECS } from '@/lib/attest';
import {
  CONTENT_SECTIONS,
  adminErrorMessage,
  gateConsequence,
  gateToggleConsequence,
  manageableSections,
  parseU32,
  questConsequence,
  questPeriodConsequence,
  questToggleConsequence,
  readContentAdmins,
  rewardConsequence,
  rewardToggleConsequence,
  supplyConsequence,
  validateGate,
  validateQuest,
  validateReward,
  validateSupply,
  type ContentAdmins,
  type ContentSection,
} from '@/lib/admin';

/**
 * /admin — content management (#296): create and toggle rewards, gates and quests without
 * the CLI. Unlinked from public nav and noindex (layout.tsx).
 *
 * Controls render only while the connected wallet IS the admin each contract stores
 * on-chain (lib/admin). That is a UI gate; the real one is `admin.require_auth()` in every
 * write, so this page can't change content without the admin's own signature. Transactions
 * are built here and signed in the admin's wallet (Stellar Wallets Kit), never by a server.
 * Admin copy is English-only, like the rest of the admin surface.
 */
export default function AdminPage() {
  const [admins, setAdmins] = useState<ContentAdmins | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [section, setSection] = useState<ContentSection>('rewards');

  const loadAdmins = useCallback(() => {
    setAdmins(null);
    void readContentAdmins().then(setAdmins);
  }, []);
  useEffect(loadAdmins, [loadAdmins]);

  async function connect() {
    setConnectError(null);
    setConnecting(true);
    try {
      setWallet(await connectViaKit());
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : 'Could not connect the wallet.');
    } finally {
      setConnecting(false);
    }
  }

  const connectButton = (label: string) => (
    <Button size="sm" variant="outline" onClick={connect} disabled={connecting}>
      {connecting ? 'Connecting…' : label}
    </Button>
  );

  if (!wallet) {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">Connect the admin wallet to continue.</p>
        <div className="mt-4">{connectButton('Connect wallet')}</div>
        {connectError && <p className="mt-3 text-sm text-destructive">{connectError}</p>}
      </Shell>
    );
  }
  if (!admins) {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">Reading the on-chain admin…</p>
      </Shell>
    );
  }

  const sections = manageableSections(wallet.address, admins);
  if (sections.length === 0) {
    const unread = CONTENT_SECTIONS.every((s) => !admins[s]);
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">
          {unread
            ? 'Couldn’t read the admin from the contracts (not deployed, or the RPC is unreachable).'
            : `${shortAddr(wallet.address)} is not the on-chain admin.`}
        </p>
        <div className="mt-4 flex gap-2">
          {unread ? (
            <Button size="sm" variant="outline" onClick={loadAdmins}>
              Retry
            </Button>
          ) : (
            connectButton('Switch wallet')
          )}
        </div>
      </Shell>
    );
  }

  const current = sections.includes(section) ? section : sections[0];
  return (
    <div className="container max-w-5xl py-12">
      <p className="text-xs uppercase tracking-[0.25em] text-secondary">admin // content</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-semibold">Content</h1>
        <Badge variant="onchain">on-chain admin · {shortAddr(wallet.address)}</Badge>
        {connectButton('Switch wallet')}
      </div>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Create and toggle the on-chain rewards, gates and quests. Each write states its exact
        consequence first, is signed in your wallet, and links to its transaction.
      </p>
      {FOCUS_MODE && (
        <p className="mt-4 max-w-2xl rounded-xl border border-border bg-card/40 px-4 py-3 text-sm text-muted-foreground">
          Focus mode is on: players don’t see rewards, gates or quests in the app yet. What you
          publish here is live on-chain as soon as it confirms, and shows in the app once
          NEXT_PUBLIC_FOCUS_MODE=false.
        </p>
      )}
      <nav className="mb-6 mt-8 flex gap-2" aria-label="Content sections">
        {sections.map((s) => (
          <Button
            key={s}
            size="sm"
            variant={s === current ? 'primary' : 'outline'}
            onClick={() => setSection(s)}
          >
            {s[0].toUpperCase() + s.slice(1)}
          </Button>
        ))}
      </nav>
      {current === 'rewards' && <RewardsAdmin wallet={wallet} />}
      {current === 'gates' && <GatesAdmin wallet={wallet} />}
      {current === 'quests' && <QuestsAdmin wallet={wallet} />}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="container max-w-5xl py-12">
      <p className="text-xs uppercase tracking-[0.25em] text-secondary">admin</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

// ── Confirm → sign → receipt ──

interface PendingWrite {
  consequence: string;
  run: () => Promise<string>;
  onDone?: () => void;
}

/** One write at a time per section: review states the consequence, confirm signs it. */
function useWrite(section: ContentSection, reload?: () => Promise<void>) {
  const [pending, setPending] = useState<PendingWrite | null>(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<{ consequence: string; hash: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const review = (consequence: string, run: () => Promise<string>, onDone?: () => void) => {
    setError(null);
    setReceipt(null);
    setPending({ consequence, run, onDone });
  };
  const reject = (message: string) => {
    setPending(null);
    setReceipt(null);
    setError(message);
  };
  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const hash = await pending.run();
      setReceipt({ consequence: pending.consequence, hash });
      pending.onDone?.();
      await reload?.();
    } catch (e) {
      setError(adminErrorMessage(section, e));
    } finally {
      setPending(null);
      setBusy(false);
    }
  };
  return { pending, busy, receipt, error, review, reject, confirm, cancel: () => setPending(null) };
}

function WriteStatus({ write }: { write: ReturnType<typeof useWrite> }) {
  return (
    <div className="mt-4 grid gap-3" aria-live="polite">
      {write.pending && (
        <div className="rounded-xl border border-primary/40 bg-primary/5 p-4 text-sm">
          <p className="font-medium">{write.pending.consequence}</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={write.confirm} disabled={write.busy}>
              {write.busy ? 'Waiting for signature and confirmation…' : 'Confirm and sign'}
            </Button>
            <Button size="sm" variant="ghost" onClick={write.cancel} disabled={write.busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {write.error && <p className="text-sm text-destructive">{write.error}</p>}
      {write.receipt && (
        <div className="rounded-xl border border-border bg-card/40 p-4 text-sm">
          <p className="font-medium">Confirmed on-chain.</p>
          <p className="mt-1 text-muted-foreground">{write.receipt.consequence}</p>
          {write.receipt.hash && (
            <p className="mt-2 text-xs text-muted-foreground">
              Confirmed in transaction <code>{shortAddr(write.receipt.hash, 8, 8)}</code> ·{' '}
              <a
                className="underline"
                href={txExplorerUrl(write.receipt.hash)}
                target="_blank"
                rel="noreferrer"
              >
                view on Stellar Expert
              </a>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card/40 p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      {note && <p className="mt-1 text-sm text-muted-foreground">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function LoadError({ message, retry }: { message: string; retry: () => Promise<void> }) {
  return (
    <p className="mt-4 flex items-center gap-3 text-sm text-destructive">
      {message}
      <Button size="sm" variant="outline" onClick={() => void retry()}>
        Retry
      </Button>
    </p>
  );
}

const rowClass =
  'flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-4 py-3 text-sm';

// ── Rewards ──

function RewardsAdmin({ wallet }: { wallet: Wallet }) {
  const [rows, setRows] = useState<RewardEntry[] | null>(null);
  const [dailyCap, setDailyCap] = useState<bigint>(0n);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState({ id: '', threshold: '', amount: '' });
  const [supply, setSupply] = useState({ id: '', maxClaims: '' });

  const load = useCallback(async () => {
    try {
      const [table, cap] = await Promise.all([getAllRewards(), getDailyCap()]);
      setRows(table);
      setDailyCap(cap);
      setLoadError(null);
    } catch (e) {
      setLoadError(adminErrorMessage('rewards', e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const write = useWrite('rewards', load);
  const busy = write.busy || rows === null;
  // A contract deployed before supply caps (#298) returns rows without the counters.
  const hasSupply = (rows ?? []).every((r) => r.max_claims !== undefined);

  function reviewReward() {
    const v = validateReward(form, dailyCap);
    if (!v.ok) return write.reject(v.error);
    const d = v.value;
    write.review(
      rewardConsequence(d, rows?.find((r) => r.id === d.id)),
      () => addReward(wallet, d.id, d.threshold, d.amount),
      () => setForm({ id: '', threshold: '', amount: '' }),
    );
  }

  function reviewSupply() {
    const v = validateSupply(supply, rows ?? []);
    if (!v.ok) return write.reject(v.error);
    const { reward, maxClaims } = v.value;
    write.review(
      supplyConsequence(reward, maxClaims),
      () => setRewardSupply(wallet, reward.id, maxClaims),
      () => setSupply({ id: '', maxClaims: '' }),
    );
  }

  return (
    <Panel
      title="Rewards"
      note={`Threshold in Earned XP, payout in USDC. ${
        dailyCap > 0n
          ? `Daily cap: ${stroopsToUsdc(dailyCap)} USDC, so no reward can pay more.`
          : 'No daily cap is set.'
      }`}
    >
      <div className="grid gap-3 md:grid-cols-4">
        <Input
          aria-label="Reward ID"
          placeholder="Reward ID"
          inputMode="numeric"
          value={form.id}
          onChange={(e) => setForm({ ...form, id: e.target.value })}
        />
        <Input
          aria-label="Earned XP threshold"
          placeholder="Earned XP threshold"
          inputMode="numeric"
          value={form.threshold}
          onChange={(e) => setForm({ ...form, threshold: e.target.value })}
        />
        <Input
          aria-label="USDC amount"
          placeholder="USDC amount"
          inputMode="decimal"
          value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })}
        />
        <Button onClick={reviewReward} disabled={busy}>
          Review reward
        </Button>
      </div>
      {hasSupply && (
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <Input
            aria-label="Supply cap reward ID"
            placeholder="Reward ID"
            inputMode="numeric"
            value={supply.id}
            onChange={(e) => setSupply({ ...supply, id: e.target.value })}
          />
          <Input
            aria-label="Max claims"
            placeholder="Max claims (0 = unlimited)"
            inputMode="numeric"
            value={supply.maxClaims}
            onChange={(e) => setSupply({ ...supply, maxClaims: e.target.value })}
          />
          <div className="hidden md:block" />
          <Button variant="outline" onClick={reviewSupply} disabled={busy}>
            Review supply cap
          </Button>
        </div>
      )}
      <WriteStatus write={write} />
      {loadError && <LoadError message={loadError} retry={load} />}
      {rows?.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">No rewards registered.</p>
      )}
      <ul className="mt-4 grid gap-2">
        {(rows ?? []).map((r) => (
          <li key={r.id} className={rowClass}>
            <span>
              #{r.id} · ≥ {String(r.threshold)} Earned XP → {stroopsToUsdc(r.amount)} USDC
              {r.max_claims !== undefined &&
                ` · ${r.claims ?? 0}${r.max_claims > 0 ? ` of ${r.max_claims}` : ''} claimed`}
            </span>
            <span className="flex items-center gap-2">
              <Badge variant={r.active ? 'success' : 'default'}>
                {r.active ? 'active' : 'disabled'}
              </Badge>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  setForm({
                    id: String(r.id),
                    threshold: String(r.threshold),
                    amount: stroopsToUsdc(r.amount),
                  })
                }
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant={r.active ? 'destructive' : 'outline'}
                disabled={busy}
                onClick={() =>
                  write.review(rewardToggleConsequence(r, !r.active), () =>
                    setRewardActive(wallet, r.id, !r.active),
                  )
                }
              >
                {r.active ? 'Disable' : 'Enable'}
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ── Gates ──

function GatesAdmin({ wallet }: { wallet: Wallet }) {
  const [rows, setRows] = useState<Gate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const empty = { id: '', track: String(TRACK.EARNED), min: '', label: '' };
  const [form, setForm] = useState(empty);

  const load = useCallback(async () => {
    try {
      setRows(await readGates());
      setLoadError(null);
    } catch (e) {
      setLoadError(adminErrorMessage('gates', e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const write = useWrite('gates', load);
  const busy = write.busy || rows === null;

  function reviewGate() {
    const v = validateGate(form);
    if (!v.ok) return write.reject(v.error);
    const d = v.value;
    write.review(
      gateConsequence(d, rows?.find((g) => g.id === d.id)),
      () => createGate(wallet, d.id, d.track, d.min, d.label),
      () => setForm(empty),
    );
  }

  return (
    <Panel title="Gates" note="A gate opens a feature to wallets with enough Social or Earned XP.">
      <div className="grid gap-3 md:grid-cols-5">
        <Input
          aria-label="Gate ID"
          placeholder="Gate ID"
          inputMode="numeric"
          value={form.id}
          onChange={(e) => setForm({ ...form, id: e.target.value })}
        />
        <select
          aria-label="Gate track"
          className="h-11 rounded-xl border border-input bg-background/40 px-4 text-sm"
          value={form.track}
          onChange={(e) => setForm({ ...form, track: e.target.value })}
        >
          <option value={TRACK.SOCIAL}>Social XP</option>
          <option value={TRACK.EARNED}>Earned XP</option>
        </select>
        <Input
          aria-label="Minimum XP"
          placeholder="Minimum XP"
          inputMode="numeric"
          value={form.min}
          onChange={(e) => setForm({ ...form, min: e.target.value })}
        />
        <Input
          aria-label="Gate label"
          placeholder="Label"
          value={form.label}
          onChange={(e) => setForm({ ...form, label: e.target.value })}
        />
        <Button onClick={reviewGate} disabled={busy}>
          Review gate
        </Button>
      </div>
      <WriteStatus write={write} />
      {loadError && <LoadError message={loadError} retry={load} />}
      {rows?.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">No gates registered.</p>
      )}
      <ul className="mt-4 grid gap-2">
        {(rows ?? []).map((g) => (
          <li key={g.id} className={rowClass}>
            <span>
              #{g.id} · “{g.label}” · ≥ {g.min} {g.track === TRACK.EARNED ? 'Earned' : 'Social'} XP
            </span>
            <span className="flex items-center gap-2">
              <Badge variant={g.active ? 'success' : 'default'}>
                {g.active ? 'active' : 'disabled'}
              </Badge>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  setForm({
                    id: String(g.id),
                    track: String(g.track),
                    min: String(g.min),
                    label: g.label,
                  })
                }
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant={g.active ? 'destructive' : 'outline'}
                disabled={busy}
                onClick={() =>
                  write.review(gateToggleConsequence(g, !g.active), () =>
                    setGateActive(wallet, g.id, !g.active),
                  )
                }
              >
                {g.active ? 'Disable' : 'Enable'}
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ── Quests ──

function QuestsAdmin({ wallet }: { wallet: Wallet }) {
  const [lookupId, setLookupId] = useState('');
  // The quest shown under the lookup: `null` = no such quest, undefined = nothing looked up.
  // `period` is its repeat period in seconds (0 = one-shot, also on a contract without
  // repeatable quests).
  const [found, setFound] = useState<
    { id: number; quest: QuestConfig | null; period: number } | undefined
  >();
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [form, setForm] = useState({ id: '', schemaId: '', xp: '' });

  const lookup = useCallback(async (id: number) => {
    setLookupError(null);
    try {
      const [quest, periods] = await Promise.all([readQuest(id), getQuestPeriods([id])]);
      setFound({ id, quest, period: periods?.get(id) ?? 0 });
    } catch (e) {
      setFound(undefined);
      setLookupError(adminErrorMessage('quests', e));
    }
  }, []);
  const write = useWrite('quests');

  function onLookup() {
    const id = parseU32(lookupId, 'Quest ID');
    if (!id.ok) return setLookupError(id.error);
    void lookup(id.value);
  }

  async function reviewQuest() {
    const v = validateQuest(form);
    if (!v.ok) return write.reject(v.error);
    const d = v.value;
    let current: QuestConfig | null;
    let period = 0;
    try {
      // new vs replace, and one-shot vs repeating, change the consequence
      const [quest, periods] = await Promise.all([readQuest(d.id), getQuestPeriods([d.id])]);
      current = quest;
      period = periods?.get(d.id) ?? 0;
    } catch (e) {
      return write.reject(adminErrorMessage('quests', e));
    }
    write.review(
      questConsequence(d, current, period),
      () => createQuest(wallet, d.id, d.schemaId, d.xp),
      () => {
        setForm({ id: '', schemaId: '', xp: '' });
        setLookupId(String(d.id));
        void lookup(d.id);
      },
    );
  }

  const q = found?.quest;
  const period = found?.period ?? 0;
  return (
    <Panel
      title="Quests"
      note="The quest registry can’t list its quests yet (#114), so look one up by id."
    >
      <div className="grid gap-3 md:grid-cols-4">
        <Input
          aria-label="Look up quest ID"
          placeholder="Quest ID"
          inputMode="numeric"
          value={lookupId}
          onChange={(e) => setLookupId(e.target.value)}
        />
        <Button variant="outline" onClick={onLookup} disabled={write.busy}>
          Look up
        </Button>
      </div>
      {lookupError && <p className="mt-3 text-sm text-destructive">{lookupError}</p>}
      {found && !q && (
        <p className="mt-3 text-sm text-muted-foreground">Quest {found.id} doesn’t exist yet.</p>
      )}
      {q && (
        <div className={`mt-3 ${rowClass}`}>
          <span>
            #{q.id} · {String(q.xp)} Earned XP · schema {q.schemaId}
          </span>
          <span className="flex items-center gap-2">
            <Badge variant={q.active ? 'success' : 'default'}>
              {q.active ? 'active' : 'disabled'}
            </Badge>
            <Badge variant="default">
              {period === WEEK_SECS
                ? 'weekly'
                : period > 0
                  ? `every ${Math.round(period / 86_400)}d`
                  : 'one-shot'}
            </Badge>
            <Button
              size="sm"
              variant="ghost"
              disabled={write.busy}
              onClick={() => {
                const next = period > 0 ? 0 : WEEK_SECS;
                write.review(
                  questPeriodConsequence(q, next),
                  () => setQuestPeriod(wallet, q.id, next),
                  () => void lookup(q.id),
                );
              }}
            >
              {period > 0 ? 'Make one-shot' : 'Make weekly'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={write.busy}
              onClick={() =>
                setForm({ id: String(q.id), schemaId: String(q.schemaId), xp: String(q.xp) })
              }
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant={q.active ? 'destructive' : 'outline'}
              disabled={write.busy}
              onClick={() =>
                write.review(
                  questToggleConsequence(q, !q.active),
                  () => setQuestActive(wallet, q.id, !q.active),
                  () => void lookup(q.id),
                )
              }
            >
              {q.active ? 'Disable' : 'Enable'}
            </Button>
          </span>
        </div>
      )}
      <div className="mt-6 grid gap-3 md:grid-cols-4">
        <Input
          aria-label="Quest ID"
          placeholder="Quest ID"
          inputMode="numeric"
          value={form.id}
          onChange={(e) => setForm({ ...form, id: e.target.value })}
        />
        <Input
          aria-label="Schema ID"
          placeholder="Schema ID"
          inputMode="numeric"
          value={form.schemaId}
          onChange={(e) => setForm({ ...form, schemaId: e.target.value })}
        />
        <Input
          aria-label="Quest XP"
          placeholder="Earned XP"
          inputMode="numeric"
          value={form.xp}
          onChange={(e) => setForm({ ...form, xp: e.target.value })}
        />
        <Button onClick={reviewQuest} disabled={write.busy}>
          Review quest
        </Button>
      </div>
      <WriteStatus write={write} />
    </Panel>
  );
}
