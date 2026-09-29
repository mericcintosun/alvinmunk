/**
 * Offline tests for scripts/lib/env.mjs, plus a drift check: the committed
 * deployments/testnet.json must name the contracts the README, CI and the SDK point at.
 *
 * Usage: node --test scripts/lib/env.test.mjs
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  CONTRACT_NAMES,
  CONTRACT_VARS,
  DeploymentError,
  envLines,
  parseDotenv,
  requireDeployment,
  resolveDeployment,
} from './env.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..');
const LOADER = path.join(HERE, 'env.mjs');
const TESTNET = 'Test SDF Network ; September 2015';
const MAINNET = 'Public Global Stellar Network ; September 2015';

/** A well-formed contract id ending in `tag` (the loader checks the shape, not the checksum). */
const cid = (tag) => `C${tag.padStart(55, 'A')}`;
const MANIFEST_IDS = {
  reputation: cid('REP'),
  questRegistry: cid('QUEST'),
  rewards: cid('REWARDS'),
  registry: cid('REGISTRY'),
  gate: cid('GATE'),
  usdcSac: cid('USDC'),
};

/** A config root holding an optional apps/web/.env.local and deployments/<network>.json files. */
const roots = [];
after(() => roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true })));
function fixture({ envLocal, manifests = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alvinmunk-env-'));
  roots.push(root);
  if (envLocal !== undefined) {
    fs.mkdirSync(path.join(root, 'apps', 'web'), { recursive: true });
    fs.writeFileSync(path.join(root, 'apps', 'web', '.env.local'), envLocal);
  }
  for (const [network, data] of Object.entries(manifests)) {
    fs.mkdirSync(path.join(root, 'deployments'), { recursive: true });
    fs.writeFileSync(path.join(root, 'deployments', `${network}.json`), JSON.stringify(data));
  }
  return root;
}
const testnetManifest = (contracts = MANIFEST_IDS) => ({
  network: 'testnet',
  passphrase: TESTNET,
  rpcUrl: 'https://rpc.manifest.test',
  horizonUrl: 'https://horizon.manifest.test',
  contracts,
});

test('parseDotenv reads KEY=VALUE lines and skips comments, blanks and `export`', () => {
  assert.deepEqual(
    parseDotenv('# comment\n\nA=1\nexport B = two words \nC="quoted ; value"\nD=\'x\'\nnot a line\n'),
    { A: '1', B: 'two words', C: 'quoted ; value', D: 'x' },
  );
});

test('each value comes from the env, then .env.local, then the manifest', () => {
  const root = fixture({
    envLocal: `${CONTRACT_VARS.rewards}=${cid('LOCALREWARDS')}\n${CONTRACT_VARS.gate}=${cid('LOCALGATE')}\n`,
    manifests: { testnet: testnetManifest() },
  });
  const d = resolveDeployment({ root, env: { [CONTRACT_VARS.gate]: cid('ENVGATE') } });
  assert.equal(d.network, 'testnet');
  assert.equal(d.passphrase, TESTNET);
  assert.equal(d.rpcUrl, 'https://rpc.manifest.test');
  assert.equal(d.contracts.gate, cid('ENVGATE'));
  assert.equal(d.sources.gate, 'environment');
  assert.equal(d.contracts.rewards, cid('LOCALREWARDS'));
  assert.equal(d.sources.rewards, path.join('apps', 'web', '.env.local'));
  assert.equal(d.contracts.reputation, MANIFEST_IDS.reputation);
  assert.equal(d.sources.reputation, path.join('deployments', 'testnet.json'));
});

test('a blank variable counts as unset', () => {
  const root = fixture({ manifests: { testnet: testnetManifest() } });
  const d = resolveDeployment({ root, env: { [CONTRACT_VARS.reputation]: '  ', NEXT_PUBLIC_RPC_URL: '' } });
  assert.equal(d.contracts.reputation, MANIFEST_IDS.reputation);
  assert.equal(d.rpcUrl, 'https://rpc.manifest.test');
});

test('with no source at all, every requested id is reported missing', () => {
  const root = fixture();
  assert.throws(
    () => requireDeployment(['reputation', 'questRegistry', 'rewards'], { root, env: {} }),
    (e) => {
      assert.ok(e instanceof DeploymentError);
      for (const name of ['reputation', 'questRegistry', 'rewards']) {
        assert.match(e.message, new RegExp(`${CONTRACT_VARS[name]} is not set`));
      }
      assert.match(e.message, /deployments\/testnet\.json \(not found\)/);
      return true;
    },
  );
});

test('a malformed id is refused and its source named', () => {
  const root = fixture({ envLocal: `${CONTRACT_VARS.rewards}=REPLACE_ME\n` });
  assert.throws(
    () => requireDeployment(['rewards'], { root, env: {} }),
    /NEXT_PUBLIC_REWARDS_CONTRACT_ID \(from apps\/web\/\.env\.local\) is not a contract id: "REPLACE_ME"/,
  );
});

test('the network picks the manifest, and one network never borrows the other\'s ids', () => {
  const root = fixture({
    envLocal: `${CONTRACT_VARS.reputation}=${cid('LOCAL')}\n`, // no network line: a testnet file
    manifests: { testnet: testnetManifest() },
  });
  const d = resolveDeployment({ root, env: {}, network: 'mainnet' });
  assert.equal(d.passphrase, MAINNET);
  assert.equal(d.contracts.reputation, undefined);
  assert.throws(() => requireDeployment(['reputation'], { root, env: {}, network: 'mainnet' }), (e) => {
    assert.match(e.message, /skipped: it is for testnet/);
    assert.match(e.message, /deployments\/mainnet\.json \(not found\)/);
    return true;
  });
});

test('NEXT_PUBLIC_STELLAR_NETWORK selects the network unless a script pins one', () => {
  const root = fixture({
    manifests: { mainnet: { ...testnetManifest(), network: 'mainnet', passphrase: MAINNET } },
  });
  const env = { NEXT_PUBLIC_STELLAR_NETWORK: 'Mainnet' };
  assert.equal(resolveDeployment({ root, env }).network, 'mainnet');
  assert.equal(requireDeployment(['reputation'], { root, env }).contracts.reputation, MANIFEST_IDS.reputation);
  assert.throws(
    () => resolveDeployment({ root, env, network: 'testnet' }),
    /NEXT_PUBLIC_STELLAR_NETWORK=mainnet is set, but this runs on testnet/,
  );
  assert.throws(() => resolveDeployment({ root, env: { NEXT_PUBLIC_STELLAR_NETWORK: 'futurenet' } }), /unknown network "futurenet"/);
});

test('a passphrase for the other network is refused', () => {
  const root = fixture({ manifests: { testnet: testnetManifest() } });
  assert.throws(
    () => requireDeployment(['reputation'], { root, env: { NEXT_PUBLIC_NETWORK_PASSPHRASE: MAINNET } }),
    /NEXT_PUBLIC_NETWORK_PASSPHRASE \(from environment\) is "Public Global Stellar Network ; September 2015", not the testnet passphrase/,
  );
});

test('required settings are checked like ids', () => {
  const root = fixture({ manifests: { testnet: { ...testnetManifest(), rpcUrl: undefined } } });
  assert.throws(() => requireDeployment([], { root, env: {}, settings: ['rpcUrl'] }), /NEXT_PUBLIC_RPC_URL is not set/);
});

test('the CLI prints NEXT_PUBLIC_* lines, and exits 2 naming a missing id', () => {
  const root = fixture({ manifests: { testnet: testnetManifest() } });
  const env = { PATH: process.env.PATH, ALVINMUNK_CONFIG_ROOT: root };
  const ok = spawnSync(process.execPath, [LOADER, 'reputation', 'rewards'], { env, encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(ok.stdout.trim().split('\n'), [
    'NEXT_PUBLIC_STELLAR_NETWORK=testnet',
    `NEXT_PUBLIC_NETWORK_PASSPHRASE=${TESTNET}`,
    'NEXT_PUBLIC_RPC_URL=https://rpc.manifest.test',
    'NEXT_PUBLIC_HORIZON_URL=https://horizon.manifest.test',
    `NEXT_PUBLIC_REPUTATION_CONTRACT_ID=${MANIFEST_IDS.reputation}`,
    `NEXT_PUBLIC_REWARDS_CONTRACT_ID=${MANIFEST_IDS.rewards}`,
  ]);

  const missing = spawnSync(process.execPath, [LOADER, '--network', 'mainnet', 'gate'], { env, encoding: 'utf8' });
  assert.equal(missing.status, 2);
  assert.equal(missing.stdout, '');
  assert.match(missing.stderr, /NEXT_PUBLIC_GATE_CONTRACT_ID is not set/);

  const bad = spawnSync(process.execPath, [LOADER, 'nope'], { env, encoding: 'utf8' });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /^usage:/);
});

// ── the committed manifest ──

const committed = requireDeployment(CONTRACT_NAMES, {
  root: REPO,
  env: {},
  network: 'testnet',
  settings: ['rpcUrl', 'horizonUrl'],
});

test('deployments/testnet.json is complete and well-formed', () => {
  assert.equal(committed.network, 'testnet');
  for (const name of CONTRACT_NAMES) {
    assert.equal(committed.sources[name], path.join('deployments', 'testnet.json'), name);
  }
  assert.equal(envLines(committed).length, 4 + CONTRACT_NAMES.length);
});

test('deployments/testnet.json names the contracts in the README table', () => {
  const readme = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8');
  const row = (label) => {
    const m = readme.match(new RegExp(`^\\| ${label}[^|]*\\| \\[\`(C[A-Z2-7]{55})\`\\]`, 'm'));
    assert.ok(m, `README has a ${label} row`);
    return m[1];
  };
  assert.equal(row('Reputation'), committed.contracts.reputation);
  assert.equal(row('Quest Registry'), committed.contracts.questRegistry);
  assert.equal(row('Rewards'), committed.contracts.rewards);
  assert.equal(row('Registry'), committed.contracts.registry);
  assert.equal(row('Gate'), committed.contracts.gate);
});

test('the CI fallback ids and the SDK defaults match deployments/testnet.json', () => {
  const ci = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'ci.yml'), 'utf8');
  // A fallback that is still a literal must be the manifest's id (CI may read the manifest instead).
  for (const name of ['reputation', 'questRegistry', 'rewards', 'registry']) {
    const envVar = CONTRACT_VARS[name];
    const m = ci.match(new RegExp(`${envVar}: \\$\\{\\{ vars\\.${envVar} \\|\\| '(C[A-Z2-7]{55})' \\}\\}`));
    if (m) assert.equal(m[1], committed.contracts[name], `ci.yml fallback for ${envVar}`);
  }
  const sdk = fs.readFileSync(path.join(REPO, 'packages', 'sdk', 'src', 'index.ts'), 'utf8');
  const testnet = sdk.slice(sdk.indexOf('testnet: {'), sdk.indexOf('mainnet: {'));
  for (const name of ['reputation', 'registry', 'gate']) {
    const m = testnet.match(new RegExp(`${name}: '(C[A-Z2-7]{55})'`));
    assert.ok(m, `SDK testnet default for ${name}`);
    assert.equal(m[1], committed.contracts[name], `SDK testnet default for ${name}`);
  }
});

// ── the scripts that use it ──

test('every ops script stops with exit 2 naming a missing id when nothing configures it', () => {
  const root = fixture();
  const env = { PATH: process.env.PATH, ALVINMUNK_CONFIG_ROOT: root };
  const scripts = [
    [process.execPath, 'status.mjs', 'NEXT_PUBLIC_QUEST_REGISTRY_CONTRACT_ID'],
    [process.execPath, 'e2e-testnet.mjs', 'NEXT_PUBLIC_USDC_SAC_ID'],
    [process.execPath, 'freeze-rings.mjs', 'NEXT_PUBLIC_REWARDS_CONTRACT_ID'],
    ['bash', 'bump-ttl.sh', 'NEXT_PUBLIC_REPUTATION_CONTRACT_ID'],
  ];
  for (const [cmd, script, envVar] of scripts) {
    const r = spawnSync(cmd, [path.join(REPO, 'scripts', script)], { env, encoding: 'utf8', timeout: 30_000 });
    assert.equal(r.status, 2, `${script}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, new RegExp(`${envVar} is not set`), script);
    // e2e-testnet checks its ids before it asks for the admin and attester secrets.
    assert.doesNotMatch(r.stderr, /SECRET_KEY/, script);
  }
});
