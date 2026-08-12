# Commit Graph v2 — Phase 5 (scale) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make history past the first 500 commits reachable — paginate the log walk with a resumable cursor, append pages in the store, and load the next page as the user scrolls.

**Architecture:** The cursor is the walk **frontier** — the set of every awaited parent — not a single oid, because at a page boundary a single oid drops every branch but one. The frontier is computed server-side while emitting, O(page). `log` and `log_filtered` become thin wrappers over the paginated walk with `cursor: None`, so all four existing call sites and both existing commands keep working untouched while the cursor path is added alongside.

**Tech Stack:** Rust + git2 (libgit2), Tauri commands, TypeScript/Zustand frontend, Vitest + `cargo test`.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-11-commit-graph-v2-design.md`, "Phase 5". Issue #68 G11.
- **Toolchain:** prepend `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"`.
- **This is the one phase that touches Rust.** Every IPC-crossing fn returns `AppResult<T>`; no `unwrap`/`panic` in commands; git2 work goes in `spawn_blocking`. Add `AppError` variants rather than stringifying.
- **`src/lib/types.ts` stays 1:1 with `src-tauri/src/git/types.rs` in the same commit.** New Rust type → new TS type, same commit.
- **Register every new command** in `invoke_handler![…]` (`src-tauri/src/lib.rs`) or it is unreachable at runtime.
- **Stub new trait methods in `CliBackend`** (`git/cli.rs`) with `NotImplemented` — it is never instantiated, but the trait shape stays exercised.
- **Verify e2e with Docker, never native** (`pnpm test:e2e:docker`).
- **Read the log, not the exit code, for Docker e2e runs** — the wrapper has reported exit 0 on a build that failed with `error TS2339`.
- **Run `pnpm tsc --noEmit` after writing any new test file**, not only after source edits. A type error in a `.test.tsx` breaks `pnpm build` and therefore the e2e binary build.
- **Gate per task:** `cargo test` (Rust tasks) or `pnpm test` + `pnpm tsc --noEmit` (TS tasks), clean before committing.

## Why a single-oid cursor is wrong (the core design point)

Resuming "after commit X" assumes the walk is a line. It isn't. With `Sort::TIME | TOPOLOGICAL`, at the moment page 1 ends there are typically several lanes alive, each awaiting a different parent. Those awaited parents *are* the resume points — collectively. Push only the last emitted commit's parent and every other branch silently vanishes from page 2 onward, which reads as "those commits don't exist" rather than as a bug.

So: `frontier = { p : p is a parent of some emitted commit, p ∉ emitted }`, and continuation pushes **every** frontier oid (revwalk accepts multiple pushes).

**Why this cannot double-emit.** `Sort::TOPOLOGICAL` guarantees children before parents. A frontier oid F was not emitted, and every ancestor of F sorts after F, so no ancestor of F can have been emitted either. Page 2 is therefore disjoint from page 1. Task 2 asserts this rather than assuming it.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src-tauri/src/git/types.rs` | `LogPage { commits, next_cursor }` | modify |
| `src-tauri/src/git/mod.rs` | `log_page` / `log_filtered_page` on the trait | modify |
| `src-tauri/src/git/libgit2.rs` | Paginated walk + frontier; `log`/`log_filtered` become wrappers | modify |
| `src-tauri/src/git/cli.rs` | `NotImplemented` stubs | modify |
| `src-tauri/src/commands/commits.rs` | `get_log_page`, `get_log_filtered_page` | modify |
| `src-tauri/src/lib.rs` | Register both commands | modify |
| `src-tauri/tests/log_pagination.rs` | Frontier correctness across branches | **create** |
| `src/lib/types.ts` | `LogPage` mirror | modify |
| `src/lib/tauri.ts` | `getLogPage`, `getLogFilteredPage` | modify |
| `src/features/repo/useRepoStore.ts` | `PAGE_SIZE`, cursor state, `loadMoreCommits` | modify |
| `src/screens/History.tsx` | Load-more on scroll + end-of-history affordance | modify |

---

### Task 1: `LogPage` type and the trait surface

**Files:** `types.rs`, `mod.rs`, `cli.rs`, `src/lib/types.ts`

**Interfaces produced:**
```rust
pub struct LogPage { pub commits: Vec<CommitInfo>, pub next_cursor: Option<Vec<String>> }
fn log_page(&self, repo_id: &RepoId, refspec: Option<&str>, cursor: Option<&[String]>, limit: usize) -> AppResult<LogPage>;
fn log_filtered_page(&self, repo_id: &RepoId, filter: &LogFilter, refspec: Option<&str>, cursor: Option<&[String]>, limit: usize) -> AppResult<LogPage>;
```

- [ ] **Step 1: Add the type.** In `types.rs`, next to `CommitInfo`, matching the file's existing serde attributes (it renames to camelCase — check the neighbours and copy exactly):

```rust
/// One page of a resumable log walk.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogPage {
    pub commits: Vec<CommitInfo>,
    /// Frontier oids to resume from — every parent awaited when the page ended.
    /// `None` means the walk reached the true end of history.
    ///
    /// A SET, not a single oid: at a page boundary several lanes are alive,
    /// each awaiting a different parent, so resuming from just the last emitted
    /// commit would silently drop every other branch.
    pub next_cursor: Option<Vec<String>>,
}
```

- [ ] **Step 2: Add both methods to the `GitBackend` trait** (`mod.rs`), with doc comments stating that `refspec` is ignored when `cursor` is `Some` (the cursor supplies the walk start).

- [ ] **Step 3: Stub in `CliBackend`** (`cli.rs`), returning `Err(AppError::NotImplemented(...))` in the same style as its neighbours.

- [ ] **Step 4: Mirror in `src/lib/types.ts`** — same commit, per the repo convention:

```ts
export interface LogPage {
  commits: CommitInfo[];
  /** Frontier oids to resume from; null at the true end of history. */
  nextCursor: string[] | null;
}
```

- [ ] **Step 5:** `cargo check --manifest-path src-tauri/Cargo.toml` and `pnpm tsc --noEmit`, then commit: `feat(log): LogPage type and paginated walk trait methods (#68 G11)`.

---

### Task 2: Paginated unfiltered walk + frontier

**Files:** `src-tauri/src/git/libgit2.rs`; test `src-tauri/tests/log_pagination.rs`

- [ ] **Step 1: Write the failing test** (`src-tauri/tests/log_pagination.rs`):

```rust
mod support;

use platypusgit_lib::git::GitBackend;
use support::{linear_history, TempRepo};

/// Walk the whole history one small page at a time.
fn drain(be: &impl GitBackend, id: &platypusgit_lib::git::types::RepoId, page: usize)
    -> Vec<String>
{
    let mut out = Vec::new();
    let mut cursor: Option<Vec<String>> = None;
    loop {
        let p = be.log_page(id, None, cursor.as_deref(), page).unwrap();
        out.extend(p.commits.iter().map(|c| c.oid.clone()));
        match p.next_cursor {
            Some(c) => cursor = Some(c),
            None => break,
        }
        assert!(out.len() < 10_000, "pagination did not terminate");
    }
    out
}

#[test]
fn pages_cover_linear_history_exactly_once() {
    let tr = TempRepo::with_initial_commit("hi\n");
    linear_history(&tr, 9); // 10 commits total
    let (be, h) = tr.open_with_backend();

    let all = be.log(&h.id, None, 1000).unwrap();
    let paged = drain(&be, &h.id, 3);

    let expected: Vec<String> = all.iter().map(|c| c.oid.clone()).collect();
    assert_eq!(paged, expected, "paged walk must equal the single-shot walk");
}

#[test]
fn no_commit_is_emitted_twice_across_pages() {
    let tr = TempRepo::with_initial_commit("hi\n");
    linear_history(&tr, 9);
    let (be, h) = tr.open_with_backend();

    let paged = drain(&be, &h.id, 2);
    let mut sorted = paged.clone();
    sorted.sort();
    sorted.dedup();
    assert_eq!(sorted.len(), paged.len(), "pages overlapped");
}

#[test]
fn a_merge_keeps_both_branches_alive_across_a_page_boundary() {
    // THE bug a single-oid cursor causes: page 1 ends mid-merge with two lanes
    // awaiting different parents; a scalar cursor drops one side entirely.
    let tr = support::with_conflicting_merge(); // branchy, both sides present
    let (be, h) = tr.open_with_backend();

    let all = be.log(&h.id, None, 1000).unwrap();
    let paged = drain(&be, &h.id, 2);

    let expected: Vec<String> = all.iter().map(|c| c.oid.clone()).collect();
    assert_eq!(
        paged.len(),
        expected.len(),
        "a branch was dropped at a page boundary",
    );
    assert_eq!(paged, expected);
}

#[test]
fn the_last_page_reports_no_cursor() {
    let tr = TempRepo::with_initial_commit("hi\n");
    linear_history(&tr, 2);
    let (be, h) = tr.open_with_backend();

    let p = be.log_page(&h.id, None, None, 1000).unwrap();
    assert!(p.next_cursor.is_none(), "end of history must not offer a cursor");
}

#[test]
fn a_full_page_at_the_exact_end_still_reports_no_cursor() {
    // limit == remaining commits: the walk is exhausted, so there is no
    // frontier even though the page came back full.
    let tr = TempRepo::with_initial_commit("hi\n");
    linear_history(&tr, 2); // 3 commits
    let (be, h) = tr.open_with_backend();

    let p = be.log_page(&h.id, None, None, 3).unwrap();
    assert_eq!(p.commits.len(), 3);
    assert!(p.next_cursor.is_none());
}

#[test]
fn an_unborn_head_pages_to_nothing() {
    let tr = TempRepo::fresh();
    let (be, h) = tr.open_with_backend();
    let p = be.log_page(&h.id, None, None, 10).unwrap();
    assert!(p.commits.is_empty());
    assert!(p.next_cursor.is_none());
}
```

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test log_pagination`
Expected: FAIL to compile — `log_page` has no implementation on `Libgit2Backend` yet.

- [ ] **Step 2: Implement `log_page`** in `libgit2.rs`, replacing the body of `log` (which becomes a wrapper in Step 3):

```rust
    fn log_page(
        &self,
        repo_id: &RepoId,
        refspec: Option<&str>,
        cursor: Option<&[String]>,
        limit: usize,
    ) -> AppResult<LogPage> {
        self.with_repo(repo_id, |repo| {
            let ref_map = collect_ref_map(repo);
            let mut walk = repo.revwalk()?;
            walk.set_sorting(Sort::TIME | Sort::TOPOLOGICAL)?;

            match cursor {
                // Continuation: the frontier IS the start set. `refspec` is
                // ignored here by design — the cursor already encodes where
                // this walk came from.
                Some(frontier) if !frontier.is_empty() => {
                    let mut pushed = false;
                    for raw in frontier {
                        let oid = git2::Oid::from_str(raw)
                            .map_err(|_| AppError::InvalidRef(raw.clone()))?;
                        // A parent can be absent in a shallow/grafted repo.
                        // Skip it rather than failing the whole page.
                        if repo.find_commit(oid).is_ok() {
                            walk.push(oid)?;
                            pushed = true;
                        }
                    }
                    if !pushed {
                        return Ok(LogPage { commits: Vec::new(), next_cursor: None });
                    }
                }
                _ => {
                    if !push_log_start(repo, &mut walk, refspec)? {
                        return Ok(LogPage { commits: Vec::new(), next_cursor: None });
                    }
                }
            }

            let mut out = Vec::with_capacity(limit.min(4096));
            let mut emitted: std::collections::HashSet<git2::Oid> =
                std::collections::HashSet::with_capacity(limit.min(4096));
            for oid in walk.by_ref().take(limit) {
                let oid = oid?;
                let commit = repo.find_commit(oid)?;
                let refs: Vec<String> = ref_map
                    .iter()
                    .filter(|(o, _)| *o == oid)
                    .map(|(_, name)| name.clone())
                    .collect();
                let mut info = commit_to_info(&commit);
                info.refs = refs;
                emitted.insert(oid);
                out.push(info);
            }

            Ok(LogPage {
                next_cursor: frontier_of(repo, &out, &emitted),
                commits: out,
            })
        })
    }
```

and the helper, next to `push_log_start`:

```rust
/// Parents of the emitted page that were not themselves emitted — the set the
/// next page resumes from. Empty ⟺ the walk reached the end of history, since
/// any unemitted parent is by definition more history.
fn frontier_of(
    repo: &Repository,
    page: &[CommitInfo],
    emitted: &std::collections::HashSet<git2::Oid>,
) -> Option<Vec<String>> {
    let mut seen = std::collections::HashSet::new();
    let mut frontier = Vec::new();
    for info in page {
        for p in &info.parents {
            let Ok(oid) = git2::Oid::from_str(p) else { continue };
            if emitted.contains(&oid) || !seen.insert(oid) {
                continue;
            }
            // Absent in a shallow clone → not a resumable frontier point.
            if repo.find_commit(oid).is_ok() {
                frontier.push(p.clone());
            }
        }
    }
    if frontier.is_empty() { None } else { Some(frontier) }
}
```

- [ ] **Step 3: Make `log` a wrapper**, so the existing command and its four call sites are untouched:

```rust
    fn log(
        &self,
        repo_id: &RepoId,
        refspec: Option<&str>,
        limit: usize,
    ) -> AppResult<Vec<CommitInfo>> {
        Ok(self.log_page(repo_id, refspec, None, limit)?.commits)
    }
```

- [ ] **Step 4:** `cargo test --manifest-path src-tauri/Cargo.toml` — the new file passes AND every existing log test still passes (that is what proves the wrapper is behaviour-preserving).

- [ ] **Step 5: Commit** `feat(log): resumable paginated log walk with a frontier cursor (#68 G11)`.

---

### Task 3: Paginated filtered walk

**Files:** `libgit2.rs`; append to `src-tauri/tests/log_pagination.rs`

**The difference from Task 2:** the filtered walk may visit thousands of commits to fill one page of *matches*, so the frontier must come from everything **visited**, not from the matches. Resuming from the matches' parents would skip every non-matching commit in between and lose their ancestors.

- [ ] **Step 1: Write the failing test**

```rust
#[test]
fn filtered_pages_cover_every_match_exactly_once() {
    use platypusgit_lib::git::types::LogFilter;
    let tr = TempRepo::with_initial_commit("hi\n");
    // 10 commits; only the even-numbered ones say "keep".
    for i in 0..10 {
        let msg = if i % 2 == 0 { format!("keep {i}") } else { format!("skip {i}") };
        tr.add_commit(&format!("f{i}.txt"), "x\n", &msg);
    }
    let (be, h) = tr.open_with_backend();
    let filter = LogFilter { message: Some("keep".into()), ..Default::default() };

    let all = be.log_filtered(&h.id, &filter, None, 1000).unwrap();

    let mut paged = Vec::new();
    let mut cursor: Option<Vec<String>> = None;
    loop {
        let p = be.log_filtered_page(&h.id, &filter, None, cursor.as_deref(), 2).unwrap();
        paged.extend(p.commits.iter().map(|c| c.oid.clone()));
        match p.next_cursor { Some(c) => cursor = Some(c), None => break }
        assert!(paged.len() < 1_000, "filtered pagination did not terminate");
    }

    let expected: Vec<String> = all.iter().map(|c| c.oid.clone()).collect();
    assert_eq!(paged, expected);
}
```

- [ ] **Step 2:** Run it — expected FAIL (no `log_filtered_page` impl).

- [ ] **Step 3: Implement.** Refactor the existing `log_filtered` body so the walk loop tracks a `visited: HashSet<Oid>` alongside the matches, breaks when `matches.len() == limit`, and returns `frontier_of(repo, &visited_infos, &visited)`. Concretely: keep the existing per-commit filter predicate exactly as-is (do not re-derive the matching rules — that is a behaviour change, not a refactor), and change only the accumulation:

- push matched `CommitInfo`s into `out` as today;
- insert **every** visited oid into `visited`, and keep a parallel `Vec<CommitInfo>` (or just the parent oid lists) of visited commits so `frontier_of` can read their parents;
- break the loop when `out.len() == limit`;
- frontier from the visited set.

Then `log_filtered` becomes `Ok(self.log_filtered_page(repo_id, filter, refspec, None, limit)?.commits)`.

- [ ] **Step 4:** `cargo test --manifest-path src-tauri/Cargo.toml` — all green, including the pre-existing filter tests.

- [ ] **Step 5: Commit** `feat(log): paginate the filtered walk from the visited frontier (#68 G11)`.

---

### Task 4: Commands, registry, and TS wrappers

**Files:** `commands/commits.rs`, `lib.rs`, `src/lib/tauri.ts`

- [ ] **Step 1:** Add both commands, mirroring the existing two (thin, `spawn_blocking`, `limit.unwrap_or(500)`):

```rust
#[tauri::command]
pub async fn get_log_page(
    state: State<'_, AppState>,
    repo_id: String,
    cursor: Option<Vec<String>>,
    limit: Option<usize>,
    refspec: Option<String>,
) -> AppResult<LogPage> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let limit = limit.unwrap_or(500);
    tokio::task::spawn_blocking(move || {
        backend.log_page(&repo_id, refspec.as_deref(), cursor.as_deref(), limit)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}
```

and the filtered twin.

- [ ] **Step 2:** Register both in `invoke_handler![…]` (`lib.rs`, next to `get_log` at `:111-112`). **A command absent from this list is unreachable at runtime with no compile error** — this step is not optional bookkeeping.

- [ ] **Step 3:** Add typed wrappers in `src/lib/tauri.ts` beside `getLog`/`getLogFiltered`, returning `Promise<LogPage>`.

- [ ] **Step 4:** `cargo check` + `pnpm tsc --noEmit`, then commit `feat(log): expose paginated log commands over IPC (#68 G11)`.

---

### Task 5: Store pages and `loadMoreCommits`

**Files:** `src/features/repo/useRepoStore.ts`; test `src/features/repo/useRepoStore.pagination.test.ts` (**create**)

- [ ] **Step 1: Write the failing test** — with `mockInvoke` per `src/test/setup.ts`, assert that: the first load stores page 1 and its cursor; `loadMoreCommits()` appends page 2 without duplicating page 1; when `nextCursor` is null `hasMoreCommits` goes false and a further `loadMoreCommits()` is a no-op (no IPC call); and a concurrent second call while one is in flight does not double-append.

- [ ] **Step 2:** Run — FAIL (no such action).

- [ ] **Step 3: Implement.** Replace the four hardcoded `500`s with one `const PAGE_SIZE = 500;`, add `commitCursor: string[] | null`, `hasMoreCommits: boolean`, `loadingMore: boolean`, and:

```ts
  async loadMoreCommits() {
    const { current, commitCursor, loadingMore } = get();
    // Guard re-entry: the History scroll handler can fire this many times
    // before the first page resolves.
    if (!current || !commitCursor || loadingMore) return;
    set({ loadingMore: true });
    try {
      const page = await getLogPage(current.id, commitCursor, PAGE_SIZE, get().logRef);
      set((s) => ({
        commits: [...s.commits, ...page.commits],
        commitCursor: page.nextCursor,
        hasMoreCommits: page.nextCursor !== null,
      }));
    } catch (e) {
      set({ error: appErrorMessage(e) });
    } finally {
      set({ loadingMore: false });
    }
  },
```

Every existing path that *replaces* `commits` (refresh, repo switch, ref change, search) must reset `commitCursor`/`hasMoreCommits` from that response, or "load more" would resume from a stale frontier belonging to a different walk. Set them wherever `commits:` is assigned.

- [ ] **Step 4:** `pnpm test` + `pnpm tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(log): page the commit log into the store (#68 G11)`.

---

### Task 6: Load-more in History + end-of-history affordance

**Files:** `src/screens/History.tsx`; test `src/screens/History.pagination.test.tsx` (**create**)

- [ ] **Step 1: Write the failing test** — a store primed with `hasMoreCommits: true` and a spy `loadMoreCommits`; assert it fires when the window reaches the end of the loaded list, and that it does **not** fire when `hasMoreCommits` is false.

- [ ] **Step 2:** Run — FAIL.

- [ ] **Step 3: Implement.** Trigger from the windowing state rather than a scroll listener — `win.end >= visible.length - OVERSCAN` is exactly "the user can see the bottom", and it composes with Phase 4's window instead of adding a second scroll source of truth:

```tsx
  React.useEffect(() => {
    if (!hasMoreCommits || loadingMore) return;
    if (win.end >= visible.length - 8) void loadMoreCommits();
  }, [win.end, visible.length, hasMoreCommits, loadingMore, loadMoreCommits]);
```

Then replace the silent bottom edge with a real signal: while `loadingMore`, a spinner row; when `!hasMoreCommits`, nothing (the list genuinely ended). **Do not gate this on search being inactive** — a filtered walk paginates too.

- [ ] **Step 4:** `pnpm test` + `pnpm tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(history): load older commits as the log is scrolled (#68 G11)`.

---

### Task 7: Full verification

- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` — all binaries green.
- [ ] `pnpm test --run` — count strictly above the 606 baseline, zero failures.
- [ ] `pnpm tsc --noEmit` and `pnpm exec tsc -p e2e/tsconfig.json --noEmit`.
- [ ] `pnpm test:e2e:docker` — **full suite**; this phase changes the store shape that every History-touching spec depends on. Read the log, not the exit code.
- [ ] Squash onto latest `origin/main`, push, draft PR referencing #68 G11.

## Self-Review

**1. Spec coverage.**

| Spec requirement | Task |
|---|---|
| `LogPage { commits, next_cursor }` | 1 |
| `log_page(repo_id, refspec, cursor, limit)` signature | 1, 2 |
| Frontier is a SET, computed server-side while emitting, O(page) | 2 |
| Continuation pushes every frontier oid; TIME\|TOPOLOGICAL reproduces the walk | 2 |
| Same treatment for the filtered walk | 3 |
| One walk implementation — `log`/`log_filtered` become wrappers with `cursor: None` | 2 Step 3, 3 Step 3 |
| Existing `get_log`/`get_log_filtered` + four `limit = 500` call sites keep working | 2, 3 (wrappers), verified by the pre-existing test suite |
| `commits_since` / `file_history` untouched | not in any task, deliberately |

**2. Placeholder scan.** Task 3 Step 3 and Tasks 5–6 Step 1 describe rather than transcribe (a refactor of an existing 100-line filter loop, and tests whose fixtures depend on the store's current mock shape). Every one names the exact file, the exact assertions, and the invariant — but they are the thinnest points, and the executor should expect to write real code there rather than paste.

**3. Type consistency.** `LogPage.next_cursor` (Rust) ⇄ `nextCursor` (TS) via `rename_all = "camelCase"` — verify the attribute actually exists on neighbouring types before relying on it. `frontier_of` is defined once in Task 2 and reused by Task 3. `log_page` / `log_filtered_page` keep identical argument order in trait, impl, command and TS wrapper.

**Known risk:** the filtered walk's `visited` set is unbounded for a very narrow filter over a large repo — it grows with commits *visited*, not returned. That matches today's behaviour (the current `log_filtered` already walks unbounded until it fills `limit`), so this phase does not regress it, but it is the natural place a future "max visit budget" would go.
