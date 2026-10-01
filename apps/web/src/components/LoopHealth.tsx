import React from 'react';
import type { VouchFunnel } from '@/lib/vouch-funnel';
import { cn } from '@/lib/utils';
import { useFormat } from '@/lib/i18n';

/** The PMF gate: a minted half-card has to be claimed at least this often (PRODUCT_MARKET_FIT.md). */
export const GATE = 0.4;

const pct = (r: number) => `${(r * 100).toFixed(1)}%`;
const GATE_LABEL = `${Math.round(GATE * 100)}%`;

interface Props {
  funnel: VouchFunnel | null | undefined;
  /** why the funnel (or the whole stats read) failed */
  error?: string;
  /** true until the first response for this network arrives */
  loading: boolean;
}

/** "Loop health" on /stats — the vouch claim-completion funnel, read from contract state. */
export function LoopHealth({ funnel, error, loading }: Props) {
  const format = useFormat();
  const gated = funnel && funnel.minted > 0;
  return (
    <section className="mt-8" aria-busy={loading}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow mb-1">PMF gate · {GATE_LABEL}</p>
          <h2 className="font-display text-2xl font-semibold">Loop health</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every half-card, read from the reputation contract&apos;s storage (not the short RPC
            event window). Cohorts are by mint week (Monday, UTC).
          </p>
        </div>
        {gated && (
          <span
            className={cn(
              'rounded-full px-3 py-1 text-xs font-semibold',
              funnel.completionRate >= GATE ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
            )}
          >
            {funnel.completionRate >= GATE ? 'Gate reached' : 'Below gate'}
          </span>
        )}
      </div>

      {funnel ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Tile label="Minted" value={format.number(funnel.minted)} hint={`${format.number(funnel.open)} still open`} />
            <Tile label="Claimed" value={format.number(funnel.claimed)} />
            <Tile label="Completion" value={pct(funnel.completionRate)} hint={`Target: ${GATE_LABEL}`} />
            <Tile
              label="Expired unclaimed"
              value={format.number(funnel.expiredUnclaimed)}
              hint={pct(funnel.expiredRate)}
            />
            <Tile label="Distinct vouchers" value={format.number(funnel.distinctVouchers)} />
            <Tile label="Repeat-pair share" value={pct(funnel.repeatPairShare)} hint="claims of a pair already claimed" />
          </div>
          <div className="mt-5 overflow-x-auto rounded-2xl border border-border/50">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="bg-surface/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Mint week</th>
                  <th className="px-4 py-3">Minted</th>
                  <th className="px-4 py-3">Claimed</th>
                  <th className="px-4 py-3">Open</th>
                  <th className="px-4 py-3">Expired</th>
                  <th className="px-4 py-3">Completion</th>
                </tr>
              </thead>
              <tbody>
                {funnel.weeklyCohorts.map((c) => (
                  <tr key={c.week} className="border-t border-border/40">
                    <td className="px-4 py-3 font-mono text-xs">{c.week}</td>
                    <td className="px-4 py-3 tabular-nums">{format.number(c.minted)}</td>
                    <td className="px-4 py-3 tabular-nums">{format.number(c.claimed)}</td>
                    <td className="px-4 py-3 tabular-nums">{format.number(c.open)}</td>
                    <td className="px-4 py-3 tabular-nums">{format.number(c.expiredUnclaimed)}</td>
                    <td
                      className={cn(
                        'px-4 py-3 font-semibold tabular-nums',
                        c.completionRate >= GATE ? 'text-primary' : 'text-muted-foreground',
                      )}
                    >
                      {pct(c.completionRate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {funnel.weeklyCohorts.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">No vouches yet.</p>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Open half-cards can still be claimed, so the newest week&apos;s completion is not final.
            {funnel.unread > 0 &&
              ` Not counted: ${format.number(funnel.unread)} half-card${funnel.unread === 1 ? '' : 's'} whose contract state could not be read (archived, or past the read cap).`}
          </p>
        </>
      ) : loading ? (
        <p className="rounded-2xl border border-border/50 p-4 text-sm text-muted-foreground">Reading vouch state…</p>
      ) : (
        <p role={error ? 'alert' : undefined} className="rounded-2xl border border-border/50 p-4 text-sm text-muted-foreground">
          {error ?? 'The reputation contract is not configured for this network.'}
        </p>
      )}
    </section>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="glass rounded-2xl p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
