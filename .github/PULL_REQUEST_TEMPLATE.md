<!-- Thanks for contributing to platypusgit! -->

## What does this PR do?

<!-- Brief description of the change. Link any related issue: Closes #123 -->

## Why?

<!-- Context / motivation for non-obvious decisions. -->

## Checklist

- [ ] One logical change, focused PR
- [ ] Branched off `main`; no merge commits on the branch (we **squash and merge**, and `main` requires linear history)
- [ ] PR title + commit messages follow Conventional Commits (`feat(scope): …`) — the PR title becomes the squash commit message on `main`
- [ ] `pnpm tsc --noEmit` passes
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` passes
- [ ] `pnpm test` passes
- [ ] Added/updated tests for the change
- [ ] If a new git op: trait + impl + command + handler registration + TS type/wrapper wired (see CONTRIBUTING.md)
- [ ] If a new feature: spec + plan added under `docs/superpowers/`
