/**
 * Offline tests for scripts/check-ci-contracts.mjs — the guard that keeps the e2e job off
 * the published contracts (#250). No network, no stellar CLI: the audit is a pure function
 * of (env, README text), so the whole matrix of "unset / typo / production id / good set"
 * runs in milliseconds.
 *
 * Run from repo root: node --test scripts/check-ci-contracts.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  APP_ENV,
  OPTIONAL,
  REQUIRED,
  auditCiContracts,
  contractIdProblem,
  publishedContractIds,
} from './check-ci-contracts.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

// Real ids: two the README publishes (the production set) and two it doesn't (a CI set).
const PRODUCTION = {
  reputation: 'CDRYXUS55TKGYEM3YUB3YTJWQKSWWQABK6YPQK7SLEPVALWYK4IR7WCL',
  questRegistry: 'CBEJVYLWTU6BQDL3RXKWW6CYUISRC4SUIVURCG452CTOIANGY2N7V3WI',
  rewards: 'CBMO3X3EXKUZAHNAPRSFVBXJJARJD5I5VME5UQ7OSI2OA5Q56UO7TM3G',
  registry: 'CCT5EGFZ33IFLMUU6EBMC6NWRLX5TWJS5FICNJFBG7MU5PTAU6PFMVH4',
  gate: 'CDX4QTFVT7VOGXCSASD75INCUHNZJUE3DRZDL65Z65PMIYJ5JELP576E',
};
const CI_SET = {
  reputation: 'CBOWVQ6DLZIFK6TPDUSUPIIIV4B2VXCSYTESIFNUQ2IXMR5ABEN6T7RN',
  questRegistry: 'CAMHTRUQFKUH47RVEQX4J2KSUARVTXXECMIW3EUPC6YWWY4VH4XEEYMJ',
  rewards: 'CCJVTHSHK3IYV4P7LXY57HC6UEEDQUKJ5LCGO2ZBOHP6WFUX5XIOGVTX',
  registry: 'CB3JRRNPIOASLQQI7CQL2FVGZHXMXI3WFTVNNCP3QGTRSW32MIXQPBMO',
  gate: 'CDBTSIYJWQW2BAPQJZ64D7EM3XKKWVZQDLYYR527CSMPPRA6FX4AGXG7',
  usdc: 'CAKT2EK2SFGNXTXVSYZLZXA5YB5QPVHLTVUMRHLJTF5RFFAFMIRNPZT2',
};

const envFor = (set) => ({
  CI_REPUTATION_CONTRACT_ID: set.reputation,
  CI_QUEST_REGISTRY_CONTRACT_ID: set.questRegistry,
  CI_REWARDS_CONTRACT_ID: set.rewards,
  CI_REGISTRY_CONTRACT_ID: set.registry,
  CI_GATE_CONTRACT_ID: set.gate,
  CI_USDC_SAC_ID: set.usdc,
});
const audit = (env) => auditCiContracts({ env, readme: README });

test('accepts a dedicated CI set that is not the published one', () => {
  const { ok, problems, ids } = audit(envFor(CI_SET));
  assert.equal(ok, true, problems.join('\n'));
  assert.deepEqual(problems, []);
  assert.equal(ids.CI_REPUTATION_CONTRACT_ID, CI_SET.reputation);
  assert.equal(ids.CI_GATE_CONTRACT_ID, CI_SET.gate);
});

test('accepts the same set without the optional ids (the smoke test never invokes them)', () => {
  const { ok, problems, ids } = auditCiContracts({
    env: {
      CI_REPUTATION_CONTRACT_ID: CI_SET.reputation,
      CI_QUEST_REGISTRY_CONTRACT_ID: CI_SET.questRegistry,
      CI_REWARDS_CONTRACT_ID: CI_SET.rewards,
      CI_REGISTRY_CONTRACT_ID: CI_SET.registry,
    },
    readme: README,
  });
  assert.equal(ok, true, problems.join('\n'));
  assert.equal(ids.CI_GATE_CONTRACT_ID, undefined);
  assert.equal(ids.CI_USDC_SAC_ID, undefined);
});

test('rejects an empty env: every required id is named as unset', () => {
  const { ok, problems } = audit({});
  assert.equal(ok, false);
  assert.equal(problems.length, REQUIRED.length);
  for (const name of REQUIRED) {
    assert.ok(
      problems.some((p) => p.startsWith(`${name} is not set`)),
      `${name} not reported: ${problems}`,
    );
  }
  assert.ok(problems.every((p) => p.includes('docs/CI_CONTRACTS.md')));
  // Optional ids stay optional.
  for (const name of OPTIONAL) {
    assert.ok(
      !problems.some((p) => p.startsWith(`${name} is not set`)),
      `${name} should not be required`,
    );
  }
});

test('rejects a half-set env (a single missing id is enough to fail the job)', () => {
  const env = envFor(CI_SET);
  delete env.CI_REGISTRY_CONTRACT_ID;
  const { ok, problems } = audit(env);
  assert.equal(ok, false);
  assert.equal(problems.length, 1);
  assert.ok(problems[0].startsWith('CI_REGISTRY_CONTRACT_ID is not set'));
});

test('rejects a published contract id in any required slot', () => {
  for (const name of REQUIRED) {
    const env = { ...envFor(CI_SET), [name]: PRODUCTION.reputation };
    const { ok, problems } = audit(env);
    assert.equal(ok, false, `${name} should be rejected`);
    assert.ok(problems[0].includes('the README publishes'), problems[0]);
  }
});

test('rejects a published id in the optional slots too', () => {
  const { ok, problems } = audit({ ...envFor(CI_SET), CI_GATE_CONTRACT_ID: PRODUCTION.gate });
  assert.equal(ok, false);
  assert.ok(problems[0].includes('the README publishes'), problems[0]);
});

test('rejects the whole published production set (the old ci.yml env)', () => {
  const { ok, problems } = auditCiContracts({
    env: {
      CI_REPUTATION_CONTRACT_ID: PRODUCTION.reputation,
      CI_QUEST_REGISTRY_CONTRACT_ID: PRODUCTION.questRegistry,
      CI_REWARDS_CONTRACT_ID: PRODUCTION.rewards,
      CI_REGISTRY_CONTRACT_ID: PRODUCTION.registry,
      CI_GATE_CONTRACT_ID: PRODUCTION.gate,
    },
    readme: README,
  });
  assert.equal(ok, false);
  assert.equal(problems.length, 5);
});

test('rejects typos, wrong prefixes and non-ids', () => {
  const cases = [
    [CI_SET.reputation.slice(0, -1) + 'P', 'checksum'],
    [CI_SET.reputation.toLowerCase(), 'not a C…'],
    [CI_SET.reputation + 'A', 'not a C…'],
    [CI_SET.reputation.slice(1), 'not a C…'],
    ['G' + CI_SET.reputation.slice(1), 'not a C…'],
    ['C' + 'A'.repeat(55), 'checksum'],
    ['not-an-id', 'not a C…'],
    ['', 'it is empty'],
  ];
  for (const [id, expected] of cases) {
    const problem = contractIdProblem(id);
    assert.ok(problem, `${id} should be rejected`);
    assert.ok(problem.includes(expected), `${id}: expected "${expected}", got "${problem}"`);
    const { ok, problems } = audit({ ...envFor(CI_SET), CI_REPUTATION_CONTRACT_ID: id });
    assert.equal(ok, false, `${id} should fail the audit`);
    if (id) assert.ok(problems[0].startsWith('CI_REPUTATION_CONTRACT_ID='), problems[0]);
    else assert.ok(problems[0].startsWith('CI_REPUTATION_CONTRACT_ID is not set'), problems[0]);
  }
});

test('validates the ids the README publishes (so the denylist is not a stale copy)', () => {
  for (const id of publishedContractIds(README))
    assert.equal(contractIdProblem(id), null, `${id} should be valid`);
  for (const id of Object.values(PRODUCTION))
    assert.equal(contractIdProblem(id), null, `${id} should be valid`);
  assert.equal(publishedContractIds(README).size, 5);
});

test('the denylist follows the README, not a hardcoded copy', () => {
  const readme = `| Registry (handle ↔ address) | [\`${CI_SET.registry}\`](https://stellar.expert) |`;
  assert.ok(publishedContractIds(readme).has(CI_SET.registry));
  const { ok, problems } = auditCiContracts({ env: envFor(CI_SET), readme });
  assert.equal(ok, false);
  assert.ok(problems[0].includes('the README publishes'), problems[0]);
});

test('trims whitespace (GitHub vars can arrive padded)', () => {
  const { ok, problems, ids } = auditCiContracts({
    env: Object.fromEntries(Object.entries(envFor(CI_SET)).map(([k, v]) => [k, `  ${v} `])),
    readme: README,
  });
  assert.equal(ok, true, problems.join('\n'));
  assert.equal(ids.CI_REPUTATION_CONTRACT_ID, CI_SET.reputation);
});

test('every CI id maps to the NEXT_PUBLIC_* name the web app reads', () => {
  assert.deepEqual(Object.keys(APP_ENV).sort(), [...REQUIRED, ...OPTIONAL].sort());
  for (const name of REQUIRED) assert.match(APP_ENV[name], /^NEXT_PUBLIC_/);
});

test('the workflow never hardcodes a contract id (regression guard for #250)', () => {
  const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.equal(ci.match(/C[A-Z2-7]{55}/g), null, 'ci.yml must not contain a contract id');
  for (const name of REQUIRED) {
    assert.ok(ci.includes(`vars.${name}`), `ci.yml should read vars.${name}`);
  }
  // …and no `|| 'fallback'` on a contract id: a missing var has to fail the job.
  assert.equal(
    /CONTRACT_ID:[^\n]*\|\|/.test(ci),
    false,
    'ci.yml must not fall back to a contract id',
  );
  assert.ok(ci.includes('scripts/check-ci-contracts.mjs'), 'ci.yml should run the guard');
});
