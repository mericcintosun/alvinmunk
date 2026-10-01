import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { Sparkles, Users, ShieldCheck, Code, ArrowLeft } from 'lucide-react';
import { getScores, getQuestAttestation } from '@/lib/reputation';
import { getPeopleCounts } from '@/lib/constellation';
import { Crest } from '@/components/brand/crest';
import { Frame } from '@/components/fx/frame';
import { StateArt } from '@/components/ui/state-art';
import { Sticker } from '@/components/ui/sticker';
import { isStellarAddress, shortAddr } from '@alvinmunk/shared';
import { ReputationSnippet } from '@/components/ReputationSnippet';
import { ReadOnlyBanner } from '@/components/read-only-banner';
import { readNetworkFor } from '@/lib/read-network';
import { FormattedDate, FormattedNumber } from '@/components/formatted';
import { buttonVariants } from '@/components/ui/button';
import Link from 'next/link';
import { getTranslations } from '@/lib/i18n';
import { LOCALE_KEY, parseLocale } from '@/lib/locale';

// Chain reads go through the Stellar SDK's fetch; without this Next caches them in the Data
// Cache forever, so the score page would never change after its first render.
export const fetchCache = 'default-no-store';

interface ScorePageProps {
  params: Promise<{ address: string }>;
  /** `?network=testnet` reads the testnet deployment, read-only (lib/read-network). */
  searchParams?: Promise<{ network?: string | string[] }>;
}

// A bare title: the root template adds " · alvinmunk" (appending it here doubled it, #204).
// No `openGraph` either — it would replace the root's default card; Next fills og:title and
// og:description from these two.
export async function generateMetadata({ params }: ScorePageProps): Promise<{
  title: string;
  description: string;
}> {
  const { address } = await params;
  return {
    title: `Reputation: ${shortAddr(address)}`,
    description: `View the on-chain reputation for ${address} — Social XP, Earned XP, and quest attestations.`,
  };
}

export default async function ScorePage({ params, searchParams }: ScorePageProps) {
  const { address } = await params;
  const net = readNetworkFor((await searchParams)?.network);

  // Read locale from cookie for server-side translations (may throw outside request scope, e.g. in tests)
  let savedLocale: 'en' | 'tr' | null = null;
  try {
    savedLocale = parseLocale(cookies().get(LOCALE_KEY)?.value);
  } catch {
    // cookies() not available (e.g. during testing) — fall back to English
  }
  const t = getTranslations(savedLocale ?? 'en');

  // Validate address format
  if (!isStellarAddress(address)) {
    notFound();
  }

  // Fetch reputation data (read-only, no wallet required)
  const [scores, people, questAttestation] = await Promise.all([
    getScores(address, net).catch(() => ({ social: 0, earned: 0 })),
    getPeopleCounts(address, net).catch(() => ({ vouchedBy: 0, backed: 0 })),
    getQuestAttestation(address, net).catch(() => null),
  ]);

  const hasActivity =
    scores.social > 0 ||
    scores.earned > 0 ||
    questAttestation !== null ||
    people.vouchedBy > 0 ||
    people.backed > 0;

  if (!hasActivity) {
    return (
      <div className="container max-w-2xl py-14">
        {net && <ReadOnlyBanner network={net.network} />}
        <p className="eyebrow-mono text-primary/80">{'// not_found'}</p>
        <div className="mt-6 flex flex-col items-center gap-4 text-center">
          <StateArt kind="empty-leaderboard" size={300} priority className="motion-safe:animate-float" />
          <h1 className="font-display text-2xl font-semibold">{t('score.empty.title')}</h1>
          <p className="text-muted-foreground">{t('score.empty.body')}</p>
          <p className="font-mono text-sm text-muted-foreground">{shortAddr(address)}</p>
          <div className="mt-6 flex flex-col sm:flex-row items-center gap-3">
            <Link
              href="/app/vouch"
              className={buttonVariants({ variant: 'flow', size: 'lg' })}
            >
              {t('score.empty.vouchAction')}
            </Link>
            <Link
              href="/leaderboard"
              className={buttonVariants({ variant: 'outline', size: 'lg' })}
            >
              <ArrowLeft className="size-4 shrink-0" />
              {t('score.empty.backToLeaderboard')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container max-w-2xl py-14">
      {net && <ReadOnlyBanner network={net.network} />}
      {/* Header */}
      <p className="eyebrow-mono text-primary/80">{'// public_reputation'}</p>
      <div className="mt-4 flex items-end justify-between border-b border-border/60 pb-3">
        <h1 className="font-display text-4xl font-semibold tracking-tight">Reputation</h1>
        <span className="font-mono text-xs text-muted-foreground">read_only</span>
      </div>

      {/* Address display */}
      <div className="mt-6 flex items-center gap-4">
        <Crest address={address} size={64} points={Math.min(9, 4 + (people.vouchedBy % 5))} />
        <div>
          <p className="font-mono text-sm text-muted-foreground">{shortAddr(address)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {address.startsWith('C') ? 'Passkey wallet (C…)' : 'Classic wallet (G…)'}
          </p>
        </div>
      </div>

      {/* Stats grid */}
      <Frame label="reputation // on_chain" index="live" className="mt-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {/* People who vouched */}
          <div className="relative border-border/50 p-6 sm:border-r">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-accent" />
              <span className="text-sm font-medium text-muted-foreground">Vouched by</span>
            </div>
            <p className="mt-2 font-display text-4xl font-semibold tabular-nums">
              <FormattedNumber value={people.vouchedBy} />
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              People in their sky · backed <FormattedNumber value={people.backed} />
            </p>
          </div>

          {/* Social XP */}
          <div className="relative border-border/50 p-6 sm:border-r">
            <div className="flex items-center gap-2">
              <Users className="size-4 text-tertiary" />
              <span className="text-sm font-medium text-muted-foreground">Social XP</span>
            </div>
            <p className="mt-2 font-display text-4xl font-semibold tabular-nums text-tertiary">
              <FormattedNumber value={scores.social} />
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Clout · not cashable</p>
          </div>

          {/* Earned XP */}
          <div className="relative p-6">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-secondary" />
              <span className="text-sm font-medium text-muted-foreground">Earned XP</span>
            </div>
            <p className="mt-2 font-display text-4xl font-semibold tabular-nums text-secondary">
              <FormattedNumber value={scores.earned} />
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Verified · unlocks USDC</p>
          </div>
        </div>
      </Frame>

      {/* Attestations */}
      {questAttestation && (
        <Frame label="quests // verified" index="latest" className="mt-6">
          <div className="flex items-center gap-4 p-6">
            <Sticker name="stamp-verified" size={48} className="h-10 w-auto" />
            <div>
              <p className="font-display text-2xl font-semibold">
                <FormattedNumber value={Number(questAttestation.value)} /> XP
              </p>
              <p className="text-sm text-muted-foreground">
                Earned from verified quests · latest on{' '}
                <FormattedDate value={questAttestation.timestamp * 1000} />
              </p>
            </div>
          </div>
        </Frame>
      )}

      {/* For developers section — the snippet reads the deployment's own contract, so it
          would not match an override's data. */}
      {!net && (
        <section className="mt-12">
          <div className="flex items-center gap-2 border-b border-border/60 pb-3">
            <Code className="size-4 text-muted-foreground" />
            <h2 className="font-display text-xl font-semibold tracking-tight">For developers</h2>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Read this wallet&apos;s Social and Earned XP straight from the reputation contract with{' '}
            <code className="font-mono text-xs">@stellar/stellar-sdk</code>. No wallet or API key needed.
          </p>
          <ReputationSnippet address={address} className="mt-4" />
        </section>
      )}
    </div>
  );
}
