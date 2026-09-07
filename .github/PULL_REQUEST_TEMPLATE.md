<!-- Thanks for contributing to platypusgit! -->

## What does this PR do?

<!-- Brief description of the change. Link any related issue: Closes #123 -->

## Why?

<!-- Context / motivation for non-obvious decisions. -->

## Checklist

- [ ] One logical change, focused PR
- [ ] Branched off `main`; no merge commits on the branch (we **rebase and merge**, and `main` requires linear history)
- [ ] PR title + every commit message follow Conventional Commits (`feat(scope): …`) — each commit is replayed onto `main` as written, so `git rebase -i main` first to fold fixups and drop `wip`
- [ ] `pnpm tsc --noEmit` passes
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` passes
- [ ] `pnpm test` passes
- [ ] If you touched `e2e/`: `pnpm exec tsc -p e2e/tsconfig.json --noEmit` passes (the root typecheck excludes `e2e/`)
- [ ] Added/updated tests for the change
- [ ] If a new git op: trait + impl + command + handler registration + TS type/wrapper wired (see CONTRIBUTING.md)
- [ ] If a new feature: spec + plan added under `docs/superpowers/`
