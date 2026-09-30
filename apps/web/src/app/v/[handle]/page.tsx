'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, QrCode as QrCodeIcon } from 'lucide-react';
import { resolveHandle, getMeta } from '@/lib/registry';
import { getPeopleCounts } from '@/lib/constellation';
import { Crest } from '@/components/brand/crest';
import { Avatar } from '@/components/Avatar';
import { Frame } from '@/components/fx/frame';
import { Stamp } from '@/components/fx/stamp';
import { BorderBeam } from '@/components/fx/border-beam';
import { AuroraText } from '@/components/fx/shiny-text';
import { Button, buttonVariants } from '@/components/ui/button';
import { QrCode } from '@/components/fx/qr-code';
import { ShareRow } from '@/components/fx/share-row';
import { useWallet } from '@/components/wallet/wallet-provider';
import { useTranslations } from '@/lib/i18n';
import { saveInviteRef } from '@/lib/invite-ref';
import { shortAddr } from '@alvinmunk/shared';
import { cn } from '@/lib/utils';
import type { AvatarConfig } from '@/lib/avatar';

/**
 * Vouch-invite deep link — `/v/<handle>` is shared by @handle to recruit. The visitor
 * lands on a personalized, OG-rich invite, onboards in two taps, and is nudged to vouch
 * @handle back on the dashboard (we stash the inviter in sessionStorage). One user
 * becomes a recruiting funnel.
 */
export default function InvitePage({ params }: { params: { handle: string } }) {
  const t = useTranslations();
  const { profile } = useWallet();
  const handle = params.handle.toLowerCase();
  const [address, setAddress] = useState<string | null | undefined>(undefined);
  const [vouchedBy, setVouchedBy] = useState<number | null>(null);
  const [avatar, setAvatar] = useState<AvatarConfig | undefined>(undefined);
  const [showInviteQr, setShowInviteQr] = useState(false);
  const [origin, setOrigin] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
    setMounted(true);
  }, []);

  useEffect(() => {
    let alive = true;
    setAvatar(undefined);
    resolveHandle(handle)
      .then(async (addr) => {
        if (!alive) return;
        setAddress(addr);
        if (!addr) return;
        saveInviteRef(handle); // only a claimed handle: the dashboard nudges a vouch-back
        const [people, meta] = await Promise.all([
          getPeopleCounts(addr).catch(() => ({ vouchedBy: 0, backed: 0 })),
          getMeta(addr), // the inviter's published face; null → deterministic default
        ]);
        if (!alive) return;
        setVouchedBy(people.vouchedBy);
        setAvatar(meta?.avatar);
      })
      .catch(() => alive && setAddress(null));
    return () => {
      alive = false;
    };
  }, [handle]);

  // The owner is the connected wallet whose address this handle resolves to.
  // Only they see the (secret-free) invite QR for their own page.
  const isOwner = Boolean(address) && profile?.address === address;

  // The call to action fits who is looking. The stored profile only loads after mount, so
  // nothing renders before then (the server can't tell the owner from a stranger); a
  // signed-in visitor also waits for the handle to resolve, since that decides owner or not.
  let cta: ReactNode = null;
  if (!profile) {
    if (mounted) {
      cta = (
        <span className="relative inline-flex overflow-hidden rounded-full">
          <Link href="/app" className={cn(buttonVariants({ variant: 'flow', size: 'lg' }))}>
            Create your profile <ArrowRight className="size-4" />
          </Link>
          <BorderBeam size={60} duration={6} colorTo="hsl(var(--tertiary))" />
        </span>
      );
    }
  } else if (isOwner) {
    cta = (
      <div>
        <p className="mb-3 font-mono text-xs uppercase tracking-wider text-muted-foreground">
          {t('invite.cta.share')}
        </p>
        <ShareRow path={`/v/${handle}`} text={t('invite.cta.shareText')} />
      </div>
    );
  } else if (address) {
    cta = (
      <span className="relative inline-flex overflow-hidden rounded-full">
        <Link href="/app/vouch" className={cn(buttonVariants({ variant: 'flow', size: 'lg' }))}>
          {t('invite.cta.vouchBack', { handle })} <ArrowRight className="size-4" />
        </Link>
        <BorderBeam size={60} duration={6} colorTo="hsl(var(--tertiary))" />
      </span>
    );
  } else if (address === null) {
    // Unclaimed (or unreachable): nobody to vouch back, and this visitor has a profile.
    cta = (
      <Link href="/app" className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'glass')}>
        {t('invite.cta.openApp')} <ArrowRight className="size-4" />
      </Link>
    );
  }

  return (
    <div className="container max-w-lg py-16">
      <p className="eyebrow-mono text-primary/80">{'// you_are_invited'}</p>
      <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight text-balance">
        @{handle} wants you in their <AuroraText>constellation.</AuroraText>
      </h1>
      <p className="mt-3 text-muted-foreground text-balance">
        alvinmunk — collect people, not points. Make yours in two taps (no seed phrase, fees
        sponsored), then vouch them back so your stars connect.
      </p>

      <Frame label={`invite // @${handle}`} index="REF" className="mt-7" tilt tape="tr">
        <div className="flex items-center gap-5 p-7">
          {address ? (
            <Avatar address={address} avatar={avatar} handle={handle} size={96} />
          ) : (
            <Crest address={`unclaimed-${handle}`} size={96} points={7} animate />
          )}
          <div className="min-w-0">
            <div className="font-display text-2xl font-semibold">@{handle}</div>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {address ? shortAddr(address) : 'new to the sky'}
            </p>
            <div className="mt-2">
              <Stamp accent="secondary">
                ✦{' '}
                {!address || vouchedBy === 0
                  ? 'be their first'
                  : vouchedBy === null
                    ? '…'
                    : `vouched by ${vouchedBy}`}
              </Stamp>
            </div>
          </div>
        </div>
      </Frame>

      <div className="mt-6">{cta}</div>

      {isOwner && (
        <div className="mt-6">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowInviteQr((v) => !v)}
            aria-expanded={showInviteQr}
            aria-controls="invite-qr"
          >
            <QrCodeIcon className="size-4" />
            {showInviteQr ? t('invite.qr.hide') : t('invite.qr.show')}
          </Button>
          {showInviteQr && (
            <div id="invite-qr" className="mt-3 flex flex-col items-center gap-2">
              <QrCode value={`${origin}/v/${handle}`} label={t('invite.qr.alt')} />
            </div>
          )}
        </div>
      )}
      <p className="mt-4 font-mono text-2xs uppercase tracking-wider text-muted-foreground">
        no_seed_phrase / fees_sponsored / 2_taps
      </p>
    </div>
  );
}
