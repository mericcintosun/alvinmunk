/**
 * Canonical origin for metadata, robots, and sitemap. Previews and forks must not
 * emit production absolute URLs in og:image and related tags.
 */
export function getSiteUrl(): URL {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) {
    return new URL(explicit);
  }

  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) {
    return new URL(`https://${vercel}`);
  }

  return new URL('http://localhost:3000');
}
