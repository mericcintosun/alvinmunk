/**
 * Gate for `pnpm audit`, used by the CI `security` job instead of the bare command.
 *
 * pnpm's own suppression knob (`pnpm.auditConfig.ignoreCves` in package.json) only matches an
 * advisory that carries a CVE id — an advisory with none (e.g. GHSA-2xp9-vwfh-vxw4 below) can
 * never be matched by it, in this pnpm version, no matter what's configured. A documented
 * allowlist keyed by GHSA id (security/pnpm-audit-allowlist.json) is the only way to suppress a
 * specific, already-triaged advisory while still failing on anything new — see
 * docs/SECURITY_AUDIT_POLICY.md.
 *
 * Every advisory is printed either way (allowed or failing), so an allowlisted finding is never
 * silently invisible. CI fails iff a *non*-allowlisted advisory is at or above --level.
 *
 * Usage: node scripts/pnpm-audit-gate.mjs [--level critical|high|moderate|low] [--prod]
 * Test override: set PNPM_AUDIT_JSON_FILE to a file of canned `pnpm audit --json` output
 * instead of actually running pnpm (see pnpm-audit-gate.test.mjs).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ALLOWLIST_PATH = join(HERE, '..', 'security', 'pnpm-audit-allowlist.json');
const LEVELS = ['low', 'moderate', 'high', 'critical'];

/** `pnpm audit --json` -> a flat advisory list. pnpm exits non-zero the moment it finds any
 * vulnerability (even low), so callers must read stdout from the failed run, not throw on it. */
export function parseAdvisories(json) {
  const report = JSON.parse(json);
  return Object.values(report.advisories ?? {}).map((a) => ({
    id: a.id,
    ghsa: a.github_advisory_id ?? null,
    severity: a.severity,
    title: a.title,
    module: a.module_name,
    cves: a.cves ?? [],
  }));
}

/** Load + validate the allowlist: { "<GHSA id>": { reason, issue, added } }. Every entry must
 * carry a reason and a date — an undocumented exception defeats the point of the gate. */
export function loadAllowlist(path = ALLOWLIST_PATH) {
  const entries = JSON.parse(readFileSync(path, 'utf8'));
  for (const [ghsa, entry] of Object.entries(entries)) {
    if (!entry.reason || !entry.added) {
      throw new Error(`security/pnpm-audit-allowlist.json: ${ghsa} needs a "reason" and "added" date`);
    }
  }
  return entries;
}

/** The gate's decision: `failing` is what should make CI red — everything at or above `level`
 * whose GHSA id isn't in `allowlist`. `allowed` is printed too, so nothing is silently hidden. */
export function gate(advisories, allowlist, level = 'critical') {
  const threshold = LEVELS.indexOf(level);
  if (threshold < 0) throw new Error(`unknown level "${level}" (want one of ${LEVELS.join(', ')})`);
  const allowed = [];
  const failing = [];
  for (const adv of advisories) {
    if (adv.ghsa && allowlist[adv.ghsa]) {
      allowed.push(adv);
    } else if (LEVELS.indexOf(adv.severity) >= threshold) {
      failing.push(adv);
    }
  }
  return { allowed, failing };
}

function readAuditJson(prod) {
  const jsonFile = process.env.PNPM_AUDIT_JSON_FILE;
  if (jsonFile) return readFileSync(jsonFile, 'utf8');
  const args = ['audit', '--json', ...(prod ? ['--prod'] : [])];
  try {
    return execFileSync('pnpm', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (err) {
    // pnpm audit's non-zero exit on ANY finding is expected — the JSON report is still on stdout.
    if (err.stdout) return err.stdout;
    throw err;
  }
}

function main() {
  const args = process.argv.slice(2);
  const levelIdx = args.indexOf('--level');
  const level = levelIdx >= 0 ? args[levelIdx + 1] : 'critical';
  const prod = args.includes('--prod');

  const advisories = parseAdvisories(readAuditJson(prod));
  const allowlist = loadAllowlist();
  const { allowed, failing } = gate(advisories, allowlist, level);

  for (const a of allowed) {
    console.log(`ALLOWED  [${a.severity}] ${a.ghsa} ${a.title} — ${allowlist[a.ghsa].reason}`);
  }
  for (const a of failing) {
    console.log(`FAILING  [${a.severity}] ${a.ghsa ?? a.id} ${a.title} (${a.module})`);
  }
  console.log(
    `\n${advisories.length} advisorie(s) total, ${allowed.length} allowlisted, ${failing.length} at or above "${level}".`,
  );

  if (failing.length > 0) {
    console.error(
      `\npnpm audit gate failed: ${failing.length} advisory(ies) at or above "${level}" are not in security/pnpm-audit-allowlist.json.`,
    );
    process.exit(1);
  }
}

// Only run when invoked directly (`node scripts/pnpm-audit-gate.mjs`) — importing the module
// for its pure functions (pnpm-audit-gate.test.mjs) must not shell out or call process.exit.
if (import.meta.url === `file://${process.argv[1]}`) main();
