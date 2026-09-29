/**
 * The one place the ops scripts get the deployment they operate on (#243): network,
 * passphrase, RPC/Horizon URLs and contract ids. Each value comes from the first source
 * that sets it:
 *
 *   1. the process environment (the NEXT_PUBLIC_* names the web app uses);
 *   2. apps/web/.env.local, when it is for the same network;
 *   3. the committed manifest deployments/<network>.json.
 *
 * There are no built-in contract ids. A script names the ids it needs, and a missing or
 * malformed one stops it with exit code 2 before any network call.
 *
 * CLI (for shell scripts and CI): prints the resolved values as NEXT_PUBLIC_*=value lines,
 * the format of .env.local and $GITHUB_ENV.
 *   node scripts/lib/env.mjs [--network testnet|mainnet] [reputation questRegistry ...]
 *
 * ALVINMUNK_CONFIG_ROOT overrides the directory that holds apps/web/.env.local and
 * deployments/ (default: the repo root). The offline tests point it at a fixture.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The env var behind each contract id (the names of packages/shared `ContractIds`). */
export const CONTRACT_VARS = {
  reputation: 'NEXT_PUBLIC_REPUTATION_CONTRACT_ID',
  questRegistry: 'NEXT_PUBLIC_QUEST_REGISTRY_CONTRACT_ID',
  rewards: 'NEXT_PUBLIC_REWARDS_CONTRACT_ID',
  registry: 'NEXT_PUBLIC_REGISTRY_CONTRACT_ID',
  gate: 'NEXT_PUBLIC_GATE_CONTRACT_ID',
  usdcSac: 'NEXT_PUBLIC_USDC_SAC_ID',
};
export const CONTRACT_NAMES = Object.keys(CONTRACT_VARS);

const SETTING_VARS = {
  network: 'NEXT_PUBLIC_STELLAR_NETWORK',
  passphrase: 'NEXT_PUBLIC_NETWORK_PASSPHRASE',
  rpcUrl: 'NEXT_PUBLIC_RPC_URL',
  horizonUrl: 'NEXT_PUBLIC_HORIZON_URL',
};

const PASSPHRASES = {
  testnet: 'Test SDF Network ; September 2015',
  mainnet: 'Public Global Stellar Network ; September 2015',
};
const CONTRACT_ID = /^C[A-Z2-7]{55}$/;

/** A problem with the resolved deployment; the message names what to set, and where. */
export class DeploymentError extends Error {}

/** KEY=VALUE lines (blank lines, `#` comments and an `export ` prefix ignored; quotes stripped). */
export function parseDotenv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.trim().match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
      value = value.slice(1, -1);
    }
    out[m[1]] = value;
  }
  return out;
}

/** A trimmed env value; blank means unset (`FOO=` in a .env file, or an empty CI var). */
const val = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const rel = (root, file) => path.relative(root, file) || file;

function readManifest(file) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new DeploymentError(`${file} is not valid JSON: ${e.message}`);
  }
  const flat = {};
  for (const [name, envVar] of Object.entries(SETTING_VARS)) flat[envVar] = data[name];
  for (const [name, envVar] of Object.entries(CONTRACT_VARS)) flat[envVar] = data.contracts?.[name];
  return flat;
}

/**
 * Resolve the deployment without judging it. `network` pins the network (a script that
 * only runs on testnet passes 'testnet'); otherwise it comes from the sources like any
 * other value, defaulting to testnet.
 */
export function resolveDeployment({ env = process.env, root, network } = {}) {
  const base = root ?? val(env.ALVINMUNK_CONFIG_ROOT) ?? REPO_ROOT;
  const envFile = path.join(base, 'apps', 'web', '.env.local');
  const local = fs.existsSync(envFile) ? parseDotenv(fs.readFileSync(envFile, 'utf8')) : {};
  const localNet = (val(local[SETTING_VARS.network]) ?? 'testnet').toLowerCase();

  const wanted = (
    network ??
    val(env[SETTING_VARS.network]) ??
    val(local[SETTING_VARS.network]) ??
    'testnet'
  ).toLowerCase();
  if (!(wanted in PASSPHRASES)) {
    throw new DeploymentError(`unknown network "${wanted}": use testnet or mainnet`);
  }
  const envNet = val(env[SETTING_VARS.network])?.toLowerCase();
  if (envNet && envNet !== wanted) {
    throw new DeploymentError(
      `${SETTING_VARS.network}=${envNet} is set, but this runs on ${wanted}: unset it or run on ${envNet}`,
    );
  }

  const manifestFile = path.join(base, 'deployments', `${wanted}.json`);
  const layers = [
    { label: 'environment', values: env },
    // A .env.local for the other network would hand out the wrong network's ids.
    ...(localNet === wanted ? [{ label: rel(base, envFile), values: local }] : []),
    ...(fs.existsSync(manifestFile) ? [{ label: rel(base, manifestFile), values: readManifest(manifestFile) }] : []),
  ];
  const pick = (envVar) => {
    for (const layer of layers) {
      const v = val(layer.values[envVar]);
      if (v !== undefined) return { value: v, source: layer.label };
    }
    return { value: undefined, source: undefined };
  };

  const passphrase = pick(SETTING_VARS.passphrase);
  const contracts = {};
  const sources = {};
  for (const [name, envVar] of Object.entries(CONTRACT_VARS)) {
    const { value, source } = pick(envVar);
    contracts[name] = value;
    sources[name] = source;
  }
  return {
    network: wanted,
    passphrase: passphrase.value ?? PASSPHRASES[wanted],
    passphraseSource: passphrase.source,
    rpcUrl: pick(SETTING_VARS.rpcUrl).value,
    horizonUrl: pick(SETTING_VARS.horizonUrl).value,
    contracts,
    sources,
    searched: [
      'environment',
      fs.existsSync(envFile)
        ? `${rel(base, envFile)}${localNet === wanted ? '' : ` (skipped: it is for ${localNet})`}`
        : `${rel(base, envFile)} (not found)`,
      `${rel(base, manifestFile)}${fs.existsSync(manifestFile) ? '' : ' (not found)'}`,
    ],
  };
}

/**
 * The deployment with every id in `names` present and well-formed (plus `rpcUrl` /
 * `horizonUrl` when listed in `settings`); throws a DeploymentError naming each problem.
 */
export function requireDeployment(names, { settings = [], ...opts } = {}) {
  const d = resolveDeployment(opts);
  const problems = [];
  if (d.passphrase !== PASSPHRASES[d.network]) {
    problems.push(
      `${SETTING_VARS.passphrase} (from ${d.passphraseSource}) is "${d.passphrase}", not the ${d.network} passphrase`,
    );
  }
  for (const name of names) {
    const envVar = CONTRACT_VARS[name];
    if (!envVar) throw new Error(`unknown contract "${name}"`);
    const id = d.contracts[name];
    if (id === undefined) problems.push(`${envVar} is not set`);
    else if (!CONTRACT_ID.test(id)) problems.push(`${envVar} (from ${d.sources[name]}) is not a contract id: "${id}"`);
  }
  for (const name of settings) {
    if (!d[name]) problems.push(`${SETTING_VARS[name]} is not set`);
  }
  if (problems.length > 0) {
    throw new DeploymentError(
      `${d.network} deployment is incomplete:\n  - ${problems.join('\n  - ')}\n` +
        `Looked in: ${d.searched.join(', ')}. Set the variable in the environment or apps/web/.env.local, ` +
        `or record the deployment in deployments/${d.network}.json.`,
    );
  }
  return d;
}

/** requireDeployment for a script: prints the problem and exits 2 instead of throwing. */
export function loadDeployment(names, opts) {
  try {
    return requireDeployment(names, opts);
  } catch (e) {
    if (!(e instanceof DeploymentError)) throw e;
    console.error(`✗ ${e.message}`);
    process.exit(2);
  }
}

/** The CLI's output: NEXT_PUBLIC_*=value lines for the settings and the requested ids. */
export function envLines(d, names = CONTRACT_NAMES) {
  const lines = [
    `${SETTING_VARS.network}=${d.network}`,
    `${SETTING_VARS.passphrase}=${d.passphrase}`,
    ...(d.rpcUrl ? [`${SETTING_VARS.rpcUrl}=${d.rpcUrl}`] : []),
    ...(d.horizonUrl ? [`${SETTING_VARS.horizonUrl}=${d.horizonUrl}`] : []),
  ];
  for (const name of names) lines.push(`${CONTRACT_VARS[name]}=${d.contracts[name]}`);
  return lines;
}

function main(argv) {
  let network;
  const names = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--network') network = argv[++i];
    else if (argv[i] in CONTRACT_VARS) names.push(argv[i]);
    else {
      console.error(`usage: node scripts/lib/env.mjs [--network testnet|mainnet] [${CONTRACT_NAMES.join('|')} ...]`);
      process.exit(2);
    }
  }
  const wanted = names.length > 0 ? names : CONTRACT_NAMES;
  const d = loadDeployment(wanted, { network });
  process.stdout.write(`${envLines(d, wanted).join('\n')}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
