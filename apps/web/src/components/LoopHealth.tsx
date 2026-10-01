import React from 'react';
import type { VouchFunnel } from '@/lib/vouch-funnel';
import { cn } from '@/lib/utils';
import { useFormat } from '@/lib/i18n';
import { useTranslations } from '@/lib/i18n';

/** The PMF gate: a minted half-card has to be claimed at least this often (PRODUCT_MARKET_FIT.md). */
export const GATE = 0.4;

const pct = (r: number) => `${(r * 100).toFixed(1)}%`;

interface Props {
  funnel: VouchFunnel | null | undefined;
  /** why the funnel (or the whole stats read) failed */
  error?: string;
  /** true until the first response for this network arrives */
  loading: boolean;
  /** show internal PMF gate and cohort details */
  debug?: boolean;
}

/** "Loop health" on /stats — the vouch claim-completion funnel, read from contract state. */
export function LoopHealth({ funnel, error, loading, debug = false }: Props) {
  const format = useFormat();
  const t = useTranslations();
  const gated = funnel && funnel.minted > 0;
  const GATE_LABEL = `${Math.round(GATE * 100)}%`;

  return (
    <section className="mt-8" aria-busy={loading}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          {debug && <p className="eyebrow mb-1">{t('stats.loopHealth.pmfGate', { gate: GATE_LABEL })}</p>}
          <h2 className="font-display text-2xl font-semibold">{t('stats.loopHealth.title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('stats.loopHealth.description')}
          </p>
        </div>
        {debug && gated && (
          <span
            className={cn(
              'rounded-full px-3 py-1 text-xs font-semibold',
              funnel.completionRate >= GATE ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
            )}
          >
            {funnel.completionRate >= GATE ? t('stats.loopHealth.gateReached') : t('stats.loopHealth.belowGate')}
          </span>
        )}
      </div>

      {funnel ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Tile label={t('stats.loopHealth.minted')} value={format.number(funnel.minted)} hint={t('stats.loopHealth.stillOpen', { count: format.number(funnel.open) })} />
            <Tile label={t('stats.loopHealth.claimed')} value={format.number(funnel.claimed)} />
            <Tile label={t('stats.loopHealth.completion')} value={pct(funnel.completionRate)} hint={debug ? t('stats.loopHealth.target', { gate: GATE_LABEL }) : undefined} />
            <Tile
              label={t('stats.loopHealth.expiredUnclaimed')}
              value={format.number(funnel.expiredUnclaimed)}
              hint={pct(funnel.expiredRate)}
            />
            <Tile label={t('stats.loopHealth.distinctVouchers')} value={format.number(funnel.distinctVouchers)} />
            <Tile label={t('stats.loopHealth.repeatPairShare')} value={pct(funnel.repeatPairShare)} hint={t('stats.loopHealth.repeatPairShareHint')} />
          </div>
          {debug && (
            <div className="mt-5 overflow-x-auto rounded-2xl border border-border/50">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="bg-surface/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">{t('stats.loopHealth.mintWeek')}</th>
                    <th className="px-4 py-3">{t('stats.loopHealth.minted')}</th>
                    <th className="px-4 py-3">{t('stats.loopHealth.claimed')}</th>
                    <th className="px-4 py-3">{t('stats.loopHealth.open')}</th>
                    <th className="px-4 py-3">{t('stats.loopHealth.expired')}</th>
                    <th className="px-4 py-3">{t('stats.loopHealth.completion')}</th>
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
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t('stats.loopHealth.noVouchesYet')}</p>
              )}
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            {t('stats.loopHealth.openHalfCardsNote')}
            {funnel.unread > 0 &&
              ` {t('stats.loopHealth.unreadNote', { count: format.number(funnel.unread) })}`}
          </p>
        </>
      ) : loading ? (
        <p className="rounded-2xl border border-border/50 p-4 text-sm text-muted-foreground">{t('stats.loopHealth.reading')}</p>
      ) : (
        <p role={error ? 'alert' : undefined} className="rounded-2xl border border-border/50 p-4 text-sm text-muted-foreground">
          {error ?? t('stats.loopHealth.notConfigured')}
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
