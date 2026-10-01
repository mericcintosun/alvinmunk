/**
 * Offline tests for scripts/pnpm-audit-gate.mjs. Pure-function tests import the module
 * directly (no `pnpm audit` call, no process.exit — guarded behind the entry-point check);
 * the CLI itself is exercised end-to-end via PNPM_AUDIT_JSON_FILE, which substitutes a canned
 * `pnpm audit --json` fixture for the real shell-out.
 *
 * Usage: node --test scripts/pnpm-audit-gate.test.mjs   (after `pnpm install`)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gate, parseAdvisories, loadAllowlist } from './pnpm-audit-gate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'pnpm-audit-gate.mjs');
const REAL_ALLOWLIST = join(HERE, '..', 'security', 'pnpm-audit-allowlist.json');

const advisory = (over) => ({
  id: 1, ghsa: 'GHSA-aaaa-bbbb-cccc', severity: 'high', title: 'x', module: 'x', cves: [], ...over,
});

const auditJson = (advisories) =>
  JSON.stringify({
    advisories: Object.fromEntries(
      advisories.map((a, i) => [
        a.id ?? i,
        {
          id: a.id ?? i,
          github_advisory_id: a.ghsa,
          severity: a.severity,
          title: a.title,
          module_name: a.module,
          cves: a.cves ?? [],
        },
      ]),
    ),
  });

function tmpFile(name, contents) {
  const dir = mkdtempSync(join(tmpdir(), 'pnpm-audit-gate-'));
  const path = join(dir, name);
  writeFileSync(path, contents);
  return path;
}

test('parseAdvisories reads id/ghsa/severity/cves off the pnpm audit --json shape', () => {
  const json = auditJson([advisory({ ghsa: 'GHSA-x', severity: 'critical', cves: ['CVE-1'] })]);
  const [a] = parseAdvisories(json);
  assert.equal(a.ghsa, 'GHSA-x');
  assert.equal(a.severity, 'critical');
  assert.deepEqual(a.cves, ['CVE-1']);
});

test('parseAdvisories tolerates an advisory with no CVE assigned (cves: [])', () => {
  const json = auditJson([advisory({ ghsa: 'GHSA-no-cve', cves: [] })]);
  assert.deepEqual(parseAdvisories(json)[0].cves, []);
});

test('gate: an allowlisted GHSA never fails the gate, at any severity', () => {
  const advisories = [advisory({ ghsa: 'GHSA-allowed', severity: 'critical' })];
  const allowlist = { 'GHSA-allowed': { reason: 'known, tracked', added: '2026-01-01' } };
  const { allowed, failing } = gate(advisories, allowlist, 'critical');
  assert.equal(allowed.length, 1);
  assert.equal(failing.length, 0);
});

test('gate: a non-allowlisted advisory at or above the threshold fails the gate', () => {
  const advisories = [advisory({ ghsa: 'GHSA-new', severity: 'critical' })];
  const { failing } = gate(advisories, {}, 'critical');
  assert.equal(failing.length, 1);
  assert.equal(failing[0].ghsa, 'GHSA-new');
});

test('gate: severity strictly below the threshold passes even when not allowlisted', () => {
  const advisories = [advisory({ severity: 'high' })];
  const { failing } = gate(advisories, {}, 'critical');
  assert.equal(failing.length, 0);
});

test('gate: an advisory with no GHSA id (null) can never match an allowlist entry', () => {
  const advisories = [advisory({ ghsa: null, severity: 'critical' })];
  const { allowed, failing } = gate(advisories, { 'GHSA-something': { reason: 'x', added: '2026-01-01' } }, 'critical');
  assert.equal(allowed.length, 0);
  assert.equal(failing.length, 1);
});

test('gate: an unknown level throws instead of silently allowing everything through', () => {
  assert.throws(() => gate([advisory()], {}, 'yolo'), /unknown level/);
});

test('loadAllowlist rejects an entry missing "reason" or "added"', () => {
  const path = tmpFile('bad-allowlist.json', JSON.stringify({ 'GHSA-x': { reason: 'only a reason' } }));
  assert.throws(() => loadAllowlist(path), /needs a "reason" and "added" date/);
});

test('loadAllowlist accepts a well-formed allowlist', () => {
  const path = tmpFile(
    'good-allowlist.json',
    JSON.stringify({ 'GHSA-x': { reason: 'tracked', issue: 'https://example.com/1', added: '2026-01-01' } }),
  );
  const loaded = loadAllowlist(path);
  assert.equal(loaded['GHSA-x'].reason, 'tracked');
});

test('the real security/pnpm-audit-allowlist.json is well-formed and every entry has a reason + date', () => {
  const loaded = loadAllowlist(REAL_ALLOWLIST);
  assert.ok(Object.keys(loaded).length > 0, 'expected at least the two known next@14 critical advisories');
  for (const [ghsa, entry] of Object.entries(loaded)) {
    assert.match(ghsa, /^GHSA-/);
    assert.ok(entry.reason.length > 10, `${ghsa} reason is too short to be meaningful`);
    assert.match(entry.added, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('CLI: exits 0 and reports "ALLOWED" when every critical advisory is allowlisted', () => {
  const jsonFile = tmpFile(
    'audit-allowed.json',
    auditJson([advisory({ ghsa: 'GHSA-p293-qw3h-jr36', severity: 'critical' })]),
  );
  const res = spawnSync('node', [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, PNPM_AUDIT_JSON_FILE: jsonFile },
  });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /ALLOWED\s+\[critical\] GHSA-p293-qw3h-jr36/);
});

test('CLI: exits 1 and names the offender when a new, non-allowlisted critical advisory appears', () => {
  const jsonFile = tmpFile(
    'audit-new-critical.json',
    auditJson([advisory({ ghsa: 'GHSA-brand-new-0000', severity: 'critical', title: 'made up for the test' })]),
  );
  const res = spawnSync('node', [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, PNPM_AUDIT_JSON_FILE: jsonFile },
  });
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stdout, /FAILING\s+\[critical\] GHSA-brand-new-0000/);
  assert.match(res.stderr, /pnpm audit gate failed/);
});

test('CLI: --level high fails on a high-severity advisory that --level critical would let through', () => {
  const jsonFile = tmpFile('audit-high.json', auditJson([advisory({ ghsa: 'GHSA-high-only', severity: 'high' })]));
  const critical = spawnSync('node', [SCRIPT, '--level', 'critical'], {
    encoding: 'utf8',
    env: { ...process.env, PNPM_AUDIT_JSON_FILE: jsonFile },
  });
  const high = spawnSync('node', [SCRIPT, '--level', 'high'], {
    encoding: 'utf8',
    env: { ...process.env, PNPM_AUDIT_JSON_FILE: jsonFile },
  });
  assert.equal(critical.status, 0, critical.stdout + critical.stderr);
  assert.equal(high.status, 1, high.stdout + high.stderr);
});
