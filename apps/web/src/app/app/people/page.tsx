'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { Search, Star, Users, ArrowRight, Sparkles, UserPlus } from 'lucide-react';
import { resolveHandle, reverseHandles } from '@/lib/registry';
import { getScores } from '@/lib/reputation';
import { fetchReputationEvents } from '@/lib/events';
import { suggestPeople, type Suggestion } from '@/lib/constellation';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { StateArt } from '@/components/ui/state-art';
import { Frame } from '@/components/fx/frame';
import { useWallet } from '@/components/wallet/wallet-provider';
import { useTranslations, type TFn } from '@/lib/i18n';
import { cn } from '@/lib/utils';

type SearchResult = {
  handle: string;
  address: string;
  social: number;
  earned: number;
} | null;

type SearchState = 'idle' | 'loading' | 'found' | 'not-found' | 'error';

/** Max suggestion cards shown in the idle panel. */
const MAX_SUGGESTIONS = 6;

/**
 * People discovery — type a @handle to surface the profile with a vouch shortcut.
 * Registry forward-lookup resolves handle → address, then contract reads pull
 * both XP tracks so the result card shows the full public portrait.
 *
 * When idle, shows up to six second-degree "people you might know" cards derived
 * from on-chain vouch:claimed events — no separate indexer needed.
 */
export default function PeoplePage() {
  const { profile } = useWallet();
  const t = useTranslations();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchResult>(null);
  const [state, setState] = useState<SearchState>('idle');
  const [searched, setSearched] = useState('');

  // Suggestions state
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  // Load suggestions once we know who we are. `alive` is a per-run local (not a ref
  // shared across effect runs) so a stale fetch from a previous address can never
  // overwrite the current one's results — see the debounce pattern in lib/i18n
  // consumers like landing-onboard.tsx.
  useEffect(() => {
    if (!profile?.address) return;
    let alive = true;

    setSuggestionsLoading(true);
    const myAddress = profile.address;

    fetchReputationEvents()
      .then(async (events) => {
        if (!alive) return;

        const raw = suggestPeople(myAddress, events, MAX_SUGGESTIONS);
        if (raw.length === 0) {
          setSuggestions([]);
          setSuggestionsLoading(false);
          return;
        }

        // Batch-resolve handles for all suggested addresses
        const addrs = raw.map((s) => s.address);
        const handleMap = await reverseHandles(addrs).catch(() => ({} as Record<string, string | null>));
        if (!alive) return;

        setSuggestions(raw.map((s) => ({ ...s, handle: handleMap[s.address] ?? null })));
        setSuggestionsLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setSuggestions([]);
        setSuggestionsLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [profile?.address]);

  const search = useCallback(async (term: string) => {
    const h = term.trim().toLowerCase().replace(/^@/, '');
    if (!h) return;

    setSearched(h);
    setState('loading');
    setResult(null);

    try {
      const address = await resolveHandle(h);
      if (!address) {
        setState('not-found');
        return;
      }
      const scores = await getScores(address);
      setResult({ handle: h, address, ...scores });
      setState('found');
    } catch {
      setState('error');
    }
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void search(query);
  }

  return (
    <div className="grid gap-6">
      <header>
        <h1 className="font-display text-2xl font-semibold">Find people</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground text-balance">
          Search by @handle to find someone&apos;s constellation and vouch for them.
        </p>
      </header>

      {/* Search */}
      <form onSubmit={handleSubmit} className="relative">
        <Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by @handle…"
          className="h-12 pl-11 pr-24 font-mono"
          aria-label="Search users by handle"
        />
        <Button
          type="submit"
          variant="flow"
          size="sm"
          disabled={state === 'loading' || query.trim().length === 0}
          className="absolute right-2 top-1/2 -translate-y-1/2"
        >
          {state === 'loading' ? 'Searching…' : 'Find'}
        </Button>
      </form>

      {/* Results / Suggestions */}
      <Frame label={searched ? `search // @${searched}` : 'search // people'} index="01" tape="tl">
        <div className="p-5">
          {state === 'loading' && (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-4 w-3/4 rounded" />
            </div>
          )}

          {state === 'idle' && (
            <SuggestionPanel
              suggestions={suggestions}
              loading={suggestionsLoading}
              t={t}
            />
          )}

          {state === 'not-found' && (
            <div className="flex flex-col items-center gap-4 py-10 text-center">
              <StateArt kind="empty-leaderboard" size={200} className="opacity-50" />
              <div className="space-y-1">
                <p className="font-display text-sm font-medium text-muted-foreground">
                  No one goes by @{searched}
                </p>
                <p className="text-xs text-muted-foreground">
                  That handle isn&apos;t claimed yet — maybe they haven&apos;t joined. Try another.
                </p>
              </div>
            </div>
          )}

          {state === 'error' && (
            <div className="flex flex-col items-center gap-4 py-10 text-center">
              <p className="text-sm text-destructive">Something went wrong — try again in a moment.</p>
            </div>
          )}

          {state === 'found' && result && (
            <div className="space-y-4">
              {/* Result card */}
              <div className="flex items-center gap-4 rounded-xl border border-border/60 bg-surface/40 p-4">
                <Avatar
                  address={result.address}
                  handle={result.handle}
                  size={56}
                  ring
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-lg font-semibold">
                    @{result.handle}
                  </p>
                  <div className="mt-1.5 flex items-center gap-4 font-mono text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Star className={cn('size-3.5', result.social > 0 ? 'text-accent' : 'text-muted-foreground/40')} />
                      {result.social} Social
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Sparkles className={cn('size-3.5', result.earned > 0 ? 'text-lime' : 'text-muted-foreground/40')} />
                      {result.earned} Earned
                    </span>
                  </div>
                </div>
                <Link href="/app/vouch">
                  <Button variant="flow" size="sm" className="gap-1.5">
                    Vouch
                    <ArrowRight className="size-3.5" />
                  </Button>
                </Link>
              </div>

              {/* Quick link to their public profile */}
              <Link
                href={`/u/${result.handle}`}
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                View public profile
                <ArrowRight className="size-3.5" />
              </Link>
            </div>
          )}
        </div>
      </Frame>
    </div>
  );
}

// ── Suggestion panel ───────────────────────────────────────────────────────────

interface SuggestionPanelProps {
  suggestions: Suggestion[] | null;
  loading: boolean;
  t: TFn;
}

function SuggestionPanel({ suggestions, loading, t }: SuggestionPanelProps) {
  // Still fetching
  if (loading || suggestions === null) {
    return (
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Users className="size-3.5" />
          {t('people.suggest.heading')}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-xl border border-border/60 bg-surface/30 p-3"
            >
              <Skeleton className="size-10 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-3 w-24 rounded" />
                <Skeleton className="h-2.5 w-32 rounded" />
              </div>
              <Skeleton className="h-7 w-20 shrink-0 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // No graph data yet
  if (suggestions.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <StateArt kind="empty-leaderboard" size={200} className="opacity-50" />
        <div className="space-y-1">
          <p className="flex items-center justify-center gap-2 font-display text-sm font-medium text-muted-foreground">
            <Users className="size-4" />
            Discover the network
          </p>
          <p className="text-xs text-muted-foreground">
            Type an @handle above to find someone&apos;s star.
          </p>
        </div>
      </div>
    );
  }

  // We have suggestions — show the cards
  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Users className="size-3.5" />
        {t('people.suggest.heading')}
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        {suggestions.map((s) => (
          <SuggestionCard key={s.address} suggestion={s} t={t} />
        ))}
      </div>

      {/* Attribution footnote — when #109's read API lands, this note can be removed. */}
      <p className="pt-1 text-center text-2xs text-muted-foreground">{t('people.suggest.footnote')}</p>
    </div>
  );
}

function SuggestionCard({ suggestion: s, t }: { suggestion: Suggestion; t: TFn }) {
  const label = s.handle ? `@${s.handle}` : `${s.address.slice(0, 6)}…${s.address.slice(-4)}`;
  const mutualText = t(`people.suggest.mutual.${s.sharedCount === 1 ? 'one' : 'other'}`, {
    count: String(s.sharedCount),
  });

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-surface/30 p-3 transition-colors hover:bg-surface/50">
      <Avatar
        address={s.address}
        handle={s.handle ?? undefined}
        size={40}
        ring
      />

      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-sm font-semibold">{label}</p>
        <p className="truncate text-2xs text-muted-foreground">{mutualText}</p>
      </div>

      {/* `/u/[handle]` resolves ON-CHAIN by handle — an address with no claimed handle
          has no profile route yet, so don't link somewhere that can only ever 404. */}
      {s.handle ? (
        <Link href={`/u/${s.handle}`} aria-label={t('people.suggest.viewAria', { label })}>
          <Button variant="outline" size="sm" className="shrink-0 gap-1 text-xs">
            <UserPlus className="size-3.5" />
            {t('people.suggest.view')}
          </Button>
        </Link>
      ) : (
        <Button variant="outline" size="sm" className="shrink-0 gap-1 text-xs" disabled>
          <UserPlus className="size-3.5" />
          {t('people.suggest.view')}
        </Button>
      )}
    </div>
  );
}
