# Security Audit Policy

This document describes the automated security scanning policy for the alvinmunk project.

## Automated Checks

Security scans run automatically on:
- **Every PR and push** to ensure new code doesn't introduce vulnerabilities
- **Weekly schedule** (Mondays at 9:00 UTC) to catch newly published advisories

## Rust Contract Dependencies

### cargo-audit (RustSec Advisories)
Scans `contracts/Cargo.lock` against the [RustSec Advisory Database](https://rustsec.org/).

**Current threshold:** Fails on security vulnerabilities  
**Warnings allowed:** Unmaintained crates and yanked versions (reviewed manually)

### cargo-deny
Comprehensive policy enforcement covering:
- **Advisories:** Security vulnerabilities (deny), unmaintained crates (warn), yanked versions (deny)
- **Licenses:** Only permissive licenses allowed (MIT, Apache-2.0, BSD, Unicode-3.0, etc.)
- **Bans:** Prevents banned crates and warns on duplicate versions
- **Sources:** Restricts crates to crates.io registry

Configuration: `contracts/deny.toml`

## JavaScript/TypeScript Dependencies

### pnpm audit
Scans production npm dependencies for known vulnerabilities, via `node scripts/pnpm-audit-gate.mjs --prod --level critical` rather than the bare `pnpm audit` command.

**Current threshold:** `--level critical`
- Fails CI on any critical-severity advisory in production dependencies that is not in the allowlist below
- Lower severity issues are printed but don't fail the build

**Allowlist:** `security/pnpm-audit-allowlist.json` lists advisories (by GHSA id) that are known, triaged, and cannot be patched without out-of-scope work. Every entry requires a `reason` and an `added` date; the gate script prints every advisory either way (`ALLOWED` or `FAILING`), so a suppressed finding is never silently invisible. pnpm's own `pnpm.auditConfig.ignoreCves` (package.json) cannot be used for this: it only matches advisories that carry a CVE id, and at least one of the two current entries (GHSA-2xp9-vwfh-vxw4) has none.

Currently allowlisted: the two critical `next@14.2.35` RCE advisories (GHSA-p293-qw3h-jr36, GHSA-2xp9-vwfh-vxw4). Neither has a 14.x patch — the fix is the Next.js 14→15 upgrade tracked in [issue #255](https://github.com/mericcintosun/alvinmunk/issues/255), which is out of scope for CI/tooling work. Removing an entry (after the linked issue lands) requires no workflow change — the gate re-fails automatically the moment an entry is deleted or a *new* GHSA id starts matching that severity.

**Planned escalation:** After pending dependency upgrades land (issue #255 and others), tighten to `--level high`.

## Response Process

### When CI Fails

1. **Investigate the advisory:**
   - Review the CVE/advisory details
   - Assess impact on alvinmunk (does it affect our usage?)
   - Check for available patches or workarounds

2. **Remediate:**
   - **Preferred:** Update to patched version
   - **If no patch (Rust):** Document in `contracts/deny.toml`'s `[advisories.ignore]` list with a reason
   - **If no patch (npm):** Document in `security/pnpm-audit-allowlist.json` with a `reason`, an `issue` link and an `added` date — never suppress by lowering `--level` for one advisory

3. **Document:** Note the decision in git commit message and any relevant tracking issues

### Weekly Scan Results

Review the weekly scheduled scan results even if passing:
- New warnings may indicate dependencies requiring attention
- Plan updates for unmaintained dependencies

## Manual Security Review

Automated scans complement but don't replace:
- Code review focused on security
- The full security review documented in `docs/SECURITY_REVIEW.md`
- Pre-mainnet professional audit (see `docs/DEPLOY_MAINNET.md`)

## Policy Updates

This policy may be updated as the project matures:
- Tightening audit levels as dependencies stabilize
- Adding additional scanning tools
- Adjusting response procedures based on experience

Last updated: 2026-09-29
