import { notFound } from 'next/navigation';
import { Sparkles, Users, ShieldCheck, Code, AlertCircle } from 'lucide-react';
import { getScores, getAttestation } from '@/lib/reputation';
import { getPeopleCounts } from '@/lib/constellation';
import { Crest } from '@/components/brand/crest';
import { Frame } from '@/components/fx/frame';
import { Stamp } from '@/components/fx/stamp';
import { StateArt } from '@/components/ui/state-art';
import { Sticker } from '@/components/ui/sticker';
import { cn, shortAddress } from '@/lib/utils';

// Stellar address validation: classic (G…) OR passkey smart-account (C…)
const STELLAR_ADDRESS = /^[GC][A-Z2-7]{55}$/;

interface ScorePageProps {
  params: Promise<{ address: string }>;
}

export async function generateMetadata({ params }: ScorePageProps): Promise<{
  title: string;
  description: string;
}> {
  const { address } = await params;
  return {
    title: `Reputation: ${shortAddress(address)} · alvinmunk`,
    description: `View the on-chain reputation for ${address} — people who vouched, Social XP, Earned XP, and quest attestations.`,
  };
}

export default async function ScorePage({ params }: ScorePageProps) {
  const { address } = await params;

  // Validate address format
  if (!STELLAR_ADDRESS.test(address)) {
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
  const [scores, people, attestations] = await Promise.all([
    getScores(address).catch(() => ({ social: 0, earned: 0 })),
    getPeopleCounts(address).catch(() => ({ vouchedBy: 0, backed: 0 })),
    getAttestation(address),
  ]);

  const hasActivity =
    scores.social > 0 ||
    scores.earned > 0 ||
    attestations > 0 ||
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
          <p className="font-mono text-sm text-muted-foreground">{shortAddress(address)}</p>
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
          <p className="font-mono text-sm text-muted-foreground">{shortAddress(address)}</p>
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
      {attestations > 0 && (
        <Frame label="quests // completed" index={`${attestations}`} className="mt-6">
          <div className="flex items-center gap-4 p-6">
            <Sticker name="stamp-verified" size={48} className="h-10 w-auto" />
            <div>
              <p className="font-display text-2xl font-semibold">{attestations}</p>
              <p className="text-sm text-muted-foreground">Quest attestations completed</p>
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
          Read this reputation data from your own app using the public API. No wallet required.
        </p>
        <div className="mt-4 border border-border/70 bg-background/70">
          <div className="flex items-center gap-1.5 border-b border-border/60 px-3 py-2">
            <span className="size-2.5 rounded-full bg-destructive/70" />
            <span className="size-2.5 rounded-full bg-warning/70" />
            <span className="size-2.5 rounded-full bg-secondary/70" />
            <span className="ml-2 font-mono text-[10px] text-muted-foreground">read-reputation.ts</span>
          </div>
          <pre className="overflow-x-auto p-5 font-mono text-xs leading-relaxed text-foreground/80">
{`import { getScores, getCounts, getAttestation } from '@/lib/reputation';

// Read Social and Earned XP for any address
const { social, earned } = await getScores(address);
// → { social: 42, earned: 30 }

// Distinct people who vouched for it / it vouched for (on-chain counters)
const people = await getCounts(address);
// → { vouchedBy: 4, backed: 3 }

// Read completed quest attestations
const attestations = await getAttestation(address);
// → 5`}
          </pre>
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="border-border/50 border-t p-4">
            <Stamp accent="primary">GET_SCORE</Stamp>
            <p className="mt-2 text-sm text-muted-foreground">
              Returns the Social XP (clout, non-cashable) for an address.
            </p>
          </div>
          <div className="border-border/50 border-t p-4">
            <Stamp accent="secondary">GET_EARNED</Stamp>
            <p className="mt-2 text-sm text-muted-foreground">
              Returns the Earned XP (USDC-eligible track) for an address.
            </p>
          </div>
          <div className="border-border/50 border-t p-4">
            <Stamp accent="primary">GET_COUNTS</Stamp>
            <p className="mt-2 text-sm text-muted-foreground">
              Returns how many distinct people vouched for an address, and how many it vouched for.
            </p>
          </div>
          <div className="border-border/50 border-t p-4">
            <Stamp accent="tertiary">GET_ATTESTATION</Stamp>
            <p className="mt-2 text-sm text-muted-foreground">
              Returns the number of completed quest attestations for an address.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
