import type { MetadataRoute } from 'next';
import { THEME_COLOR } from '@/lib/theme';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'alvinmunk',
    short_name: 'alvinmunk',
    description: 'Collect people, not points.',
    start_url: '/app',
    scope: '/',
    display: 'standalone',
    // The manifest has no per-scheme colours: the installed app opens in the brand's dark
    // theme, so both are its --background (the page's theme-color metas take over after load).
    background_color: THEME_COLOR.dark,
    theme_color: THEME_COLOR.dark,
    icons: [
      {
        src: '/assets/brand/alvinmunk-icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/assets/brand/alvinmunk-icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
      {
        src: '/assets/brand/alvinmunk-icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
