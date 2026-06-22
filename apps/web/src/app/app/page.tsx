'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useWallet } from '@/components/wallet/wallet-provider';
import { recordGenesis } from '@/lib/genesis';
import { normalizeHandle, type Profile } from '@/lib/profile';
import { txExplorerUrl } from '@/lib/stellar';
import { Crest } from '@/components/brand/crest';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { VouchCompose } from '@/components/VouchCompose';
import { Quests } from '@/components/Quests';
import { Tip } from '@/components/Tip';
import { Rewards } from '@/components/Rewards';

type Step = 'connect' | 'handle' | 'minting' | 'done';

export default function AppHome() {
  const { profile, balance, connecting, connect, setProfile } = useWallet();
  const [step, setStep] = useState<Step>(profile ? 'done' : 'connect');
  const [handle, setHandle] = useState('');
  const [busy, setBusy] = useState(false);

  // Returning user with a saved profile → straight to the dashboard.
  if (profile && step !== 'done') setStep('done');

  async function onConnect() {
    try {
      await connect();
      setStep('handle');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not connect');
    }
  }

  async function onMint() {
    const h = normalizeHandle(handle);
    if (h.length < 3) {
      toast.error('Pick a handle — 3+ letters or numbers.');
      return;
    }
    setBusy(true);
    setStep('minting');
    try {
      const w = await connect(); // idempotent — returns the live wallet
      const tx = await recordGenesis(w, h);
      const p: Profile = { handle: h, address: w.address, createdAt: Date.now(), genesisTx: tx };
      setProfile(p);
      setStep('done');
      toast.success('Your passport is live — verified on-chain.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Mint failed');
      setStep('handle');
    } finally {
      setBusy(false);
    }
  }

  // ─── Onboarding ───
  if (step !== 'done' || !profile) {
    return (
      <div className="container flex max-w-md flex-col items-center gap-8 py-16">
        <div className="text-center">
          <h1 className="text-3xl font-semibold">Step into your passport</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Connect to start your constellation. Fees are sponsored on testnet — no seed phrase.
          </p>
        </div>

        <Crest address={handle || 'new-passport'} size={160} points={6} animate />

        {step === 'connect' && (
          <Button size="lg" onClick={onConnect} disabled={connecting}>
            {connecting ? 'Connecting…' : 'Connect wallet'}
          </Button>
        )}

        {(step === 'handle' || step === 'minting') && (
          <div className="flex w-full flex-col items-center gap-3">
            {balance != null && (
              <p className="text-xs text-muted-foreground">
                Funded: {Number(balance).toFixed(1)} XLM
              </p>
            )}
            <Input
              autoFocus
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="pick a handle"
              className="text-center"
            />
            <Button size="lg" onClick={onMint} disabled={busy}>
              {step === 'minting' ? 'Lighting your first star…' : 'Mint my passport'}
            </Button>
          </div>
        )}

        <Link href="/wallet" className="text-xs text-muted-foreground underline">
          or use a classic Freighter wallet (Level 1 demo)
        </Link>
      </div>
    );
  }

  // ─── Dashboard ───
  return (
    <div className="container max-w-2xl py-10">
      {/* Passport header */}
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

      {/* The loop */}
      <div className="grid gap-4">
        <VouchCompose />
        <Quests address={profile.address} />
        <Tip address={profile.address} />
        <Rewards address={profile.address} />
      </div>
    </div>
  );
}
