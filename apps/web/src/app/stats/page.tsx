'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Users, Activity, ExternalLink } from 'lucide-react';
import { shortAddr } from '@alvinmunk/shared';
import { cn } from '@/lib/utils';
import { usePoll } from '@/lib/use-poll';
import type { VouchFunnel } from '@/lib/vouch-funnel';
import { LoopHealth } from '@/components/LoopHealth';

type NetKey = 'testnet' | 'mainnet';

interface Stats {
  network: NetKey;
  configured: boolean;
  users: number;
  target: number;
  latestLedger?: number;
  addresses: string[];
  funnel: VouchFunnel | null;
  funnelError?: string;
  error?: string;
}

const TABS: { key: NetKey; label: string; goal: string }[] = [
  { key: 'testnet', label: 'Testnet', goal: 'Blue belt goal: 50 users' },
  { key: 'mainnet', label: 'Mainnet', goal: 'Black belt goal: 20 users' },
];

function explorer(net: NetKey, addr: string) {
  const seg = net === 'mainnet' ? 'public' : 'testnet';
  // C… are contract / passkey smart-wallet addresses (Stellar Expert path is /contract),
  // G… are classic accounts (/account). Using the wrong one shows "invalid account".
  const kind = addr.startsWith('C') ? 'contract' : 'account';
  return `https://stellar.expert/explorer/${seg}/${kind}/${addr}`;
}

export default function StatsPage() {
  const [tab, setTab] = useState<NetKey>('testnet');
  const [data, setData] = useState<Record<NetKey, Stats | null>>({ testnet: null, mainnet: null });
  // Per-network: true once a poll has failed and we have not yet recovered. The last good
  // `data[tab]` is kept on screen (never cleared on failure) — only the "live"/"stale"
  // marker below reacts, so an outage never masquerades as a fresh zero.
  const [stale, setStale] = useState<Record<NetKey, boolean>>({ testnet: false, mainnet: false });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(!data[tab]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Refresh every 10s while the tab is visible, never overlapping (lib/use-poll.ts). The tab is
  // the poll's key: switching network restarts it with an immediate fetch, and the signal
  // drops the previous network's late response.
  usePoll(
    async (signal) => {
      try {
        const r = await fetch(`/api/stats?network=${tab}`, { cache: 'no-store' });
        if (!r.ok) throw new Error(`stats ${r.status}`);
        const d = (await r.json()) as Stats;
        if (signal.aborted) return;
        setData((prev) => ({ ...prev, [tab]: d }));
        setStale((prev) => ({ ...prev, [tab]: false }));
        setLoading(false);
      } catch (err) {
        if (signal.aborted) return;
        // Keep the last good numbers on a failed poll; only the marker below reacts.
        setStale((prev) => ({ ...prev, [tab]: true }));
        setLoading(false);
        throw err; // so the poll backs off
      }
    },
    30_000, // /api/stats reuses a scan for 30 s (#444), so poll no faster
    tab,
  );

  const s = data[tab];
  const users = s?.users;
  const target = s?.target ?? (tab === 'testnet' ? 50 : 20);
  const pct = users === undefined ? 0 : Math.min(100, Math.round((users / target) * 100));
  const isStale = stale[tab];
  // The testnet tab lists the app's own contracts (NEXT_PUBLIC_* ids, api/stats), the ones
  // /score reads, so its wallets open there. A mainnet wallet would get an unrelated score.
  const inApp = tab === 'testnet';

  return (
    <div className="container max-w-3xl py-12">
      <header className="mb-6">
        <p className="eyebrow mb-2">Live · on-chain</p>
        <h1 className="font-display text-3xl font-semibold">Network stats</h1>
        <p className="mt-2 max-w-prose text-sm text-muted-foreground text-balance">
          Unique wallets that have interacted with the alvinmunk contracts, read straight from
          Soroban RPC. It grows as people onboard. Testnet and mainnet are separate goals.
        </p>
      </header>

      {/* tabs */}
      <div className="mb-6 inline-flex gap-1 rounded-full border border-border/60 bg-surface/40 p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'rounded-full px-5 py-2 text-sm font-medium transition-colors',
              tab === t.key ? 'bg-primary/20 text-foreground ring-1 ring-inset ring-primary/30' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* headline count + progress */}
      <div className="glass rounded-3xl p-7">
        {s && !s.configured ? (
          <div className="py-8 text-center">
            <p className="font-display text-2xl font-semibold text-muted-foreground">Launching on mainnet</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Mainnet goes live at the Black belt. The counter turns on the moment the contracts deploy.
            </p>
            <p className="mt-4 font-display text-4xl font-semibold text-muted-foreground">0 / {target}</p>
          </div>
        ) : (
          <>
            <div className="flex items-end justify-between gap-4">
              <div className="flex items-center gap-3">
                <Users className="size-6 text-primary" />
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Wallets on-chain</p>
                  <p className="font-display text-5xl font-semibold tabular-nums">
                    {users === undefined ? '—' : users}
                  </p>
                </div>
              </div>
              <p className="font-display text-2xl font-semibold text-muted-foreground">
                {users === undefined ? '—' : users} <span className="text-muted-foreground">/ {target}</span>
              </p>
            </div>

            {/* progress bar */}
            <div className="mt-5 h-3 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="flow h-full rounded-full transition-all duration-700"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {users === undefined ? '—' : pct}% toward {TABS.find((t) => t.key === tab)?.goal}
              {s?.latestLedger ? ` · ledger ${s.latestLedger}` : ''}
              <span className={cn('ml-2 inline-flex items-center gap-1', isStale ? 'text-amber-400/90' : 'text-secondary/80')} title={isStale ? 'Sync delayed' : 'Live'}>
                <Activity className="size-3" /> {isStale ? 'stale' : 'live'}
              </span>
            </p>
          </>
        )}
      </div>

      {/* contract-backed claim funnel (hidden where the contracts are not live yet) */}
      {(!s || s.configured) && (
        <LoopHealth
          funnel={s?.funnel}
          loading={loading && !s}
          error={s ? s.funnelError : isStale ? 'Stats could not be loaded. Retrying…' : undefined}
        />
      )}

      {/* wallet list */}
      {s?.configured && s.addresses.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Wallets ({s.addresses.length})
          </h2>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {s.addresses.map((a) =>
              inApp ? (
                <div
                  key={a}
                  className="flex items-center rounded-xl border border-border/50 bg-surface/30 font-mono text-xs transition-colors focus-within:border-border hover:border-border hover:bg-surface/60"
                >
                  <Link
                    href={`/score/${a}`}
                    aria-label={`Score for ${shortAddr(a, 6, 6)}`}
                    className="flex-1 rounded-l-xl px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                  >
                    {shortAddr(a, 6, 6)}
                  </Link>
                  <a
                    href={explorer(tab, a)}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`${shortAddr(a, 6, 6)} on stellar.expert (opens in a new tab)`}
                    title="stellar.expert"
                    className="rounded-r-xl px-3 py-2 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                  >
                    <ExternalLink className="size-3.5" />
                  </a>
                </div>
              ) : (
                <a
                  key={a}
                  href={explorer(tab, a)}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex items-center justify-between rounded-xl border border-border/50 bg-surface/30 px-3 py-2 font-mono text-xs transition-colors hover:border-border hover:bg-surface/60"
                >
                  <span>{shortAddr(a, 6, 6)}</span>
                  <ExternalLink className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </a>
              ),
            )}
          </div>
        </div>
      )}
    </div>
  );
}
