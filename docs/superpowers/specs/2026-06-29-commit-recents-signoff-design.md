# Recent commit message dropdown + sign-off toggle — design

**Status:** approved
**Date:** 2026-06-29
**Owner:** jonas
**Related:** `docs/superpowers/specs/2026-04-22-platypusgit-write-path-phase1.md`

## Why

Two small but high-frequency frictions in the commit panel:

1. **Re-typing recurring messages.** Devs often repeat near-identical subjects
   ("wip", "fix lint", "address review") or want to riff off a prior commit's
   wording. The log is right there — surfacing recent messages as a one-click
   template removes retyping.
2. **Sign-off (`-s`).** DCO-gated projects require a `Signed-off-by:` trailer on
   every commit. Today the panel built this client-side from the *last commit's*
   author, which is wrong (sign-off should be the committer's own identity) and
   wasn't deduped. We want true `git commit -s` semantics, wired through the
   backend, with the preference remembered.

Both serve the "extreme usability" north star: less typing, fewer footguns.

## Scope

### In scope

- A "Recent" control in the commit-message composer that lists recent commit
  messages (newest-first, deduped). Selecting one fills subject + body.
- A "Sign-off" toggle that appends `Signed-off-by: Name <email>` using the
  repo's configured identity, matching `git commit -s` (no duplicate trailer).
- Persist the sign-off preference (reuse existing `addSignoff` setting).
- Wire sign-off through `CommitOptions` → libgit2 commit path (server-side
  trailer construction, not client string-munging).

### Out of scope

- A dedicated backend op for recent messages — reuse the already-loaded log.
- Author-only filtering / multi-author template grouping.
- Commit-message templates from `.gitmessage` / commit.template config.
- Trailer editing UI (Co-authored-by, etc.).

## Design

### Recent messages (frontend-only)

`useRepoStore.commits` already holds the loaded log. A pure helper
`recentCommitMessages(commits, limit)` derives the dropdown list:

- newest-first (log order), deduped by full message text,
- skips merge commits (`parents.length > 1`) and empty subjects,
- strips any existing `Signed-off-by:` trailer from the body so re-selecting a
  template doesn't carry a stale sign-off (the toggle re-adds on commit).

Surfaced via the existing `useContextMenu` primitive, opened from a "Recent"
button in the composer header. No backend change.

### Sign-off (`-s`) through the backend

- `CommitOptions` gains `signoff: bool` (`#[serde(default)]`).
- `Libgit2Backend::commit` resolves the committer signature from repo config and
  calls a pure helper `signature::apply_signoff(message, name, email)` which
  appends the trailer with `git commit -s` semantics: idempotent (no duplicate),
  blank-line separated from the body, joins an existing trailer block directly.
- The trailer always uses the committer identity even when `author_override` is
  set — mirrors git.
- The `commit` command takes an optional `signoff` arg; TS wrapper + store thread
  it through. The composer's toggle seeds from / writes back to the persisted
  `addSignoff` setting.

## Testing

- Rust unit tests on `apply_signoff` (subject-only, with body, dedupe, trailer
  block join, empty, trailing newlines).
- Rust integration tests against `TempRepo`: signoff appends from repo identity,
  no duplicate when already present, untouched when off.
- Frontend pure-logic test on `recentCommitMessages` (order, subject/body split,
  dedupe, trailer strip, merge skip, empty skip, limit).
