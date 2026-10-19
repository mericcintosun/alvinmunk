// Empty stand-in for the `server-only` marker package.
//
// Next 15's internal metadata resolver (`next/dist/lib/metadata/resolve-metadata`) does
// `require('server-only')` at module load. That package's default entry throws by design
// ("cannot be imported from a Client Component"); Next swaps it for its own empty module
// through the `react-server` export condition, which a plain Node require under vitest
// does not apply. `route-metadata.test.ts` redirects the specifier here so it can exercise
// Next's real metadata merge under jsdom.
module.exports = {};
