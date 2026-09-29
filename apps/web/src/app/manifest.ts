import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'alvinmunk',
    short_name: 'alvinmunk',
    description: 'Collect people, not points.',
    start_url: '/app',
    scope: '/',
    display: 'standalone',
    background_color: '#0B0512',
    theme_color: '#9A52FF',
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
