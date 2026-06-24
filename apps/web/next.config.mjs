/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @passport/shared ships raw TS; let Next transpile it from the workspace.
  transpilePackages: ['@passport/shared'],
  experimental: {
    // stellar-sdk pulls some node-ish deps; keep server externals tidy.
    serverComponentsExternalPackages: ['@stellar/stellar-sdk'],
  },
  images: {
    // The sticker asset kit (public/assets/**) is already web-optimized art; skip Next's
    // recompression so every sticker/illustration stays pixel-for-pixel lossless.
    unoptimized: true,
  },
};

export default nextConfig;
