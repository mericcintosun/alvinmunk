'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWallet } from '@/components/wallet/wallet-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  getAllRewards,
  addReward,
  setRewardActive,
  stroopsToUsdc,
  usdcToStroops,
  type RewardEntry,
} from '@/lib/rewards';
import { createGate, getGates, setGateActive, TRACK, type Gate } from '@/lib/gate';
import { createQuest, setQuestActive, type AdminQuest } from '@/lib/quests';
import { isConfiguredAdmin } from '@/lib/admin';
import { txExplorerUrl } from '@/lib/stellar';

type Section = 'rewards' | 'gates' | 'quests';

function positiveInteger(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function TxReceipt({ hash }: { hash: string | null }) {
  if (!hash) return null;
  return (
    <p className="mt-3 text-xs text-secondary">
      Confirmed on-chain:{' '}
      <a className="underline" href={txExplorerUrl(hash)} target="_blank" rel="noreferrer">
        view transaction
      </a>
    </p>
  );
}

export default function AdminPage() {
  const { profile, wallet } = useWallet();
  const [section, setSection] = useState<Section>('rewards');

  // No configured admin address means the route is intentionally inert. On-chain
  // contracts remain the final authorization boundary for every write.
  if (
    !profile ||
    !isConfiguredAdmin(profile.address) ||
    (wallet && wallet.address !== profile.address)
  )
    return null;

  return (
    <main className="mx-auto max-w-6xl px-5 py-12">
      <div className="mb-8">
        <p className="text-xs uppercase tracking-[0.25em] text-secondary">admin // content</p>
        <h1 className="mt-2 text-3xl font-semibold">Content</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Create and toggle the on-chain quests, rewards, and gates. Every write requires a
          confirmation and reports its transaction.
        </p>
      </div>
      <nav className="mb-6 flex gap-2" aria-label="Content sections">
        {(['rewards', 'gates', 'quests'] as Section[]).map((item) => (
          <Button
            key={item}
            size="sm"
            variant={section === item ? 'primary' : 'outline'}
            onClick={() => setSection(item)}
          >
            {item[0].toUpperCase() + item.slice(1)}
          </Button>
        ))}
      </nav>
      {section === 'rewards' && <RewardsAdmin />}
      {section === 'gates' && <GatesAdmin />}
      {section === 'quests' && <QuestsAdmin />}
    </main>
  );
}

function useAdminAction() {
  const { wallet, profile, connect } = useWallet();
  const [busy, setBusy] = useState(false);
  const [hash, setHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (consequence: string, action: (admin: NonNullable<typeof wallet>) => Promise<string>) => {
      if (!window.confirm(consequence)) return null;
      setBusy(true);
      setHash(null);
      setError(null);
      try {
        const admin = wallet ?? (await connect());
        if (!profile || admin.address !== profile.address) {
          throw new Error('The connected wallet does not match the configured admin wallet.');
        }
        const nextHash = await action(admin);
        setHash(nextHash || null);
        return nextHash;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'The transaction was rejected.');
        return null;
      } finally {
        setBusy(false);
      }
    },
    [connect, profile, wallet],
  );

  return { busy, hash, error, run };
}

function Feedback({ hash, error }: { hash: string | null; error: string | null }) {
  return (
    <>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      <TxReceipt hash={hash} />
    </>
  );
}

function RewardsAdmin() {
  const { profile } = useWallet();
  const [rows, setRows] = useState<RewardEntry[]>([]);
  const [id, setId] = useState('');
  const [threshold, setThreshold] = useState('');
  const [amount, setAmount] = useState('');
  const action = useAdminAction();

  const refresh = useCallback(
    () =>
      profile
        ? void getAllRewards(profile.address)
            .then(setRows)
            .catch(() => setRows([]))
        : undefined,
    [profile],
  );
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function save() {
    const rewardId = positiveInteger(id);
    const xp = positiveInteger(threshold);
    let stroops: bigint;
    try {
      stroops = usdcToStroops(amount);
    } catch {
      stroops = 0n;
    }
    if (rewardId === null || xp === null || stroops <= 0n) return;
    const hash = await action.run(
      `Reward ${rewardId} will pay ${amount} USDC to wallets with at least ${xp} Earned XP. Continue?`,
      (wallet) => addReward(wallet, rewardId, xp, stroops),
    );
    if (hash) {
      setId('');
      setThreshold('');
      setAmount('');
      refresh();
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-card/40 p-5">
      <h2 className="text-lg font-semibold">Rewards</h2>
      <p className="mb-4 mt-1 text-sm text-muted-foreground">
        Thresholds use Earned XP; amounts use USDC.
      </p>
      <div className="grid gap-3 md:grid-cols-4">
        <Input
          aria-label="Reward ID"
          placeholder="Reward ID"
          value={id}
          onChange={(e) => setId(e.target.value)}
          inputMode="numeric"
        />
        <Input
          aria-label="Earned XP threshold"
          placeholder="Earned XP"
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
          inputMode="numeric"
        />
        <Input
          aria-label="USDC amount"
          placeholder="USDC amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
        />
        <Button onClick={save} disabled={action.busy}>
          Add or update reward
        </Button>
      </div>
      <ul className="mt-6 space-y-2">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex items-center justify-between rounded-xl border border-border px-4 py-3 text-sm"
          >
            <span>
              #{row.id} · {Number(row.threshold)} XP → {stroopsToUsdc(row.amount)} USDC
            </span>
            <Button
              size="sm"
              variant={row.active ? 'destructive' : 'outline'}
              disabled={action.busy}
              onClick={async () => {
                const hash = await action.run(
                  `Reward ${row.id} will be ${row.active ? 'disabled' : 'enabled'} for claims. Continue?`,
                  (wallet) => setRewardActive(wallet, row.id, !row.active),
                );
                if (hash) refresh();
              }}
            >
              {row.active ? 'Disable' : 'Enable'}
            </Button>
          </li>
        ))}
      </ul>
      {rows.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">No rewards registered.</p>
      )}
      <Feedback hash={action.hash} error={action.error} />
    </section>
  );
}

function GatesAdmin() {
  const [rows, setRows] = useState<Gate[]>([]);
  const [id, setId] = useState('');
  const [track, setTrack] = useState(String(TRACK.EARNED));
  const [min, setMin] = useState('');
  const [label, setLabel] = useState('');
  const action = useAdminAction();
  const refresh = useCallback(() => void getGates().then(setRows), []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function save() {
    const gateId = positiveInteger(id);
    const minimum = positiveInteger(min);
    const gateTrack = Number(track);
    if (
      gateId === null ||
      minimum === null ||
      !label.trim() ||
      ![TRACK.SOCIAL, TRACK.EARNED].includes(gateTrack as 0 | 1)
    )
      return;
    const hash = await action.run(
      `Gate ${gateId} will require ${gateTrack === TRACK.EARNED ? 'Earned' : 'Social'} XP ≥ ${minimum} (${label.trim()}). Continue?`,
      (wallet) => createGate(wallet, gateId, gateTrack, minimum, label.trim()),
    );
    if (hash) {
      setId('');
      setMin('');
      setLabel('');
      refresh();
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-card/40 p-5">
      <h2 className="text-lg font-semibold">Gates</h2>
      <div className="grid gap-3 md:grid-cols-5">
        <Input
          aria-label="Gate ID"
          placeholder="Gate ID"
          value={id}
          onChange={(e) => setId(e.target.value)}
          inputMode="numeric"
        />
        <select
          aria-label="Gate track"
          className="h-11 rounded-xl border border-input bg-background/40 px-4 text-sm"
          value={track}
          onChange={(e) => setTrack(e.target.value)}
        >
          <option value={TRACK.SOCIAL}>Social XP</option>
          <option value={TRACK.EARNED}>Earned XP</option>
        </select>
        <Input
          aria-label="Minimum XP"
          placeholder="Minimum XP"
          value={min}
          onChange={(e) => setMin(e.target.value)}
          inputMode="numeric"
        />
        <Input
          aria-label="Gate label"
          placeholder="Label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <Button onClick={save} disabled={action.busy}>
          Create gate
        </Button>
      </div>
      <ul className="mt-6 space-y-2">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex items-center justify-between rounded-xl border border-border px-4 py-3 text-sm"
          >
            <span>
              #{row.id} · {row.label} · {row.min} XP
            </span>
            <Button
              size="sm"
              variant={row.active ? 'destructive' : 'outline'}
              disabled={action.busy}
              onClick={async () => {
                const hash = await action.run(
                  `Gate ${row.id} will be ${row.active ? 'disabled' : 'enabled'} for access checks. Continue?`,
                  (wallet) => setGateActive(wallet, row.id, !row.active),
                );
                if (hash) refresh();
              }}
            >
              {row.active ? 'Disable' : 'Enable'}
            </Button>
          </li>
        ))}
      </ul>
      {rows.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">No gates registered.</p>
      )}
      <Feedback hash={action.hash} error={action.error} />
    </section>
  );
}

function QuestsAdmin() {
  const [rows, setRows] = useState<AdminQuest[]>([]);
  const [id, setId] = useState('');
  const [schemaId, setSchemaId] = useState('');
  const [xp, setXp] = useState('');
  const action = useAdminAction();

  async function save() {
    const questId = positiveInteger(id);
    const schema = positiveInteger(schemaId);
    const points = positiveInteger(xp);
    if (questId === null || schema === null || points === null) return;
    const hash = await action.run(
      `Quest ${questId} will award ${points} XP using schema ${schema}. Continue?`,
      (wallet) => createQuest(wallet, questId, schema, points),
    );
    if (hash) {
      setRows((current) => [
        ...current.filter((row) => row.id !== questId),
        { id: questId, schemaId: schema, xp: points, active: true },
      ]);
      setId('');
      setSchemaId('');
      setXp('');
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-card/40 p-5">
      <h2 className="text-lg font-semibold">Quests</h2>
      <p className="mb-4 mt-1 text-sm text-muted-foreground">
        The current QuestRegistry has no list getter, so this view tracks quests created in this
        session.
      </p>
      <div className="grid gap-3 md:grid-cols-4">
        <Input
          aria-label="Quest ID"
          placeholder="Quest ID"
          value={id}
          onChange={(e) => setId(e.target.value)}
          inputMode="numeric"
        />
        <Input
          aria-label="Schema ID"
          placeholder="Schema ID"
          value={schemaId}
          onChange={(e) => setSchemaId(e.target.value)}
        />
        <Input
          aria-label="Quest XP"
          placeholder="XP"
          value={xp}
          onChange={(e) => setXp(e.target.value)}
          inputMode="numeric"
        />
        <Button onClick={save} disabled={action.busy}>
          Create quest
        </Button>
      </div>
      <ul className="mt-6 space-y-2">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex items-center justify-between rounded-xl border border-border px-4 py-3 text-sm"
          >
            <span>
              #{row.id} · {row.xp} XP · {row.schemaId}
            </span>
            <Button
              size="sm"
              variant={row.active ? 'destructive' : 'outline'}
              disabled={action.busy}
              onClick={async () => {
                const hash = await action.run(
                  `Quest ${row.id} will be ${row.active ? 'disabled' : 'enabled'} for completion. Continue?`,
                  (wallet) => setQuestActive(wallet, row.id, !row.active),
                );
                if (hash)
                  setRows((current) =>
                    current.map((item) =>
                      item.id === row.id ? { ...item, active: !item.active } : item,
                    ),
                  );
              }}
            >
              {row.active ? 'Disable' : 'Enable'}
            </Button>
          </li>
        ))}
      </ul>
      {rows.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">No quests created in this session.</p>
      )}
      <Feedback hash={action.hash} error={action.error} />
    </section>
  );
}
