'use client';

import { useEffect, useState } from 'react';
import { Users, Activity, ExternalLink } from 'lucide-react';
import { shortAddress } from '@/lib/utils';
import { cn } from '@/lib/utils';
import type { VouchFunnel } from '@/lib/vouch-funnel';

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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch(`/api/stats?network=${tab}`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((d: Stats) => {
          if (alive) {
            setData((prev) => ({ ...prev, [tab]: d }));
            setLoading(false);
          }
        })
        .catch(() => alive && setLoading(false));
    };
    setLoading(!data[tab]);
    load();
    const t = setInterval(load, 10000); // live: refresh every 10s
    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const s = data[tab];
  const users = s?.users ?? 0;
  const target = s?.target ?? (tab === 'testnet' ? 50 : 20);
  const pct = Math.min(100, Math.round((users / target) * 100));

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
            <p className="mt-4 font-display text-4xl font-semibold text-muted-foreground/50">0 / {target}</p>
          </div>
        ) : (
          <>
            <div className="flex items-end justify-between gap-4">
              <div className="flex items-center gap-3">
                <Users className="size-6 text-primary" />
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Wallets on-chain</p>
                  <p className="font-display text-5xl font-semibold tabular-nums">
                    {loading && !s ? '—' : users}
                  </p>
                </div>
              </div>
              <p className="font-display text-2xl font-semibold text-muted-foreground">
                {users} <span className="text-muted-foreground/50">/ {target}</span>
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
              {pct}% toward {TABS.find((t) => t.key === tab)?.goal}
              {s?.latestLedger ? ` · ledger ${s.latestLedger}` : ''}
              <span className="ml-2 inline-flex items-center gap-1 text-secondary/80">
                <Activity className="size-3" /> live
              </span>
            </p>
          </>
        )}
      </div>

      {/* contract-backed claim funnel */}
      {s?.configured && (
        <section className="mt-8">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="eyebrow mb-1">PMF gate · 40%</p>
              <h2 className="font-display text-2xl font-semibold">Loop health</h2>
              <p className="mt-1 text-sm text-muted-foreground">Vouch state read from contract storage; cohorts use mint week (UTC).</p>
            </div>
            {s.funnel && (
              <span className={cn('rounded-full px-3 py-1 text-xs font-semibold', s.funnel.completionRate >= 0.4 ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground')}>
                {s.funnel.completionRate >= 0.4 ? 'Gate reached' : 'Below gate'}
              </span>
            )}
          </div>
          {s.funnel ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ['Minted', s.funnel.minted.toLocaleString()],
                  ['Claimed', s.funnel.claimed.toLocaleString()],
                  ['Completion', `${(s.funnel.completionRate * 100).toFixed(1)}%`],
                  ['Expired unclaimed', s.funnel.expiredUnclaimed.toLocaleString()],
                  ['Distinct vouchers', s.funnel.distinctVouchers.toLocaleString()],
                  ['Repeat-pair share', `${(s.funnel.repeatPairShare * 100).toFixed(1)}%`],
                ].map(([label, value]) => (
                  <div key={label} className="glass rounded-2xl p-4">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="mt-1 font-display text-2xl font-semibold tabular-nums">{value}</p>
                    {label === 'Completion' && <p className="mt-1 text-xs text-muted-foreground">Target: 40%</p>}
                  </div>
                ))}
              </div>
              <div className="mt-5 overflow-x-auto rounded-2xl border border-border/50">
                <table className="w-full min-w-[600px] text-left text-sm">
                  <thead className="bg-surface/50 text-xs text-muted-foreground">
                    <tr><th className="px-4 py-3">Mint week</th><th className="px-4 py-3">Minted</th><th className="px-4 py-3">Claimed</th><th className="px-4 py-3">Completion</th><th className="px-4 py-3">Expired unclaimed</th></tr>
                  </thead>
                  <tbody>
                    {s.funnel.weeklyCohorts.map((cohort) => (
                      <tr key={cohort.week} className="border-t border-border/40">
                        <td className="px-4 py-3 font-mono text-xs">{cohort.week}</td>
                        <td className="px-4 py-3 tabular-nums">{cohort.minted}</td>
                        <td className="px-4 py-3 tabular-nums">{cohort.claimed}</td>
                        <td className={cn('px-4 py-3 font-semibold tabular-nums', cohort.completionRate >= 0.4 ? 'text-primary' : 'text-muted-foreground')}>{(cohort.completionRate * 100).toFixed(1)}%</td>
                        <td className="px-4 py-3 tabular-nums">{cohort.expiredUnclaimed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {s.funnel.weeklyCohorts.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">No vouches yet.</p>}
              </div>
            </>
          ) : (
            <p className="rounded-2xl border border-border/50 p-4 text-sm text-muted-foreground">Vouch funnel unavailable{s.funnelError ? `: ${s.funnelError}` : ' for this network'}.</p>
          )}
        </section>
      )}

      {/* wallet list */}
      {s?.configured && s.addresses.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Wallets ({s.addresses.length})
          </h2>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {s.addresses.map((a) => (
              <a
                key={a}
                href={explorer(tab, a)}
                target="_blank"
                rel="noreferrer"
                className="group flex items-center justify-between rounded-xl border border-border/50 bg-surface/30 px-3 py-2 font-mono text-xs transition-colors hover:border-border hover:bg-surface/60"
              >
                <span>{shortAddress(a, 6, 6)}</span>
                <ExternalLink className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
