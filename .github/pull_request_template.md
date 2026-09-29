## Description

<!-- Brief description of the changes. Link to related issue if applicable. -->

## Type of Change

- [ ] feat: new feature
- [ ] fix: bug fix
- [ ] docs: documentation
- [ ] refactor: code restructuring
- [ ] test: test additions/fixes
- [ ] chore: tooling, deps, CI

## Belt / Sprint Context

<!-- Which belt or sprint does this relate to? -->

## Testing

- [ ] `pnpm check` passes (the same gates as the CI `contracts` and `web` jobs):
  - `cargo fmt --all -- --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (in `contracts/`)
  - `pnpm typecheck` (`tsc --noEmit` and `tsc --noEmit -p tsconfig.test.json`), `pnpm lint` (ESLint via `next lint`), `pnpm test` (`vitest run`)
- [ ] UI change: `pnpm --dir apps/web e2e:smoke` passes (the CI `web-e2e` job)

## Screenshots (if UI change)

<!-- Add screenshots to show visual changes -->

## Checklist

- [ ] My code follows the project's code style
- [ ] I've updated documentation as needed

