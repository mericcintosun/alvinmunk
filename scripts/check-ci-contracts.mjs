/**
 * CI contract guard — the fail-fast gate for the e2e job's contract ids (#250).
 *
 * The e2e smoke test WRITES: it creates a Friendbot wallet, writes a genesis tx, claims a
 * handle on the registry and mints a vouch on the reputation contract. While ci.yml carried
 * the published testnet ids as `vars.X || 'C…'` fallbacks, every run (× Playwright's 3
 * attempts, on every push and PR) did that against the production contracts — adding a bot
 * wallet to the live registry/reputation event streams that `/api/stats` counts and
 * `scripts/scan-roster.mjs` commits into the roster forever, and leaving `e2e…` handles and
 * never-claimed vouches in people search and the activity feed.
 *
 * So the ids now come from repository variables that hold a DEDICATED CI set, and this
 * script refuses to hand them to the test unless all three hold:
 *   1. every id the smoke test can invoke is set (a missing var is a red job, never a
 *      silent fallback to the published contracts);
 *   2. every id is a well-formed contract id (strkey shape + CRC-16 checksum, so a typo
 *      fails here instead of 5 minutes into a Playwright timeout);
 *   3. no id is one the README publishes (the production set is read from README.md at
 *      run time, so a re-deploy can't silently drift out of the denylist).
 *
 * No dependencies on purpose: the CI step runs right after checkout, before `pnpm install`,
 * so it works with a bare `node`.
 *
 * Usage: node scripts/check-ci-contracts.mjs
 *   Local check of a set before you publish it as repository variables:
 *     CI_REPUTATION_CONTRACT_ID=C… CI_REGISTRY_CONTRACT_ID=C… node scripts/check-ci-contracts.mjs
 *
 * Tests: node --test scripts/check-ci-contracts.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The e2e job's env needs all of these; the smoke test must never boot without one. */
export const REQUIRED = [
  'CI_REPUTATION_CONTRACT_ID',
  'CI_QUEST_REGISTRY_CONTRACT_ID',
  'CI_REWARDS_CONTRACT_ID',
  'CI_REGISTRY_CONTRACT_ID',
];

/** Wired in when present, but nothing in the smoke test invokes them. */
export const OPTIONAL = ['CI_GATE_CONTRACT_ID', 'CI_USDC_SAC_ID'];

export const RUNBOOK = 'docs/CI_CONTRACTS.md';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
// strkey "contract" version byte (2 << 3) — a `C…` id is version byte + 32 bytes + checksum.
const CONTRACT_VERSION_BYTE = 2 << 3;
const CONTRACT_ID = /^C[A-Z2-7]{55}$/;

/** RFC 4648 base32 (no padding) → bytes, or null if a character is outside the alphabet. */
function decodeBase32(encoded) {
  const bytes = [];
  let bits = 0;
  let value = 0;
  for (const ch of encoded) {
    const index = ALPHABET.indexOf(ch);
    if (index < 0) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }
  return bytes;
}

/** CRC-16/XMODEM, the checksum strkey appends. */
function crc16(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    let code = (crc >>> 8) & 0xff;
    code ^= byte & 0xff;
    code ^= code >>> 4;
    crc = (crc << 8) & 0xffff;
    crc ^= code;
    code = (code << 5) & 0xffff;
    crc ^= code;
    code = (code << 7) & 0xffff;
    crc ^= code;
  }
  return crc & 0xffff;
}

/** null for a valid 32-byte contract id, else the reason it was rejected. */
export function contractIdProblem(id) {
  if (typeof id !== 'string' || id.length === 0) return 'it is empty';
  if (!CONTRACT_ID.test(id)) return 'it is not a C… contract id (C + 55 base32 characters)';
  const bytes = decodeBase32(id);
  if (bytes === null) return 'it is not a C… contract id (C + 55 base32 characters)';
  const payload = bytes.slice(0, -2);
  const checksum = bytes.slice(-2);
  if (payload.length !== 33) return 'it does not decode to a 32-byte contract id';
  if (payload[0] !== CONTRACT_VERSION_BYTE) return 'it is not a contract id (wrong strkey version)';
  const crc = crc16(payload);
  // strkey appends the CRC little-endian.
  if (checksum[0] !== (crc & 0xff) || checksum[1] !== ((crc >> 8) & 0xff)) {
    return 'it fails its strkey checksum (typo?)';
  }
  return null;
}

/** Every contract id the README publishes — i.e. the production set CI must not touch. */
export function publishedContractIds(readme) {
  return new Set(readme.match(/C[A-Z2-7]{55}/g) ?? []);
}

/**
 * Audit a set of CI contract ids. Pure: same env + same README, same verdict.
 * @returns {{ ok: boolean, problems: string[], ids: Record<string, string> }}
 */
export function auditCiContracts({ env = {}, readme = '' } = {}) {
  const published = publishedContractIds(readme);
  const problems = [];
  const ids = {};

  for (const name of [...REQUIRED, ...OPTIONAL]) {
    const id = (env[name] ?? '').trim();
    if (id) ids[name] = id;
    if (!id) {
      if (REQUIRED.includes(name)) {
        problems.push(
          `${name} is not set. The e2e job runs against a dedicated CI contract set only — ` +
            `deploy it once (scripts/deploy-ci-contracts.sh) and publish the id as a repository ` +
            `variable. See ${RUNBOOK}.`,
        );
      }
      continue;
    }
    const problem = contractIdProblem(id);
    if (problem) {
      problems.push(`${name}="${id}" is not a valid contract id: ${problem}.`);
      continue;
    }
    if (published.has(id)) {
      problems.push(
        `${name} is ${id} — a contract the README publishes. CI must never write to the ` +
          `production set: every run would add a bot wallet to /stats and the roster. ` +
          `Deploy a dedicated CI set instead (scripts/deploy-ci-contracts.sh, ${RUNBOOK}).`,
      );
    }
  }

  return { ok: problems.length === 0, problems, ids };
}

/** Repo-root README, so the denylist follows the table the traction numbers cite. */
function readRepoReadme() {
  return fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
}

/** Map the CI ids onto the NEXT_PUBLIC_* names the web app reads. */
export const APP_ENV = {
  CI_REPUTATION_CONTRACT_ID: 'NEXT_PUBLIC_REPUTATION_CONTRACT_ID',
  CI_QUEST_REGISTRY_CONTRACT_ID: 'NEXT_PUBLIC_QUEST_REGISTRY_CONTRACT_ID',
  CI_REWARDS_CONTRACT_ID: 'NEXT_PUBLIC_REWARDS_CONTRACT_ID',
  CI_REGISTRY_CONTRACT_ID: 'NEXT_PUBLIC_REGISTRY_CONTRACT_ID',
  CI_GATE_CONTRACT_ID: 'NEXT_PUBLIC_GATE_CONTRACT_ID',
  CI_USDC_SAC_ID: 'NEXT_PUBLIC_USDC_SAC_ID',
};

function main() {
  const { ok, problems, ids } = auditCiContracts({ env: process.env, readme: readRepoReadme() });
  if (!ok) {
    console.error('✗ CI contract ids rejected — the e2e job will not start.\n');
    for (const problem of problems) console.error(`  • ${problem}`);
    console.error(`\nSee ${RUNBOOK} for the one-time setup.`);
    process.exit(1);
  }
  console.log('✓ CI contract ids accepted (dedicated CI set, not the published contracts):');
  for (const [name, id] of Object.entries(ids)) {
    console.log(`    ${name}=${id} → ${APP_ENV[name]}`);
  }
  const missing = OPTIONAL.filter((name) => !ids[name]);
  if (missing.length) {
    console.log(`    (not set, nothing in the smoke test invokes them: ${missing.join(', ')})`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
