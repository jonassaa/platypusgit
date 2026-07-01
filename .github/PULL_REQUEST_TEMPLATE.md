<!-- Thanks for contributing to platypusgit! -->

## What does this PR do?

<!-- Brief description of the change. Link any related issue: Closes #123 -->

## Why?

<!-- Context / motivation for non-obvious decisions. -->

## Checklist

- [ ] One logical change, focused PR
- [ ] Branched off `main`; rebased onto latest `main` (PR is **squash-merged** into one commit)
- [ ] PR title follows Conventional Commits (`feat(scope): …`) — it becomes the squash commit message
- [ ] `pnpm tsc --noEmit` passes
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` passes
- [ ] `pnpm test` passes
- [ ] Added/updated tests for the change
- [ ] If a new git op: trait + impl + command + handler registration + TS type/wrapper wired (see CONTRIBUTING.md)
- [ ] If a new feature: spec + plan added under `docs/superpowers/`
