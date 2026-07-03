# Ref-scoped history log — plan

**Spec:** `docs/superpowers/specs/2026-07-03-ref-scoped-log-design.md`
**Date:** 2026-07-03

## Steps

### 1. Backend

- `git/mod.rs`: `log` / `log_filtered` signatures gain `refspec: Option<&str>`.
- `git/libgit2.rs`: add `push_log_start` helper (HEAD when `None`, revspec →
  peel-to-commit when `Some`, `InvalidRef` on failure, `Ok(false)` on unborn
  HEAD); rewire both walks through it.
- `git/cli.rs`: update stub signatures (`NotImplemented`, unchanged).
- `commands/commits.rs`: `get_log` / `get_log_filtered` accept
  `refspec: Option<String>`. Same command names → `lib.rs` registry unchanged.
- Mechanical: update `.log(&id, N)` / `.log_filtered(...)` call sites in
  `src-tauri/tests/*.rs` to pass `None`.

### 2. Rust integration tests

New `src-tauri/tests/log_ref.rs` (TempRepo fixture):
- branch-scoped log returns the unmerged branch's commit; HEAD log does not.
- `None` refspec == HEAD log.
- tag and oid revspecs work as start points.
- unresolvable refspec → `AppError::InvalidRef`.
- `log_filtered` with refspec only matches within the scoped walk.

### 3. Frontend plumbing

- `lib/tauri.ts`: `getLog(repoId, limit, refspec?)`,
  `getLogFiltered(repoId, filter, limit, refspec?)`.
- `useRepoStore`: `logRef: string | null` state, `setLogRef(refspec)` action
  (stale-response guard, re-run active search), thread `logRef` through
  `refreshAll` + `searchCommits`, reset in `openRepo`/`closeRepo`.

### 4. History UI

- `PGSelect`: thread optional `data-testid` to the native `<select>`.
- History toolbar: ref selector (`HEAD` + local branches) bound to
  `logRef`/`setLogRef`, `data-testid="history-ref-select"`.

### 5. E2E

- Unskip cherry-pick test in `e2e/specs/history-ops.e2e.ts`; drive the ref
  selector (`selectByAttribute` on the testid'd `<select>`), wait for the
  feature commit row, cherry-pick via detail action row, assert repo truth
  (`git log -1`, file content, still on `main`).

### 6. Verify

- `pnpm tsc --noEmit`, `pnpm test`,
  `cargo test --manifest-path src-tauri/Cargo.toml`,
  `pnpm exec tsc -p e2e/tsconfig.json --noEmit`.
- E2E deferred to CI (port 4445 owned by a parallel session locally).

## Done when

Acceptance in the spec holds: unmerged-branch commit viewable + cherry-pickable
from the UI, e2e test unskipped and green in CI, default log behavior unchanged.
