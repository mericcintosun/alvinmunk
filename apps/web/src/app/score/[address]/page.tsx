import { notFound } from 'next/navigation';
import { Sparkles, Users, ShieldCheck, Code, AlertCircle } from 'lucide-react';
import { getScores, getQuestAttestation } from '@/lib/reputation';
import { getPeopleCounts } from '@/lib/constellation';
import { Crest } from '@/components/brand/crest';
import { Frame } from '@/components/fx/frame';
import { StateArt } from '@/components/ui/state-art';
import { Sticker } from '@/components/ui/sticker';
import { isStellarAddress, shortAddr } from '@alvinmunk/shared';
import { ReputationSnippet } from '@/components/ReputationSnippet';

interface ScorePageProps {
  params: Promise<{ address: string }>;
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

export default async function ScorePage({ params }: ScorePageProps) {
  const { address } = await params;

  // Validate address format
  if (!isStellarAddress(address)) {
    return (
      <div className="container max-w-2xl py-14">
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-primary/80">{'// error'}</p>
        <div className="mt-6 flex flex-col items-center gap-4 text-center">
          <AlertCircle className="size-12 text-destructive" />
          <h1 className="font-display text-2xl font-semibold">Invalid address</h1>
          <p className="text-muted-foreground">
            Stellar addresses must start with G or C and be 56 characters long.
          </p>
        </div>
      </div>
    );
  }

  // Fetch reputation data (read-only, no wallet required)
  const [scores, people, questAttestation] = await Promise.all([
    getScores(address).catch(() => ({ social: 0, earned: 0 })),
    getPeopleCounts(address).catch(() => ({ vouchedBy: 0, backed: 0 })),
    getQuestAttestation(address).catch(() => null),
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
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-primary/80">{'// not_found'}</p>
        <div className="mt-6 flex flex-col items-center gap-4 text-center">
          <StateArt kind="empty-leaderboard" size={300} className="motion-safe:animate-float" />
          <h1 className="font-display text-2xl font-semibold">No reputation yet</h1>
          <p className="text-muted-foreground">
            This address hasn&apos;t earned any Social XP, Earned XP, or completed any quests yet.
          </p>
          <p className="font-mono text-sm text-muted-foreground">{shortAddr(address)}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container max-w-2xl py-14">
      {/* Header */}
      <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-primary/80">{'// public_reputation'}</p>
      <div className="mt-4 flex items-end justify-between border-b border-border/60 pb-3">
        <h1 className="font-display text-4xl font-semibold tracking-tight">Reputation</h1>
        <span className="font-mono text-xs text-muted-foreground">read_only</span>
      </div>

      {/* Address display */}
      <div className="mt-6 flex items-center gap-4">
        <Crest address={address} size={64} points={Math.min(9, 4 + (people.vouchedBy % 5))} />
        <div>
          <p className="font-mono text-sm text-muted-foreground">{shortAddr(address)}</p>
          <p className="mt-1 text-xs text-muted-foreground/70">
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
              {people.vouchedBy.toLocaleString()}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              People in their sky · backed {people.backed.toLocaleString()}
            </p>
          </div>

          {/* Social XP */}
          <div className="relative border-border/50 p-6 sm:border-r">
            <div className="flex items-center gap-2">
              <Users className="size-4 text-tertiary" />
              <span className="text-sm font-medium text-muted-foreground">Social XP</span>
            </div>
            <p className="mt-2 font-display text-4xl font-semibold tabular-nums text-tertiary">
              {scores.social.toLocaleString()}
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
              {scores.earned.toLocaleString()}
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
              <p className="font-display text-2xl font-semibold">{Number(questAttestation.value)} XP</p>
              <p className="text-sm text-muted-foreground">
                Earned from verified quests · latest on{' '}
                {new Date(questAttestation.timestamp * 1000).toLocaleDateString('en-US', { dateStyle: 'medium' })}
              </p>
            </div>
          </div>
        </Frame>
      )}

      {/* For developers section */}
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
    </div>
  );
}
