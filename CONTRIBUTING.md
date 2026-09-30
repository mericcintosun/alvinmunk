# Contributing to alvinmunk

Thanks for your interest in contributing! alvinmunk is a social proof-of-people reputation game on Stellar/Soroban.

## Quick Start

```bash
# Prerequisites: Node ≥20, pnpm 9, Rust stable + wasm32 target, Stellar CLI
pnpm install                          # install JS deps
pnpm contracts:build                  # build Soroban contracts (wasm32)
pnpm contracts:test                   # run Rust contract tests
pnpm typecheck && pnpm test           # TS typecheck + vitest
pnpm check                            # every gate the CI contracts + web jobs run
pnpm dev                              # start dev server (turbo → next dev)
```

## Project Structure

```
alvinmunk/
├── apps/web/          # Next.js 14 frontend
├── packages/shared/   # Shared TS types & utilities
├── packages/sdk/      # @alvinmunk/sdk, the publishable read-only client
├── contracts/         # Soroban Rust contracts (reputation, quest_registry, rewards, registry, gate)
├── belts/             # Strategy & belt roadmaps
├── docs/              # PRD, sprints, product docs
└── scripts/           # Deploy & utility scripts
```

## Development Workflow

1. **Branch**: `feat/`, `fix/`, `chore/` prefixed branches off `main`
2. **Commits**: Conventional commits preferred (`feat:`, `fix:`, `test:`, `docs:`, `chore:`)
3. **Code style**: Prettier (JS/TS, plus the JSON, YAML and Markdown files) + `cargo fmt` +
   `cargo clippy --all-targets -- -D warnings` (Rust). `pnpm format` rewrites every file Prettier
   covers (`.prettierrc`; `.prettierignore` lists what it skips) and `pnpm format:check` only
   reports them. Commits that only reformat go in `.git-blame-ignore-revs`: GitHub's blame skips
   them, and so does a local `git blame` after `git config blame.ignoreRevsFile .git-blame-ignore-revs`.
4. **Testing**: All tests must pass before PR — run `pnpm check`, which runs the same gates as the
   CI `contracts` and `web` jobs, in order:
   - `cargo fmt --all -- --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test` in `contracts/`
   - `pnpm typecheck` (`tsc --noEmit` and `tsc --noEmit -p tsconfig.test.json`), `pnpm lint` (ESLint via
     `next lint`) and `pnpm test` (`vitest run`) across the workspace

   The CI `web-e2e` job runs the Playwright smoke suite; for a UI change run it too:
   `pnpm --dir apps/web exec playwright install chromium && pnpm --dir apps/web e2e:smoke`

## Pull Request Process

1. Open a PR against `main` with a clear description
2. Reference related issues and belt/sprint context
3. Ensure CI passes (contract fmt/clippy/tests, web typecheck/lint/test and the e2e smoke)
4. Add screenshots for UI changes
5. Update docs and README if needed

## Contributing through Drips Wave

alvinmunk is an approved repository in the **Drips Wave** program (the Stellar Wave), where the
maintainer scopes real work into point-bountied issues and contributors are paid a share of the
Wave's reward pool in USDC. The program's own rules live in the
[Drips Wave docs](https://docs.drips.network/wave); this repo's Wave history — the 26 scoped
issues, the merged PRs, the submissions that were declined — is in
[`docs/ECOSYSTEM.md`](./docs/ECOSYSTEM.md).

A Wave contribution follows five steps: **find → claim → PR → review → points.**

### 1. Find: where the bountied issues live

Every Wave issue in this repo carries the **`Stellar Wave`** label, and the same issues are listed
under the Stellar Wave program in the [Drips Wave app](https://www.drips.network/wave), where you
apply for them.

- [Wave issues, all states](https://github.com/mericcintosun/alvinmunk/labels/Stellar%20Wave)
- [Open Wave issues](https://github.com/mericcintosun/alvinmunk/issues?q=is%3Aissue+is%3Aopen+label%3A%22Stellar+Wave%22)
- [All open issues](https://github.com/mericcintosun/alvinmunk/issues)

`Stellar Wave` is paired with the ordinary scope labels, so you can narrow the list:
`good first issue` (small and well-specified), `a11y`, `bug`, `enhancement`, `test`,
`documentation`, `contracts`, `frontend`, `security`, `ci`, `ops`, `tech-debt`. Unlabelled issues
are still welcome as PRs, but they carry no points.

Wave issues are written in a four-part shape — **Problem / Files / Fix / Acceptance criteria** —
and name the files they touch. Read all four before you apply. If the acceptance criteria can't be
checked from a diff, or the referenced files no longer exist, say so in your application or on the
issue: a stale issue needs re-scoping, not a guess.

### 2. Claim: apply, wait for assignment, one issue per person

1. **Set up your Wave account up front.** Sign in at [drips.network/wave](https://www.drips.network/wave)
   with GitHub and complete identity verification (KYC) under *Settings → Profile* — KYC is
   mandatory both to apply for an issue and to withdraw rewards, and usually takes a few minutes.
2. **Apply from the Wave app.** Find the issue in the Stellar Wave program and submit an
   application; the Drips Wave bot posts it as a comment on the GitHub issue. Two or three specific
   sentences — which files you'd touch and the shape of the fix — is enough. A generic "I'd like to
   work on this", a template with the blanks unfilled, or a copy-paste that doesn't mention this
   issue will not be picked.
3. **Wait for assignment before you write code.** The issue is yours once the maintainer accepts
   your application and you are assigned on GitHub; the bot comments with the due date.
4. **One active issue per person.** Apply for a second once the first is merged or released. If you
   drop one, comment on the issue so it can be reassigned rather than going quiet.
5. **Know the code before you claim it.** Read the issue, the files it names, and the surrounding
   code first. Don't claim something you can't realistically finish inside the Wave window.
6. **Link the PR to the issue.** Write `Closes #123` in the PR description. If the connection
   between PR and issue isn't obvious to a machine, the work may not be tracked and you may not be
   credited for it.

### 3. PR: what a mergeable Wave PR looks like

- **It fixes the issue, and only the issue.** No drive-by refactors, no renamed files, no
  reformatting the file next door, no re-locking the lockfile, no reordering imports across the
  repo. Keep the diff reviewable in one sitting.
- **`pnpm check` is green** — the same gates CI runs: `cargo fmt --all -- --check`,
  `cargo clippy --all-targets -- -D warnings` and `cargo test` in `contracts/`, then `pnpm typecheck`,
  `pnpm lint` and `pnpm test` across the workspace. If you touched a UI surface, also
  `pnpm --dir apps/web e2e:smoke`.
- **Tests, in the same PR as the fix.** A bug fix ships with a test that fails without it; a
  feature ships with tests for its new behaviour. `main` is green across the contract and web
  suites, so the bar is that the count went up — not that it stayed the same.
- **Screenshots for anything visual, before and after.** For a11y and layout issues, the
  acceptance criteria are usually viewport- and theme-specific — say which widths and which theme
  you checked, and paste the shots in the PR body.
- **No bulk-generated diffs.** PRs that are machine-generated in bulk — across many files, many
  issues at once, reformats, dependency bumps, or a diff you cannot explain line by line — are
  closed, as are duplicates (see [`docs/ECOSYSTEM.md`](./docs/ECOSYSTEM.md)). The bar is that you
  can defend every line in your diff in the review. AI as a typing aid is fine; AI
  as a substitute for reading the issue is not.
- **Conventional commits**, one logical change per PR: `feat(web): …`, `fix(contracts): …`,
  `test(registry): …`, `docs: …`.

### 4. Review: what to expect

- **Claims:** the maintainer responds on the issue. If nothing happens for **24–48 hours**, a short
  polite follow-up is fine — pinging after a few hours is not. Drips' own
  [contributor guide](https://www.drips.network/blog/posts/your-guide-to-contributing-well-in-wave)
  says the same: stay in the loop, but don't spam or demand an instant reply.
- **PRs:** the maintainer aims to review within the Wave window. The first cohort
  ([#29](https://github.com/mericcintosun/alvinmunk/pull/29)–[#43](https://github.com/mericcintosun/alvinmunk/pull/43))
  went from open to merge in a median of about four hours, the slowest in about thirteen. A round of
  requested changes is normal, not a rejection, and the maintainer may push follow-up commits
  (tests, translations, scope trims) to your branch before merging — the PR is still yours.
- **While you wait:** stay on the issue or PR, answer questions there, and push a fixup commit
  rather than force-pushing a rewrite. If you get blocked or can't finish, say so — an issue
  blocked by something outside your control is something the maintainer can resolve, and silence is
  what gets a claim reassigned.
- **Getting stuck:** ask on the issue or PR for anything about the code. For Wave questions, use
  the 🎫 *tickets* channel on the [Drips Discord](https://discord.gg/BakDKKDpHF); for KYC, rewards
  or account access, use [Drips Wave support](https://www.drips.network/wave/support).

### 5. Points: how you get paid

- **Points are per issue, set by the issue's complexity**, and are awarded when the maintainer
  marks the issue **resolved** after your PR is merged:

  | Complexity | Base | Complexity bonus | Total |
  | --- | --- | --- | --- |
  | Trivial | 100 | — | **100** |
  | Medium | 100 | +50 | **150** |
  | High | 100 | +100 | **200** |

- **Points are shares, not dollars.** Your payout is your share of the Wave's total reward pool,
  so it moves with how many people participated. More issues, and higher-complexity ones, move it
  most. There is no fixed dollar amount per issue.
- **The Wave is a strict timebox.** If the issue isn't resolved before the Wave closes, that cycle
  awards nothing — the issue carries over to the next one, it isn't lost. Talk to the maintainer
  early if you're close.
- **Cash out in USDC on Stellar.** After the Wave ends and the compliment window closes, your
  points are converted into reward grants you withdraw from **Wave → Reward Grants** in
  [the Wave app](https://www.drips.network/wave) — to a Stellar wallet with a Circle-issued USDC
  trustline. Request the $1 test transaction first. KYC must be approved before you can withdraw.
- **Full rules:** [Understanding Points & Rewards](https://docs.drips.network/wave/points-and-rewards),
  [Solving issues & earning rewards](https://docs.drips.network/wave/contributors/solving-issues-and-earning-rewards),
  and the [Terms and Rules](https://docs.drips.network/wave/terms-and-rules). The program reserves
  the right to adjust the formula or withhold rewards for misbehaviour, and rules can differ per
  Wave — the docs are authoritative, this section is the short version.

## Contract Development

- Run `cd contracts && cargo test` for contract tests
- Run `cd contracts && cargo clippy --all-targets -- -D warnings` before committing
- The live testnet contract ids are in the [README](README.md#deployed-contracts-stellar-testnet)
- Use `scripts/deploy-testnet.sh` for fresh deploys

## Gotchas

- **zsh doesn't word-split** an unquoted `$VAR`, so `--network testnet` kept in a variable reaches
  the CLI as one argument. Write flags literally, or expand with `${=VAR}`.
- **`stellar contract build` writes to `target/wasm32v1-none/release/`**, not
  `wasm32-unknown-unknown`.
- **`node -e` / scripts run from the repo root can't resolve app deps** (pnpm doesn't hoist):
  set `NODE_PATH="$PWD/apps/web/node_modules"`.
- **`symbol_short!` takes at most 9 characters**; use `Symbol::new(&env, "...")` for longer ones.
- **Cross-contract call args:** build the `Vec<Val>` with `.into_val(&env)` (a `u64` has no
  `From<u64>` for `Val`).
- **`@stellar/stellar-sdk` must be ≥ 16** for protocol 23; older versions fail to decode tx results
  (`Bad union switch: 4`).

## Questions?

Open an issue or refer to `belts/00-strategy.md` for architectural context.

