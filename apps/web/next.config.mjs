/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @passport/shared ships raw TS; let Next transpile it from the workspace.
  transpilePackages: ['@passport/shared'],
  experimental: {
    // stellar-sdk pulls some node-ish deps; keep server externals tidy.
    serverComponentsExternalPackages: ['@stellar/stellar-sdk'],
  },
};

export default nextConfig;
