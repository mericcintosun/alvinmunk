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
  webpack: (config) => {
    // smart-account-kit lazy-imports the OPTIONAL external-wallet adapter
    // (@creit-tech/stellar-wallets-kit) only when connecting a Freighter/LOBSTR signer.
    // We use the passkey path only, so stub it to an empty module — actually installing
    // it would drag back the native node-hid/usb deps that broke the Vercel build.
    config.resolve.alias = {
      ...config.resolve.alias,
      '@creit-tech/stellar-wallets-kit': false,
      '@creit-tech/stellar-wallets-kit/modules/utils': false,
    };
    return config;
  },
};

export default nextConfig;
