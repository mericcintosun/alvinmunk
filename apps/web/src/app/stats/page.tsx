'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Users, Activity, ExternalLink } from 'lucide-react';
import { shortAddr } from '@alvinmunk/shared';
import { cn } from '@/lib/utils';
import { usePoll } from '@/lib/use-poll';
import type { VouchFunnel } from '@/lib/vouch-funnel';
import { LoopHealth } from '@/components/LoopHealth';
import { useFormat } from '@/lib/i18n';
import { useTranslations } from '@/lib/i18n';

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

const TABS: { key: NetKey; label: string }[] = [
  { key: 'testnet', label: 'Testnet' },
  { key: 'mainnet', label: 'Mainnet' },
];

function explorer(net: NetKey, addr: string) {
  const seg = net === 'mainnet' ? 'public' : 'testnet';
  // C… are contract / passkey smart-wallet addresses (Stellar Expert path is /contract),
  // G… are classic accounts (/account). Using the wrong one shows "invalid account".
  const kind = addr.startsWith('C') ? 'contract' : 'account';
  return `https://stellar.expert/explorer/${seg}/${kind}/${addr}`;
}

export default function StatsPage() {
  const format = useFormat();
  const t = useTranslations();
  const [debug, setDebug] = useState(false);
  const [tab, setTab] = useState<NetKey>('testnet');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setDebug(params.get('debug') === 'true');
  }, []);
  const [data, setData] = useState<Record<NetKey, Stats | null>>({ testnet: null, mainnet: null });
  // Per-network: true once a poll has failed and we have not yet recovered. The last good
  // `data[tab]` is kept on screen (never cleared on failure) — only the "Live"/"Stale"
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
        <p className="eyebrow mb-2">{t('stats.header.liveOnChain')}</p>
        <h1 className="font-display text-3xl font-semibold">{t('stats.header.title')}</h1>
        <p className="mt-2 max-w-prose text-sm text-muted-foreground text-balance">
          {t('stats.header.description')}
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
            <p className="font-display text-2xl font-semibold text-muted-foreground">{t('stats.mainnet.launching')}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {t('stats.mainnet.counterTurnsOn')}
            </p>
            <p className="mt-4 font-display text-4xl font-semibold text-muted-foreground">
              0 / {format.number(target)}
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-end justify-between gap-4">
              <div className="flex items-center gap-3">
                <Users className="size-6 text-primary" />
                <div>
                  <p className="text-xs font-medium text-muted-foreground">{t('stats.walletsOnChain')}</p>
                  <p className="font-display text-5xl font-semibold tabular-nums">
                    {users === undefined ? '—' : format.number(users)}
                  </p>
                </div>
              </div>
            </div>

            {/* progress bar */}
            <div className="mt-5 h-3 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="flow h-full rounded-full transition-all duration-700"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {users === undefined ? '—' : pct}% {t('stats.towardGoal', { target: format.number(target) })}
              {s?.latestLedger ? ` · {t('stats.ledger', { ledger: s.latestLedger })}` : ''}
              <span className={cn('ml-2 inline-flex items-center gap-1', isStale ? 'text-warning' : 'text-secondary')} title={isStale ? t('stats.syncDelayed') : t('stats.live')}>
                <Activity className="size-3" /> {isStale ? t('stats.stale') : t('stats.live')}
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
          error={s ? s.funnelError : isStale ? t('stats.couldNotLoad') : undefined}
          debug={debug}
        />
      )}

      {/* wallet list */}
      {s?.configured && s.addresses.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Wallets ({format.number(s.addresses.length)})
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
                    className="flex-1 rounded-l-xl px-3 py-2"
                  >
                    {shortAddr(a, 6, 6)}
                  </Link>
                  <a
                    href={explorer(tab, a)}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`${shortAddr(a, 6, 6)} on stellar.expert (opens in a new tab)`}
                    title="stellar.expert"
                    className="rounded-r-xl px-3 py-2 text-muted-foreground transition-colors hover:text-foreground"
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
