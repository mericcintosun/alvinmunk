'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Pencil, X } from 'lucide-react';
import { useWallet } from '@/components/wallet/wallet-provider';
import {
  claimHandle,
  getMeta,
  handleAvailability,
  isMetaUnsupported,
  META_ERRORS,
  setMeta,
} from '@/lib/registry';
import { BIO_MAX_BYTES, bioBytes, normalizeHandle, sanitizeBio } from '@/lib/profile';
import { useLocale, useTranslations, type TFn } from '@/lib/i18n';
import { ShareRow } from '@/components/fx/share-row';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/Avatar';
import { AvatarPicker } from '@/components/AvatarPicker';
import { AvatarRemix } from '@/components/AvatarRemix';
import { defaultAvatarId, type AvatarConfig, type FaceId, type KitAvatar } from '@/lib/avatar';
import { cn, humanizeError } from '@/lib/utils';

// Registry codes `set_meta` can revert with → i18n messages.
function metaErrors(t: TFn): Record<number, string> {
  return {
    [META_ERRORS.NoHandle]: t('identity.meta.error.noHandle'),
    [META_ERRORS.BioTooLong]: t('identity.meta.error.bio'),
    [META_ERRORS.BadBio]: t('identity.meta.error.bio'),
    [META_ERRORS.BadAvatar]: t('identity.meta.error.avatar'),
  };
}

const sameAvatar = (a?: AvatarConfig, b?: AvatarConfig) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Identity bar — your @handle as the profile ID, with inline claim/edit (re-stamps the
 * handle on-chain) + share + public-profile link. The handle was claimed at onboarding;
 * editing renames it on the registry. Your face and bio are published on the registry
 * (`set_meta`) so every viewer of /u/<handle> and its share card sees them; the local
 * profile is the instant cache.
 */
export function IdentityBar() {
  const t = useTranslations();
  const { locale } = useLocale();
  const { profile, connect, setProfile } = useWallet();
  const [editing, setEditing] = useState(false);
  const [editingBio, setEditingBio] = useState(false);
  const [value, setValue] = useState('');
  const [bioValue, setBioValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [savingMeta, setSavingMeta] = useState(false);
  const [picking, setPicking] = useState(false);
  const [tab, setTab] = useState<'faces' | 'remix'>('faces');

  // The newest profile for async callbacks, and the wallet whose face/bio was edited here
  // (its chain copy is then older than the local one and must not overwrite it).
  const latest = useRef(profile);
  latest.current = profile;
  const editedFor = useRef<string | null>(null);

  // Adopt the published face/bio once per wallet, so one picked on another device shows
  // here too. A registry without `get_meta` (or no profile yet) resolves null: keep local.
  const address = profile?.address;
  useEffect(() => {
    if (!address) return;
    let alive = true;
    void getMeta(address).then((meta) => {
      const p = latest.current;
      if (!alive || !meta || editedFor.current === address || p?.address !== address) return;
      const avatar = meta.avatar ?? p.avatar;
      if (sameAvatar(avatar, p.avatar) && meta.bio === (p.bio ?? '')) return;
      setProfile({ ...p, avatar, bio: meta.bio });
    });
    return () => {
      alive = false;
    };
  }, [address, setProfile]);

  if (!profile) return null;

  /** Apply a face/bio change locally at once, then publish both on-chain. */
  async function publish(change: { avatar?: AvatarConfig; bio?: string }) {
    const p = latest.current;
    if (!p) return;
    editedFor.current = p.address;
    setProfile({ ...p, ...change });
    setSavingMeta(true);
    try {
      // set_meta writes both fields. The one this edit leaves alone comes from the local
      // copy, else the chain (this device may not have adopted it yet), else — for the
      // face — the default everyone already sees.
      const published = await getMeta(p.address);
      const shown: AvatarConfig = { kind: 'face', id: defaultAvatarId(p.address) };
      const avatar = change.avatar ?? p.avatar ?? published?.avatar ?? shown;
      const bio = change.bio ?? p.bio ?? published?.bio ?? '';
      const w = await connect();
      await setMeta(w, avatar, bio);
      const now = latest.current;
      if (now?.address === p.address) setProfile({ ...now, avatar, bio });
      toast.success(t('identity.meta.saved'));
    } catch (e) {
      toast.error(
        isMetaUnsupported(e) ? t('identity.meta.unsupported') : humanizeError(e, metaErrors(t)),
      );
    } finally {
      setSavingMeta(false);
    }
  }

  function chooseFace(id: FaceId) {
    setPicking(false);
    void publish({ avatar: { kind: 'face', id } });
  }

  function chooseKit(cfg: KitAvatar) {
    setPicking(false);
    void publish({ avatar: cfg });
  }

  function saveBio() {
    const bio = sanitizeBio(bioValue);
    setEditingBio(false);
    if (bio !== (profile?.bio ?? '')) void publish({ bio });
  }

  async function save() {
    if (!profile) return;
    const h = normalizeHandle(value);
    if (h.length < 3) {
      toast.error(t('identity.handleTooShort'));
      return;
    }
    if (h === profile.handle) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      // its previous owner may take back a handle it freed, so ask on behalf of this wallet
      const a = await handleAvailability(h, profile.address);
      if (a.status === 'reserved') {
        toast.error(
          t('identity.handle.reserved', {
            handle: h,
            date: a.until.toLocaleDateString(locale, { dateStyle: 'medium' }),
          }),
        );
        return;
      }
      if (a.status === 'taken') {
        toast.error(t('identity.handleTaken', { handle: h }));
        return;
      }
      const w = await connect();
      await claimHandle(w, h); // rename on-chain
      setProfile({ ...profile, handle: h });
      toast.success(t('identity.handleStamped', { handle: h }));
      setEditing(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('identity.claimFailed'));
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
              aria-label={t('identity.newHandle')}
            />
            <Button size="sm" variant="flow" type="submit" disabled={busy}>
              {busy ? '…' : t('identity.stamp')}
            </Button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-muted-foreground hover:text-foreground"
              aria-label={t('identity.cancel')}
            >
              <X className="size-4" />
            </button>
          </form>
        ) : (
          <>
            <button
              onClick={() => setPicking((p) => !p)}
              disabled={savingMeta}
              className="rounded-full outline-none ring-offset-2 ring-offset-background transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-lime"
              aria-label={t('identity.changeFace')}
              title={t('identity.changeFace')}
            >
              <Avatar address={profile.address} avatar={profile.avatar} handle={profile.handle} size={40} />
            </button>
            <p className="truncate font-display text-lg font-semibold">@{profile.handle}</p>
            <Badge variant="onchain">{t('identity.onChain')}</Badge>
            <button
              onClick={() => {
                setValue(profile.handle);
                setEditing(true);
              }}
              className="text-muted-foreground transition-colors hover:text-primary"
              aria-label={t('identity.editHandle')}
            >
              <Pencil className="size-3.5" />
            </button>
          </>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <Link href={`/u/${profile.handle}`} className="text-sm text-primary hover:underline">
          {t('identity.viewProfile')}
        </Link>
        <ShareRow
          path={`/u/${profile.handle}`}
          text={t('identity.shareText')}
        />
      </div>
    </div>

      {/* Bio — plain text, published with the face */}
      <div className="mt-1.5 flex items-center gap-2 pl-[48px]">
        {editingBio ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveBio();
            }}
            className="flex w-full items-center gap-2"
          >
            <Input
              autoFocus
              value={bioValue}
              onChange={(e) => setBioValue(sanitizeBio(e.target.value, { trim: false }))}
              placeholder={t('identity.bio.placeholder')}
              className="h-8 flex-1 text-xs"
              aria-label={t('identity.bio.label')}
            />
            <span
              className="shrink-0 font-mono text-[10px] text-muted-foreground"
              title={t('identity.bio.bytesHint')}
            >
              {bioBytes(bioValue)}/{BIO_MAX_BYTES}
            </span>
            <Button size="sm" variant="flow" type="submit" disabled={savingMeta}>
              {t('identity.bio.save')}
            </Button>
            <button
              type="button"
              onClick={() => setEditingBio(false)}
              className="text-muted-foreground hover:text-foreground"
              aria-label={t('identity.bio.cancel')}
            >
              <X className="size-3.5" />
            </button>
          </form>
        ) : (
          <>
            {profile.bio ? (
              <p className="min-w-0 truncate text-xs text-muted-foreground">{profile.bio}</p>
            ) : (
              <span className="font-mono text-[10px] text-muted-foreground/60">
                {t('identity.bio.add')}
              </span>
            )}
            <button
              onClick={() => {
                setBioValue(profile.bio ?? '');
                setEditingBio(true);
              }}
              disabled={savingMeta}
              className="shrink-0 text-muted-foreground transition-colors hover:text-primary disabled:opacity-50"
              aria-label={t('identity.bio.edit')}
            >
              <Pencil className="size-3" />
            </button>
            {savingMeta && (
              <span className="font-mono text-[10px] text-muted-foreground" aria-live="polite">
                {t('identity.meta.saving')}
              </span>
            )}
          </>
        )}
      </div>

      {picking && (
        <div className="mt-3 rounded-xl border border-border/60 bg-surface/40 p-3">
          <div className="mb-3 flex justify-center gap-1">
            {(['faces', 'remix'] as const).map((faceTab) => (
              <button
                key={faceTab}
                onClick={() => setTab(faceTab)}
                className={cn(
                  'rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors',
                  tab === faceTab ? 'bg-lime text-lime-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {faceTab === 'faces' ? t('identity.pickFace') : t('identity.remix')}
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
