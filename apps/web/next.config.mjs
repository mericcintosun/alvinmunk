import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @passport/shared ships raw TS; let Next transpile it from the workspace.
  // passkey-kit (+ its sibling SDKs) also ship raw, uncompiled TS → transpile them too.
  transpilePackages: ['@passport/shared', 'passkey-kit', 'passkey-kit-sdk', 'sac-sdk'],
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
