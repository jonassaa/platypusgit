# Recent commit message dropdown + sign-off toggle — plan

**Spec:** `docs/superpowers/specs/2026-06-29-commit-recents-signoff-design.md`
**Date:** 2026-06-29

## Steps

### 1. Sign-off helper (TDD, pure)
- Add `signature::apply_signoff(message, name, email) -> String` with unit tests
  covering: subject-only, body present, dedupe, existing-trailer-block join,
  empty message, trailing newlines.

### 2. Backend commit path
- Add `signoff: bool` (`#[serde(default)]`) to `CommitOptions` (`git/types.rs`).
- In `Libgit2Backend::commit`, when `signoff`, resolve committer signature from
  repo config and run `apply_signoff` over the message (both amend + normal
  paths). Author override does not affect the trailer identity.
- `CliBackend::commit` stub already takes `CommitOptions` → unchanged
  (still `NotImplemented`).
- Update the `commit` Tauri command to accept `signoff: Option<bool>` and
  populate `CommitOptions`.
- Update all `CommitOptions { … }` literals in tests/support with `signoff`.

### 3. Backend integration tests
- In `tests/stage_commit.rs`: signoff appends trailer from repo identity;
  no duplicate when already present; message untouched when off.

### 4. Frontend wiring
- `lib/tauri.ts` `commit(...)` gains `signoff = false`, passes to invoke.
- `useRepoStore.commit(message, amend?, signoff?)` threads it through.
- `recentCommitMessages` pure helper + colocated vitest test.
- `CommitPanel`: "Recent" button (uses `useContextMenu`) fills subject/body;
  sign-off checkbox seeds from / writes back `addSignoff`; drop client-side
  trailer construction in `buildMessage`; pass `signoff` to the commit action.

### 5. Verify
- `pnpm tsc --noEmit`, `pnpm test`, `pnpm vite build`,
  `cargo check`, `cargo test`.

## Done when
All five verification commands pass; sign-off produces a single correct trailer
sourced from repo identity; recent-message dropdown populates the composer.
