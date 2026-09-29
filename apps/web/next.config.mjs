import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        // Apply to every route (pages + API)
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains',
          },
          {
            key: 'Permissions-Policy',
            value:
              'camera=(), microphone=(), geolocation=(), publickey-credentials-get=(self), publickey-credentials-create=(self)',
          },
        ],
      },
      {
        // /claim/* links carry a one-time secret in the URL fragment; suppress the
        // Referer header so it never leaks to third-party resources on that page.
        source: '/claim/:path*',
        headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
      },
    ];
  },
  // @alvinmunk/shared and @alvinmunk/sdk ship raw TS in the workspace; let Next transpile them.
  // passkey-kit (+ its sibling SDKs) also ship raw, uncompiled TS → transpile them too.
  transpilePackages: ['@alvinmunk/shared', '@alvinmunk/sdk', 'passkey-kit', 'passkey-kit-sdk', 'sac-sdk'],
  experimental: {
    // stellar-sdk pulls some node-ish deps; keep server externals tidy.
    serverComponentsExternalPackages: ['@stellar/stellar-sdk'],
  },
  images: {
    // The sticker asset kit (public/assets/**) is already web-optimized art; skip Next's
    // recompression so every sticker/illustration stays pixel-for-pixel lossless.
    unoptimized: true,
  },
  webpack: (config, { webpack }) => {
    // @stellar/stellar-sdk@14 (pulled in transitively by passkey-kit's `/minimal` barrel)
    // ships `minimal/bindings/config.js`, which does `require('../../package.json')` via a
    // path webpack can't resolve. That file is the `contract bindings` codegen CLI helper —
    // never used at runtime — so replace it with a no-op stub so the bundle builds.
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /[\\/]minimal[\\/]bindings[\\/]config(\.js)?$/,
        path.resolve(__dirname, 'stubs/stellar-bindings-config.cjs'),
      ),
    );
    return config;
  },
};

export default nextConfig;
