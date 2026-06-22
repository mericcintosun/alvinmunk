'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useWallet } from '@/components/wallet/wallet-provider';
import { recordGenesis } from '@/lib/genesis';
import { normalizeHandle, type Profile } from '@/lib/profile';
import { txExplorerUrl } from '@/lib/stellar';
import { humanizeError } from '@/lib/utils';
import { Crest } from '@/components/brand/crest';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { VouchCompose } from '@/components/VouchCompose';
import { Quests } from '@/components/Quests';
import { Tip } from '@/components/Tip';
import { Rewards } from '@/components/Rewards';

export default function AppHome() {
  const { profile, connect, setProfile } = useWallet();
  const [handle, setHandle] = useState('');
  const [creating, setCreating] = useState(false);

  // Invisible wallet: one step. Pick a handle → we silently provision a testnet wallet,
  // fund it, and write the genesis tx. No "connect wallet", no "mint", no jargon.
  async function createPassport() {
    const h = normalizeHandle(handle);
    if (h.length < 3) {
      toast.error('Pick a handle — 3+ letters or numbers.');
      return;
    }
    setCreating(true);
    try {
      const w = await connect();
      const tx = await recordGenesis(w, h);
      const p: Profile = { handle: h, address: w.address, createdAt: Date.now(), genesisTx: tx };
      setProfile(p);
      toast.success('Your passport is live — verified on-chain.');
    } catch (e) {
      toast.error(humanizeError(e));
    } finally {
      setCreating(false);
    }
  }

  // ─── Onboarding (no profile yet) ───
  if (!profile) {
    return (
      <div className="container flex max-w-md flex-col items-center gap-8 py-20">
        <div className="text-center">
          <h1 className="text-3xl font-semibold">Create your passport</h1>
          <p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground text-balance">
            Pick a handle — we set everything up for you. Your first star is one tap away.
          </p>
        </div>

        <Crest address={handle ? `passport-${handle}` : 'new-passport'} size={160} points={6} animate />

        <form
          className="flex w-full flex-col items-center gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void createPassport();
          }}
        >
          <Input
            autoFocus
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="your handle"
            className="text-center"
            aria-label="Handle"
          />
          <Button type="submit" size="lg" disabled={creating} className="w-full">
            {creating ? 'Creating your passport…' : 'Create my passport'}
          </Button>
        </form>

        <p className="text-center text-xs text-muted-foreground text-balance">
          Saved on this device · fees sponsored on testnet · no seed phrase.
        </p>
      </div>
    );
  }

  // ─── Dashboard ───
  return (
    <div className="container max-w-2xl py-10">
      <Card className="mb-6 overflow-hidden">
        <CardContent className="flex items-center gap-5 p-6">
          <Crest address={profile.address} handle={profile.handle} size={88} points={7} animate />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-xl font-semibold">@{profile.handle}</h1>
              <Badge variant="onchain">on-chain</Badge>
            </div>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {profile.address.slice(0, 6)}…{profile.address.slice(-4)}
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <Link href={`/u/${profile.handle}`} className="text-primary hover:underline">
                View public passport →
              </Link>
              {profile.genesisTx && (
                <a
                  href={txExplorerUrl(profile.genesisTx)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted-foreground hover:underline"
                >
                  Genesis tx ↗
                </a>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        <VouchCompose />
        <Quests address={profile.address} />
        <Tip address={profile.address} />
        <Rewards address={profile.address} />
      </div>
    </div>
  );
}
