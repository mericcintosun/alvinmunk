'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Pencil, X } from 'lucide-react';
import { useWallet } from '@/components/wallet/wallet-provider';
import { claimHandle, isHandleAvailable } from '@/lib/registry';
import { normalizeHandle } from '@/lib/profile';
import { ShareRow } from '@/components/fx/share-row';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/Avatar';
import { AvatarPicker } from '@/components/AvatarPicker';
import { AvatarRemix } from '@/components/AvatarRemix';
import { type FaceId, type KitAvatar } from '@/lib/avatar';
import { cn } from '@/lib/utils';

/**
 * Identity bar — your @handle as the profile ID, with inline claim/edit (re-stamps the
 * handle on-chain) + share + public-profile link. The handle was claimed at onboarding;
 * editing renames it on the registry.
 */
export function IdentityBar() {
  const { profile, connect, setProfile } = useWallet();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [tab, setTab] = useState<'faces' | 'remix'>('faces');

  if (!profile) return null;

  function chooseFace(id: FaceId) {
    if (!profile) return;
    setProfile({ ...profile, avatar: { kind: 'face', id } });
    setPicking(false);
  }

  function chooseKit(cfg: KitAvatar) {
    if (!profile) return;
    setProfile({ ...profile, avatar: cfg });
    setPicking(false);
  }

  async function save() {
    if (!profile) return;
    const h = normalizeHandle(value);
    if (h.length < 3) {
      toast.error('Pick a handle — 3+ letters or numbers.');
      return;
    }
    if (h === profile.handle) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      if (!(await isHandleAvailable(h))) {
        toast.error(`@${h} is taken — pick another.`);
        return;
      }
      const w = await connect();
      await claimHandle(w, h); // rename on-chain
      setProfile({ ...profile, handle: h });
      toast.success(`@${h} stamped on-chain.`);
      setEditing(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'claim failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
            className="flex items-center gap-2"
          >
            <span className="font-mono text-muted-foreground">@</span>
            <Input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={profile.handle}
              className="h-9 w-40 font-mono"
              aria-label="New handle"
            />
            <Button size="sm" variant="flow" type="submit" disabled={busy}>
              {busy ? '…' : 'stamp'}
            </Button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Cancel"
            >
              <X className="size-4" />
            </button>
          </form>
        ) : (
          <>
            <button
              onClick={() => setPicking((p) => !p)}
              className="rounded-full outline-none ring-offset-2 ring-offset-background transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-lime"
              aria-label="Change your face"
              title="Change your face"
            >
              <Avatar address={profile.address} avatar={profile.avatar} handle={profile.handle} size={40} />
            </button>
            <h1 className="truncate font-display text-lg font-semibold">@{profile.handle}</h1>
            <Badge variant="onchain">on-chain</Badge>
            <button
              onClick={() => {
                setValue(profile.handle);
                setEditing(true);
              }}
              className="text-muted-foreground transition-colors hover:text-primary"
              aria-label="Edit handle"
            >
              <Pencil className="size-3.5" />
            </button>
          </>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <Link href={`/u/${profile.handle}`} className="font-mono text-xs text-primary hover:underline">
          public_profile →
        </Link>
        <ShareRow
          path={`/u/${profile.handle}`}
          text="My constellation on alvinmunk — collect people, not points."
        />
      </div>
    </div>
      {picking && (
        <div className="mt-3 rounded-xl border border-border/60 bg-surface/40 p-3">
          <div className="mb-3 flex justify-center gap-1">
            {(['faces', 'remix'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  'rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors',
                  tab === t ? 'bg-lime text-lime-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t === 'faces' ? 'pick a face' : 'remix'}
              </button>
            ))}
          </div>
          {tab === 'faces' ? (
            <AvatarPicker
              value={profile.avatar?.kind === 'face' ? profile.avatar.id : undefined}
              onChange={chooseFace}
              size={44}
            />
          ) : (
            <AvatarRemix
              seed={profile.address}
              initial={profile.avatar?.kind === 'kit' ? profile.avatar : undefined}
              onSave={chooseKit}
              onCancel={() => setPicking(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}
