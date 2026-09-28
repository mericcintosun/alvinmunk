import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Metadata } from 'next';
import { accumulateMetadata, type MetadataItems } from 'next/dist/lib/metadata/resolve-metadata';
import type { ResolvedMetadata } from 'next/dist/lib/metadata/types/metadata-interface';
import { CLAIM_DESCRIPTION, SITE_DESCRIPTION, SITE_TITLE, rootMetadata, routeHandle } from '@/lib/metadata';
import * as appLayout from './app/layout';
import * as vouchLayout from './app/vouch/layout';
import * as questsLayout from './app/quests/layout';
import * as rewardsLayout from './app/rewards/layout';
import * as activityLayout from './app/activity/layout';
import * as peopleLayout from './app/people/layout';
import * as claimLayout from './claim/[id]/layout';
import * as profileLayout from './u/[handle]/layout';
import * as inviteLayout from './v/[handle]/layout';
import * as leaderboardLayout from './leaderboard/layout';
import * as statsLayout from './stats/layout';
import * as walletLayout from './wallet/layout';
import * as howItWorksLayout from './how-it-works/layout';

// The /app layout renders the wallet-gated client shell; only its metadata matters here.
vi.mock('@/components/app/app-client-layout', () => ({ AppClientLayout: () => null }));

type Export = Metadata | (() => Metadata);
/** One route segment: its layout's metadata export (null = no layout) and, optionally,
 *  the og:image a sibling `opengraph-image` file contributes. */
type Segment = Export | null | { metadata: Export; ogImage: string };

// metadataBase comes from getSiteUrl(): whatever host this run resolves to.
const at = (path: string, base = rootMetadata.metadataBase as URL) => new URL(path, base).href;
const DEFAULT_OG = at('/assets/meta/og-default.png');

/**
 * Resolve metadata the way Next does for a page: the root layout, then each segment's
 * layout, then the (client, metadata-less) page. This runs Next's own merge, so the
 * title-template inheritance and the openGraph/twitter replace-not-merge rules are real.
 */
async function resolve(pathname: string, ...segments: Segment[]): Promise<ResolvedMetadata> {
  return resolveWith(rootMetadata, pathname, ...segments);
}

async function resolveWith(root: Metadata, pathname: string, ...segments: Segment[]) {
  const items = [root, ...segments, null].map((segment) => {
    if (segment && 'ogImage' in segment) {
      const files = { openGraph: [{ url: segment.ogImage, width: 1200, height: 630 }] };
      return [segment.metadata, files, null];
    }
    return [segment, null, null];
  }) as unknown as MetadataItems;
  return accumulateMetadata(items, { pathname, trailingSlash: false, isStandaloneMode: false });
}

const profile = (handle: string) => () => profileLayout.generateMetadata({ params: { handle } });
const invite = (handle: string) => () => inviteLayout.generateMetadata({ params: { handle } });

const imageUrls = (images: { url: string | URL }[] | undefined) =>
  (images ?? []).map((i) => i.url.toString());

/** Every piece of text a page or its unfurl shows. */
function texts(m: ResolvedMetadata) {
  return {
    title: m.title?.absolute,
    ogTitle: m.openGraph?.title.absolute,
    twitterTitle: m.twitter?.title.absolute,
    description: m.description,
    ogDescription: m.openGraph?.description,
    twitterDescription: m.twitter?.description,
  };
}

describe('route metadata', () => {
  it('the landing page keeps the site title and the generic description', async () => {
    const m = await resolve('/');
    expect(texts(m)).toEqual({
      title: SITE_TITLE,
      ogTitle: SITE_TITLE,
      twitterTitle: SITE_TITLE,
      description: SITE_DESCRIPTION,
      ogDescription: SITE_DESCRIPTION,
      twitterDescription: SITE_DESCRIPTION,
    });
    expect(imageUrls(m.openGraph?.images)).toEqual([DEFAULT_OG]);
    expect(m.twitter?.card).toBe('summary_large_image');
  });

  it.each([
    ['/leaderboard', leaderboardLayout.metadata, 'Leaderboard'],
    ['/stats', statsLayout.metadata, 'Stats'],
    ['/wallet', walletLayout.metadata, 'Wallet'],
    ['/how-it-works', howItWorksLayout.metadata, 'How it works'],
  ])('%s has its own title and unfurl text, and keeps the default card', async (path, metadata, title) => {
    const m = await resolve(path, metadata);
    const t = texts(m);
    expect(t.title).toBe(`${title} · alvinmunk`);
    expect(t.ogTitle).toBe(t.title);
    expect(t.twitterTitle).toBe(t.title);
    expect(t.description).toBe(metadata.description);
    expect(t.ogDescription).toBe(metadata.description);
    expect(t.twitterDescription).toBe(metadata.description);
    expect(m.openGraph).toMatchObject({ type: 'website' });
    expect(imageUrls(m.openGraph?.images)).toEqual([DEFAULT_OG]);
    expect(imageUrls(m.twitter?.images)).toEqual([DEFAULT_OG]);
    expect(m.twitter?.card).toBe('summary_large_image');
  });

  it('/app is "Home"', async () => {
    const m = await resolve('/app', appLayout.metadata);
    expect(m.title?.absolute).toBe('Home · alvinmunk');
  });

  it.each([
    ['/app/vouch', vouchLayout.metadata, 'Vouch'],
    ['/app/quests', questsLayout.metadata, 'Quests'],
    ['/app/rewards', rewardsLayout.metadata, 'Rewards'],
    ['/app/activity', activityLayout.metadata, 'Activity'],
    ['/app/people', peopleLayout.metadata, 'People'],
  ])('%s keeps the site suffix under the /app layout', async (path, metadata, title) => {
    const m = await resolve(path, appLayout.metadata, metadata);
    expect(m.title?.absolute).toBe(`${title} · alvinmunk`);
    expect(m.openGraph?.title.absolute).toBe(`${title} · alvinmunk`);
  });

  it('/u/<handle> is handle-specific, lowercase-canonical, and keeps its opengraph-image', async () => {
    const m = await resolve('/u/Alice', null, {
      metadata: profile('Alice'),
      ogImage: '/u/alice/opengraph-image?a1b2',
    });
    const card = at('/u/alice/opengraph-image?a1b2');
    const t = texts(m);
    expect(t.title).toBe('@alice · alvinmunk');
    expect(t.ogTitle).toBe('@alice · alvinmunk');
    expect(t.ogDescription).toContain('@alice');
    expect(t.twitterDescription).toContain('@alice');
    expect(m.alternates?.canonical?.url.toString()).toBe(at('/u/alice'));
    expect(imageUrls(m.openGraph?.images)).toEqual([card]);
    expect(imageUrls(m.twitter?.images)).toEqual([card]);
    expect(m.twitter?.card).toBe('summary_large_image');
  });

  it('/v/<handle> reads as an invite from that handle', async () => {
    const m = await resolve('/v/Bob', null, invite('Bob'));
    expect(m.title?.absolute).toBe('@bob invited you · alvinmunk');
    expect(m.openGraph?.description).toContain('@bob');
    expect(m.alternates?.canonical?.url.toString()).toBe(at('/v/bob'));
  });

  it.each(['not-a-handle', 'a'.repeat(33), '%3Cscript%3E'])(
    'a param that can never be a handle (%s) gets generic copy and no canonical',
    async (param) => {
      const u = await resolve(`/u/${param}`, null, profile(param));
      expect(u.title?.absolute).toBe('Profile · alvinmunk');
      expect(u.alternates?.canonical).toBeNull();
      const v = await resolve(`/v/${param}`, null, invite(param));
      expect(v.title?.absolute).toBe('You’re invited · alvinmunk');
      expect(v.alternates?.canonical).toBeNull();
    },
  );

  it('/claim/<id> carries the claim-funnel copy and still unfurls with the default card', async () => {
    const m = await resolve('/claim/7', null, claimLayout.metadata);
    expect(texts(m)).toEqual({
      title: 'Someone vouched for you · alvinmunk',
      ogTitle: 'Someone vouched for you · alvinmunk',
      twitterTitle: 'Someone vouched for you · alvinmunk',
      description: CLAIM_DESCRIPTION,
      ogDescription: CLAIM_DESCRIPTION,
      twitterDescription: CLAIM_DESCRIPTION,
    });
    expect(imageUrls(m.openGraph?.images)).toEqual([DEFAULT_OG]);
    expect(m.twitter?.card).toBe('summary_large_image');
  });

  it('only /claim/<id> uses the claim-funnel description', async () => {
    const others = await Promise.all([
      resolve('/'),
      resolve('/leaderboard', leaderboardLayout.metadata),
      resolve('/stats', statsLayout.metadata),
      resolve('/wallet', walletLayout.metadata),
      resolve('/how-it-works', howItWorksLayout.metadata),
      resolve('/app', appLayout.metadata),
      resolve('/app/vouch', appLayout.metadata, vouchLayout.metadata),
      resolve('/u/alice', null, profile('alice')),
      resolve('/v/alice', null, invite('alice')),
    ]);
    for (const m of others) {
      expect(Object.values(texts(m))).not.toContain(CLAIM_DESCRIPTION);
    }
  });
});

describe('indexing (#212)', () => {
  it.each([
    ['/app', [appLayout.metadata]],
    ['/app/vouch', [appLayout.metadata, vouchLayout.metadata]],
    ['/app/people', [appLayout.metadata, peopleLayout.metadata]],
    ['/claim/7', [null, claimLayout.metadata]],
  ] as [string, Segment[]][])('%s renders noindex', async (path, segments) => {
    const m = await resolve(path, ...segments);
    expect(m.robots?.basic).toBe('noindex, nofollow');
  });

  it.each([
    ['/', []],
    ['/leaderboard', [leaderboardLayout.metadata]],
    ['/how-it-works', [howItWorksLayout.metadata]],
    ['/u/alice', [null, profile('alice')]],
    ['/v/alice', [null, invite('alice')]],
  ] as [string, Segment[]][])('%s stays indexable', async (path, segments) => {
    const m = await resolve(path, ...segments);
    expect(m.robots).toBeNull();
  });
});

describe('site URL in metadata', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('a preview deployment points og:image and the canonical at its own host', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('VERCEL_URL', 'alvinmunk-git-feature.vercel.app');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'alvinmunk.vercel.app');
    vi.resetModules();
    const { rootMetadata: previewRoot } = await import('@/lib/metadata');
    const preview = 'https://alvinmunk-git-feature.vercel.app';

    const home = await resolveWith(previewRoot, '/');
    expect(imageUrls(home.openGraph?.images)).toEqual([`${preview}/assets/meta/og-default.png`]);

    const u = await resolveWith(previewRoot, '/u/alice', null, {
      metadata: profile('alice'),
      ogImage: '/u/alice/opengraph-image?a1b2',
    });
    expect(imageUrls(u.openGraph?.images)).toEqual([`${preview}/u/alice/opengraph-image?a1b2`]);
    expect(u.alternates?.canonical?.url.toString()).toBe(`${preview}/u/alice`);
  });
});

describe('routeHandle', () => {
  it('lowercases a registry handle', () => {
    expect(routeHandle('Alice_01')).toBe('alice_01');
  });

  it('rejects what the registry can never hold', () => {
    expect(routeHandle('')).toBeNull();
    expect(routeHandle('al-ice')).toBeNull();
    expect(routeHandle('a'.repeat(33))).toBeNull();
    expect(routeHandle('a'.repeat(32))).toBe('a'.repeat(32));
  });
});
