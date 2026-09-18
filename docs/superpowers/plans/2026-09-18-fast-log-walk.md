# Fast History on a Million-Commit Repository — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open `torvalds/linux` in under 1.5 seconds instead of 15.7, by painting the repository before history arrives and taking the commit order from `git rev-list --date-order` over a maintained commit-graph instead of libgit2's revwalk.

**Architecture:** Two independent stages. Stage 1 splits the commit page out of `refreshAll`'s single `Promise.all` so ten fast reads stop waiting behind one slow one. Stage 2 replaces the *internals* of `build_walk_order` — one function returning `WalkOrder { starts, order, complete }` — with a `git rev-list` subprocess, keeping the libgit2 revwalk as the fallback. Everything downstream (`log_cache`, `FrontierBuilder`, cursors, ref decorations, `commit_to_info`) is untouched because only oids cross over; commit metadata still comes from libgit2.

**Tech Stack:** Rust (git2 0.21 / libgit2 1.9.7, `proc::git`), React + Zustand + TypeScript, vitest, WebdriverIO, `pnpm bench`.

**Spec:** `docs/superpowers/specs/2026-09-18-fast-log-walk-design.md`

**Issue:** #483 (umbrella #476, predecessor #473)

## Global Constraints

- **Never `Command::new` outside `src-tauri/src/proc.rs`** — use `proc::git(workdir)`. A guard test fails the build otherwise.
- **Every IPC-crossing fn returns `AppResult<T>`**; add `AppError` variants, never stringify. No new variant is needed by this plan.
- **A new backend module must be named in `CLAUDE.md` or a `docs/dev/*.md` file** or `test/docs.test.ts` fails the build.
- **A new setting must join its Settings page's `meta.cards[].rows`** or `settings.index.test.tsx` fails the build.
- **`MAX_ORDER = 100_000`** (`git/log_cache.rs:65`) — the cap on a kept walk. Unchanged by this plan.
- **Ordering contract: `Sort::TIME | Sort::TOPOLOGICAL` ≡ `git rev-list --date-order`.** Measured byte-for-byte on 2,000 kernel oids. `--topo-order` is a *different* ordering and shares only 1,627 of those 2,000 — never use it.
- **The Rust CI gate is `cargo test` only** — no clippy, no fmt. Do not `cargo fmt` a focused diff.
- **Toolchain paths** in an isolated session: `~/.cargo/bin/cargo`, `~/Library/pnpm/pnpm`.
- **Commit style:** `feat(scope): …` / `fix(scope): …` / `test: …` / `docs: …`, imperative, under 72 chars, `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

## Stage 1 — Paint the repository before history arrives

Ships on its own. Helps every slow repository, including one with no git binary.

### Task 1: Split the commit page out of `refreshAll`

**Files:**
- Modify: `src/features/repo/useRepoStore.ts:1068-1170` (`refreshAll`)
- Test: `src/features/repo/refreshPaintsBeforeLog.test.ts` (create)

**Interfaces:**
- Consumes: `getLogPage`, `trackLoad`, `setFor` — all already imported in this file.
- Produces: no new exports. `refreshAll`'s signature is unchanged; only the *timing* of its writes changes.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/repo/refreshPaintsBeforeLog.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the tauri layer so the log page can be held open while the others resolve.
let releaseLog: (v: unknown) => void;
const logGate = new Promise((res) => {
  releaseLog = res;
});

vi.mock("@/lib/tauri", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/tauri");
  return {
    ...actual,
    getStatus: vi.fn().mockResolvedValue({ entries: [] }),
    listBranches: vi.fn().mockResolvedValue([]),
    listTags: vi.fn().mockResolvedValue([]),
    listStashes: vi.fn().mockResolvedValue([]),
    listRemotes: vi.fn().mockResolvedValue([]),
    repoState: vi.fn().mockResolvedValue("Clean"),
    rebaseStatus: vi.fn().mockResolvedValue(null),
    bisectStatus: vi.fn().mockResolvedValue({ active: false }),
    headInfo: vi.fn().mockResolvedValue(null),
    shallowInfo: vi.fn().mockResolvedValue({ shallow: false }),
    // The slow one.
    getLogPage: vi.fn().mockImplementation(() => logGate),
  };
});

import { useRepoStore } from "./useRepoStore";

describe("refreshAll", () => {
  beforeEach(() => {
    useRepoStore.setState({
      current: { id: "r1", path: "/tmp/r1" } as never,
      commits: [],
      status: null,
      loading: false,
    } as never);
  });

  it("paints status and branches without waiting for the log page", async () => {
    const done = useRepoStore.getState().refreshAll();

    // Let the ten fast reads settle; the log is still pending.
    await vi.waitFor(() => {
      expect(useRepoStore.getState().statusLoaded).toBe(true);
    });
    expect(useRepoStore.getState().loading).toBe(false);
    expect(useRepoStore.getState().commits).toEqual([]);

    releaseLog({ commits: [{ id: "c1" }], nextCursor: null });
    await done;
    expect(useRepoStore.getState().commits).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `~/Library/pnpm/pnpm vitest run src/features/repo/refreshPaintsBeforeLog.test.ts`
Expected: FAIL — `statusLoaded` is still `false` while the log page is pending, because all eleven reads sit behind one `Promise.all`. The `waitFor` times out.

- [ ] **Step 3: Split the write**

In `refreshAll`, take the log out of the joint `Promise.all` and give it its own `setFor`. The ten keep their joint write and now carry `loading: false` and `statusLoaded: true` — the screen is usable at that point.

```ts
    const logRef = get().logRef;
    // The log is NOT in this Promise.all. On torvalds/linux the other ten
    // finish in about a second and the log takes fifteen; joining them made
    // the whole screen wait for the slowest read (#473). The log lands in its
    // own write below, and `loadingTasks` names it while it runs.
    const logPage = trackLoad(
      repo.id,
      "log",
      "loading history",
      getLogPage(repo.id, null, PAGE_SIZE, logRef).catch((e) => {
        if (logRef === null) throw e;
        setFor(repo.id, { logRef: null });
        return getLogPage(repo.id, null, PAGE_SIZE);
      }),
    );

    try {
      const [
        status, branches, tags, stashes, remotes,
        repoState, rebaseStatus, bisectStatus, headInfo, shallow,
      ] = await Promise.all([
        /* …the ten existing trackLoad(…) calls, with the log entry removed… */
      ]);
      setFor(repo.id, {
        status, branches, tags, stashes, remotes,
        repoState, rebaseStatus, bisectStatus, headInfo,
        shallowInfo: shallow,
        loading: false,
        statusLoaded: true,
      });

      // History arrives on its own clock.
      const commitPage = await logPage;
      setFor(repo.id, {
        commits: commitPage.commits,
        // A refresh restarts the walk, so the old resume point is void.
        commitCursor: commitPage.nextCursor,
      });

      const activeFilter = get().commitFilter;
      if (!isFilterEmpty(activeFilter)) {
        void get().searchCommits(activeFilter);
      }
    } catch (e) {
      setFor(repo.id, { loading: false, error: toAppError(e) });
    }
```

- [ ] **Step 4: Run the test and the neighbours it could break**

Run: `~/Library/pnpm/pnpm vitest run src/features/repo/`
Expected: PASS, including `refreshPreserveError.test.ts`, `refreshSpinner.test.tsx`, `amendMessage.test.ts` and `cherryPickMany.test.ts` — those mock every read `refreshAll` fans out to, and a read that moved out of the `Promise.all` must still be awaited before `refreshAll` resolves.

- [ ] **Step 5: Add the e2e case**

`loading` flipping early is a rendering claim, so it needs the real binary. Add to the existing history spec:

```ts
// e2e/specs/history.e2e.ts — inside the existing describe
it("shows branches and status before the first history page lands", async () => {
  // Read the e2e-testing skill before touching this file.
  await openTempRepo();
  const branches = await $("[data-testid='branch-list']");
  await branches.waitForExist({ timeout: 10_000 });
  expect(await branches.isExisting()).toBe(true);
});
```

Run: `~/Library/pnpm/pnpm test:e2e:docker build && ~/Library/pnpm/pnpm test:e2e:docker run --spec e2e/specs/history.e2e.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/repo/useRepoStore.ts src/features/repo/refreshPaintsBeforeLog.test.ts e2e/specs/history.e2e.ts
git commit -F /tmp/msg.txt
```

with `/tmp/msg.txt`:

```
perf(repo): paint the repository before history arrives

refreshAll issued eleven reads behind one Promise.all and wrote once,
so status, branches, tags and HEAD — a second's work on torvalds/linux
— waited fourteen more for the log page. The log now lands in its own
write.

Why: the other ten reads are collectively fast on every fixture the
benchmark covers; joining them to the slowest read is what turns a
1s screen into a 15.7s one.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

## Stage 2 — Take the order from git

### Task 2: Pin the ordering contract with a characterization test

This is the task that makes the rest safe. #473 and #476 both propose `--topo-order`; it is the wrong ordering and the difference is invisible without this test.

**Files:**
- Test: `src-tauri/tests/log_walk_ordering.rs` (create)

**Interfaces:**
- Consumes: `support::{TempRepo, git_in}` from `src-tauri/tests/support/mod.rs`.
- Produces: nothing importable. It is a guard.

- [ ] **Step 1: Write the test**

The fixture must make `--date-order` and `--topo-order` actually diverge, or the test passes against both and proves nothing. Divergence needs a merge whose second parent is *older* than commits already emitted on the first parent, so explicit timestamps are set rather than `Signature::now`.

```rust
//! The ordering contract behind the git-backed log walk (#473).
//!
//! `build_walk_order` sorts with `Sort::TIME | Sort::TOPOLOGICAL`, which is
//! Kahn's algorithm over a time-priority queue — git's `--date-order`, NOT its
//! `--topo-order`. On torvalds/linux the two share only 1,627 of the first
//! 2,000 oids, so swapping one for the other silently changes which commits
//! the first page shows.
//!
//! PLANT A VIOLATION before trusting an edit here: change `--date-order` to
//! `--topo-order` in `rev_list_order` and `diverges_from_topo_order` must go
//! red. A fixture where both orderings agree would make this file worthless.

mod support;

use git2::{Signature, Sort, Time};
use support::{git_in, TempRepo};

/// A history whose date order and topological order genuinely differ:
/// `feature` is committed with timestamps OLDER than the `main` commits that
/// follow the branch point, then merged.
fn skewed_merge_history(tr: &TempRepo) -> Vec<String> {
    let commit = |name: &str, msg: &str, when: i64, parents: &[git2::Oid]| -> git2::Oid {
        std::fs::write(tr.path().join(name), format!("{msg}\n")).unwrap();
        let mut index = tr.repo.index().unwrap();
        index.add_path(std::path::Path::new(name)).unwrap();
        index.write().unwrap();
        let tree = tr.repo.find_tree(index.write_tree().unwrap()).unwrap();
        let sig = Signature::new("Test", "test@example.com", &Time::new(when, 0)).unwrap();
        let parent_commits: Vec<_> = parents
            .iter()
            .map(|p| tr.repo.find_commit(*p).unwrap())
            .collect();
        let refs: Vec<&git2::Commit> = parent_commits.iter().collect();
        tr.repo
            .commit(Some("HEAD"), &sig, &sig, msg, &tree, &refs)
            .unwrap()
    };

    let base = tr.repo.head().unwrap().peel_to_commit().unwrap().id();
    // feature: OLD timestamps
    let f1 = commit("f1.txt", "f1", 1_000, &[base]);
    let f2 = commit("f2.txt", "f2", 1_100, &[f1]);
    // main: NEWER timestamps, on the other side of the fork
    let m1 = commit("m1.txt", "m1", 5_000, &[base]);
    let m2 = commit("m2.txt", "m2", 5_100, &[m1]);
    // the merge, newest of all
    let mg = commit("mg.txt", "mg", 9_000, &[m2, f2]);
    vec![
        mg.to_string(), m2.to_string(), m1.to_string(),
        f2.to_string(), f1.to_string(), base.to_string(),
    ]
}

fn libgit2_order(tr: &TempRepo) -> Vec<String> {
    let mut walk = tr.repo.revwalk().unwrap();
    walk.set_sorting(Sort::TIME | Sort::TOPOLOGICAL).unwrap();
    walk.push_head().unwrap();
    walk.map(|o| o.unwrap().to_string()).collect()
}

fn rev_list(tr: &TempRepo, ordering: &str) -> Vec<String> {
    git_in(tr.path(), &["rev-list", ordering, "HEAD"])
        .lines()
        .map(str::to_string)
        .collect()
}

#[test]
fn date_order_reproduces_libgit2_time_topological() {
    let tr = TempRepo::with_initial_commit("root\n");
    skewed_merge_history(&tr);
    assert_eq!(libgit2_order(&tr), rev_list(&tr, "--date-order"));
}

#[test]
fn diverges_from_topo_order() {
    // The fixture is only worth anything if the two orderings disagree on it.
    let tr = TempRepo::with_initial_commit("root\n");
    skewed_merge_history(&tr);
    assert_ne!(
        rev_list(&tr, "--date-order"),
        rev_list(&tr, "--topo-order"),
        "fixture does not exercise the distinction this file exists to pin",
    );
}
```

- [ ] **Step 2: Run it**

Run: `~/.cargo/bin/cargo test --manifest-path src-tauri/Cargo.toml --test log_walk_ordering`
Expected: BOTH PASS. `date_order_reproduces_libgit2_time_topological` documents today's equivalence; `diverges_from_topo_order` proves the fixture is sharp.

- [ ] **Step 3: Plant the violation**

Temporarily change `--date-order` to `--topo-order` in `date_order_reproduces_libgit2_time_topological`, re-run, and confirm it FAILS. Then revert with `git checkout -- src-tauri/tests/log_walk_ordering.rs`. **Commit the file first** — a `git checkout --` discards uncommitted edits to the same file.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/tests/log_walk_ordering.rs
git commit -m "test: pin --date-order as libgit2's TIME|TOPOLOGICAL equivalent

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The git-backed order producer

**Files:**
- Create: `src-tauri/src/git/log_walk.rs`
- Modify: `src-tauri/src/git/mod.rs` (add `pub mod log_walk;`)
- Test: unit tests inline in `log_walk.rs`

**Interfaces:**
- Consumes: `crate::proc::git`, `crate::error::{AppError, AppResult}`, `git2::Oid`, `MAX_ORDER` from `crate::git::log_cache`.
- Produces:
  - `pub fn parse_oid_lines(stdout: &str, cap: usize) -> Option<Vec<Oid>>` — pure.
  - `pub fn rev_list_order(workdir: &Path, starts: &[Oid], cap: usize) -> Option<Vec<Oid>>` — `None` means "fall back", never an error to show a user.

- [ ] **Step 1: Write the failing unit tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_one_oid_per_line() {
        let a = "0".repeat(40);
        let b = "1".repeat(40);
        let out = format!("{a}\n{b}\n");
        let got = parse_oid_lines(&out, 10).expect("parses");
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].to_string(), a);
    }

    #[test]
    fn rejects_output_that_is_not_oids() {
        // A git that printed a warning, a pager banner, anything at all.
        assert!(parse_oid_lines("fatal: bad revision\n", 10).is_none());
    }

    #[test]
    fn tolerates_a_trailing_newline_and_empty_output() {
        assert_eq!(parse_oid_lines("", 10).expect("empty is valid").len(), 0);
        let a = "a".repeat(40);
        assert_eq!(parse_oid_lines(&format!("{a}\n"), 10).unwrap().len(), 1);
    }

    #[test]
    fn stops_at_the_cap() {
        let a = "a".repeat(40);
        let out = format!("{a}\n").repeat(5);
        assert_eq!(parse_oid_lines(&out, 3).unwrap().len(), 3);
    }
}
```

- [ ] **Step 2: Run them and watch them fail**

Run: `~/.cargo/bin/cargo test --manifest-path src-tauri/Cargo.toml log_walk`
Expected: FAIL — `parse_oid_lines` does not exist.

- [ ] **Step 3: Implement**

```rust
//! The commit ORDER, taken from git rather than from libgit2 (#473).
//!
//! # Why this exists
//!
//! `build_walk_order` needs a topologically-constrained order, and in libgit2
//! 1.9.7 that is not incremental in any sense: `git_revwalk_sorting` sets
//! `walk->limited`, so `prepare_walk` runs `limit_list` over the whole
//! reachable graph and `sort_in_topological_order` materialises the complete
//! ordered list BEFORE the first oid comes out. On torvalds/linux the first
//! oid costs 16.5 s and two thousand oids cost 16.5 s — the same number,
//! because the traversal has already happened.
//!
//! git answers the same question in 188 ms, because it prunes with the
//! generation numbers in the commit-graph file. libgit2 parses those numbers
//! (`commit_list.c`) and then never reads them in `revwalk.c` — across all of
//! libgit2's `src/`, `->generation` is read only in `graph.c` and `merge.c`.
//! So there is no in-process fix, and the order comes from a subprocess.
//!
//! # Only oids cross over
//!
//! Commit metadata still comes from libgit2 via `repo.find_commit`. That keeps
//! the seam one function wide: no format string to keep in sync with
//! `CommitInfo`, no encoding questions, no second definition of what a commit
//! is.
//!
//! # `--date-order`, and never `--topo-order`
//!
//! `Sort::TIME | Sort::TOPOLOGICAL` is Kahn's algorithm over a time-priority
//! queue, which is exactly git's `--date-order`. `--topo-order` answers a
//! different question — it also avoids interleaving independent lines of
//! history — and on the kernel the two share only 1,627 of the first 2,000
//! oids. `tests/log_walk_ordering.rs` pins this.

use std::path::Path;

use git2::Oid;

/// Parse `rev-list` output. `None` when anything at all is not an oid, which
/// is the signal to fall back rather than to fail a page.
pub fn parse_oid_lines(stdout: &str, cap: usize) -> Option<Vec<Oid>> {
    let mut out = Vec::new();
    for line in stdout.lines().take(cap) {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        out.push(Oid::from_str(line).ok()?);
    }
    Some(out)
}

/// The order git would walk, or `None` to use the libgit2 walk instead.
///
/// Every `None` here is a SLOW page, never a failed one — git missing, git
/// failing, or output this cannot read all mean the same thing to the caller.
pub fn rev_list_order(workdir: &Path, starts: &[Oid], cap: usize) -> Option<Vec<Oid>> {
    if starts.is_empty() {
        return Some(Vec::new());
    }
    let mut cmd = crate::proc::git(workdir);
    cmd.arg("rev-list")
        .arg("--date-order")
        .arg(format!("--max-count={cap}"));
    for oid in starts {
        cmd.arg(oid.to_string());
    }
    // The start points are hex this backend resolved itself, never user text —
    // but option parsing ends before them anyway, as everywhere else here.
    cmd.arg("--");

    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    parse_oid_lines(&String::from_utf8(out.stdout).ok()?, cap)
}
```

Register it: add `pub mod log_walk;` to `src-tauri/src/git/mod.rs` beside the other `pub mod` lines.

- [ ] **Step 4: Run the tests**

Run: `~/.cargo/bin/cargo test --manifest-path src-tauri/Cargo.toml log_walk`
Expected: PASS (4 tests).

- [ ] **Step 5: Satisfy the docs guard**

`test/docs.test.ts` fails the build for a backend module no doc mentions. Add one line to `docs/dev/backend.md` under the log section:

```markdown
* `git/log_walk.rs` — the commit ORDER, taken from `git rev-list --date-order`
  because libgit2's sorted revwalk materialises the whole graph before yielding
  (#473). Only oids cross over; commit data still comes from libgit2.
```

Run: `~/Library/pnpm/pnpm vitest run test/docs.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/git/log_walk.rs src-tauri/src/git/mod.rs docs/dev/backend.md
git commit -m "feat(log): read the commit order from git rev-list

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Use it in `build_walk_order`, keeping libgit2 as the fallback

**Files:**
- Modify: `src-tauri/src/git/libgit2.rs:2841-2861` (`build_walk_order`)
- Test: `src-tauri/tests/log_walk_backend.rs` (create)

**Interfaces:**
- Consumes: `log_walk::rev_list_order` from Task 3; `WalkOrder`, `MAX_ORDER` from `git/log_cache.rs`.
- Produces: `build_walk_order` keeps its exact signature — `fn build_walk_order(repo: &Repository, starts: &[git2::Oid]) -> AppResult<WalkOrder>`.

- [ ] **Step 1: Write the failing test**

```rust
//! The git-backed walk produces the same pages as the libgit2 one (#473).

mod support;

use platypusgit_lib::git::libgit2::Libgit2Backend;
use platypusgit_lib::git::GitBackend;
use support::TempRepo;

#[test]
fn git_backed_and_libgit2_walks_agree_page_for_page() {
    let tr = TempRepo::with_initial_commit("root\n");
    support::linear_history(&tr, 50);
    let (backend, handle) = tr.open_with_backend();

    let with_git = backend.log_page(&handle.id, None, None, 20).unwrap();

    // Force the fallback by making git unusable for this backend only.
    std::env::set_var("PGIT_DISABLE_REV_LIST", "1");
    let (fallback_backend, fallback_handle) = tr.open_with_backend();
    let without_git = fallback_backend
        .log_page(&fallback_handle.id, None, None, 20)
        .unwrap();
    std::env::remove_var("PGIT_DISABLE_REV_LIST");

    let a: Vec<_> = with_git.commits.iter().map(|c| &c.id).collect();
    let b: Vec<_> = without_git.commits.iter().map(|c| &c.id).collect();
    assert_eq!(a, b, "the two producers must agree exactly");
    assert_eq!(with_git.next_cursor, without_git.next_cursor);
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `~/.cargo/bin/cargo test --manifest-path src-tauri/Cargo.toml --test log_walk_backend`
Expected: FAIL — `PGIT_DISABLE_REV_LIST` is not read by anything yet, so both paths are identical and the test proves nothing. It must fail for the *right* reason before proceeding; if it passes here, the escape hatch is not wired.

- [ ] **Step 3: Implement**

```rust
/// `MAX_ORDER` bounds the memory; a walk longer than that is kept as a prefix
/// and `complete` says so.
///
/// The order comes from `git rev-list --date-order` when git can produce it
/// (#473) — libgit2's sorted revwalk pre-walks the entire graph before it
/// yields anything, which is 15.7 s on torvalds/linux against git's 188 ms.
/// The libgit2 walk below is the fallback, and it is exactly what every walk
/// was before: a slow page, never a failed one.
fn build_walk_order(repo: &Repository, starts: &[git2::Oid]) -> AppResult<WalkOrder> {
    if std::env::var_os("PGIT_DISABLE_REV_LIST").is_none() {
        if let Some(workdir) = repo.workdir() {
            if let Some(order) = crate::git::log_walk::rev_list_order(workdir, starts, MAX_ORDER) {
                let complete = order.len() < MAX_ORDER;
                return Ok(WalkOrder {
                    starts: starts.to_vec(),
                    order,
                    complete,
                });
            }
        }
    }

    let mut walk = repo.revwalk()?;
    walk.set_sorting(Sort::TIME | Sort::TOPOLOGICAL)?;
    for &oid in starts {
        walk.push(oid)?;
    }
    let mut order = Vec::new();
    let mut complete = true;
    for oid in walk {
        if order.len() >= MAX_ORDER {
            complete = false;
            break;
        }
        order.push(oid?);
    }
    Ok(WalkOrder {
        starts: starts.to_vec(),
        order,
        complete,
    })
}
```

`PGIT_DISABLE_REV_LIST` is a test seam and a support escape hatch, documented in `docs/dev/backend.md` beside the module entry from Task 3.

- [ ] **Step 4: Run the tests**

Run: `~/.cargo/bin/cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS — the whole Rust suite, including `log_walk_cache.rs`, whose cold/warm drain comparison now covers both producers.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/git/libgit2.rs src-tauri/tests/log_walk_backend.rs docs/dev/backend.md
git commit -m "perf(log): build the walk order from git, falling back to libgit2

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Keep a commit-graph warm

Without this, Task 4 buys nothing: `rev-list --date-order` is 10,085 ms on a kernel clone with no commit-graph and 47 ms with one.

**Files:**
- Create: `src-tauri/src/git/commit_graph.rs`
- Modify: `src-tauri/src/git/mod.rs`, `src-tauri/src/commands/repo.rs` (schedule on open)
- Test: `src-tauri/tests/commit_graph.rs` (create)

**Interfaces:**
- Consumes: `crate::proc::git`, `git2::Repository`.
- Produces:
  - `pub fn should_write(repo: &Repository) -> bool` — false when `core.commitGraph` is false or the workdir is not writable.
  - `pub fn write_split(workdir: &Path) -> bool` — runs `commit-graph write --reachable --split`; `true` on success.

- [ ] **Step 1: Write the failing test**

```rust
//! Commit-graph maintenance (#473).

mod support;

use platypusgit_lib::git::commit_graph;
use support::{git_in, TempRepo};

#[test]
fn writes_a_commit_graph_and_is_cheap_the_second_time() {
    let tr = TempRepo::with_initial_commit("root\n");
    support::linear_history(&tr, 20);

    assert!(commit_graph::should_write(&tr.repo));
    assert!(commit_graph::write_split(tr.path()));
    assert!(tr.path().join(".git/objects/info/commit-graphs").exists()
        || tr.path().join(".git/objects/info/commit-graph").exists());

    // Idempotent: a second write with no new commits must still succeed.
    assert!(commit_graph::write_split(tr.path()));
}

#[test]
fn respects_core_commitgraph_false() {
    let tr = TempRepo::with_initial_commit("root\n");
    git_in(tr.path(), &["config", "core.commitGraph", "false"]);
    assert!(!commit_graph::should_write(&tr.repo));
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `~/.cargo/bin/cargo test --manifest-path src-tauri/Cargo.toml --test commit_graph`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```rust
//! The commit-graph file this backend keeps warm (#473).
//!
//! # Why the app writes it at all
//!
//! `git rev-list --date-order` is only affordable with one. A fresh clone has
//! none — `git clone` does not write one and `gc --auto` does not fire on a
//! single packfile — so this is exactly what a user gets on day one. Measured
//! on torvalds/linux: 10,085 ms for a 500-oid walk without, 47 ms with.
//!
//! It is written into the user's own repository, because that is where git
//! itself writes it (`git gc`, `git maintenance`), it is derived data git
//! knows how to invalidate, and it makes the user's own `git log` fast too.
//!
//! # `--split`, not a plain rewrite
//!
//! `commit-graph write --reachable` rewrites the whole file every time: 14.3 s
//! on the kernel EVEN WHEN NOTHING CHANGED. `--split` costs 59.9 ms in that
//! case. A scheduler that called the plain form on open would burn fourteen
//! seconds of CPU per open forever.

use std::path::Path;

use git2::Repository;

/// Whether this repository wants one. Honours the user's `core.commitGraph`.
pub fn should_write(repo: &Repository) -> bool {
    if repo.workdir().is_none() {
        return false;
    }
    match repo.config().and_then(|c| c.get_bool("core.commitGraph")) {
        Ok(false) => false,
        _ => true,
    }
}

/// Write (or incrementally extend) the split commit-graph. `false` on any
/// failure — this is a cache, and a repository without one is merely slower.
pub fn write_split(workdir: &Path) -> bool {
    crate::proc::git(workdir)
        .arg("commit-graph")
        .arg("write")
        .arg("--reachable")
        .arg("--split")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}
```

- [ ] **Step 4: Schedule it on open, off the critical path**

In the repository-open command, after the handle is returned, spawn the write so it never blocks a page. The first one on the kernel costs 14.5 s and the user must not wait for it.

```rust
// commands/repo.rs, after the handle is created
let workdir = /* the opened repository's workdir */;
tauri::async_runtime::spawn_blocking(move || {
    // Best effort, once per repository per session. A failure means slower
    // pages, never a broken repository.
    crate::git::commit_graph::write_split(&workdir);
});
```

- [ ] **Step 5: Run the tests**

Run: `~/.cargo/bin/cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/git/commit_graph.rs src-tauri/src/git/mod.rs src-tauri/src/commands/repo.rs src-tauri/tests/commit_graph.rs docs/dev/backend.md
git commit -m "feat(log): keep a split commit-graph warm on open

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: The Settings switch

**Files:**
- Modify: `src/features/settings/pages/workspace.tsx` (component **and** its exported `meta`)

**Interfaces:**
- Consumes: the existing settings-row helpers on that page.
- Produces: one boolean setting, `historyCommitGraph`, default `true`.

- [ ] **Step 1: Add the row to `meta` and the control to the component**

The registry indexes `meta.cards[].rows`, and a word that lives only in a `hint` is NOT indexed — so the searchable words go in `keywords`.

```tsx
// in meta.cards[] for the workspace page
{
  title: "History",
  rows: [
    {
      id: "historyCommitGraph",
      label: "Speed up history on large repositories",
      keywords: ["commit-graph", "commit graph", "performance", "large", "slow", "log"],
      hint: "Writes git's own commit-graph cache into the repository, the same file `git gc` maintains. Without it, opening a repository with a million commits takes about fifteen seconds.",
    },
  ],
},
```

- [ ] **Step 2: Run the registry guard**

Run: `~/Library/pnpm/pnpm vitest run test/settings.index.test.tsx`
Expected: PASS. It fails the build for a setting absent from `meta`.

- [ ] **Step 3: Commit**

```bash
git add src/features/settings/pages/workspace.tsx
git commit -m "feat(settings): add the history commit-graph switch

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Correct the benchmark's baselines

The harness compares against `git log --topo-order`, which is the wrong ordering — the right cost class, but not the question `log_page` asks.

**Files:**
- Modify: `src-tauri/benches/repo_bench.rs` (the `gitCommand` for `log_first_page`, `log_page_deep`, `file_history`)

- [ ] **Step 1: Change the baselines**

Replace `--topo-order` with `--date-order` in those three baseline commands, and add a comment saying why, citing `tests/log_walk_ordering.rs`.

- [ ] **Step 2: Re-run and confirm the baselines moved but the shape did not**

Run: `~/Library/pnpm/pnpm bench --fixture deep --no-publish`
Expected: the `deep` fixture's numbers are within noise of today's (it is a single linear branch, where the two orderings cannot differ).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/benches/repo_bench.rs
git commit -m "test(bench): compare the log against --date-order, not --topo-order

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Re-measure and publish

**Files:**
- Modify: `docs/dev/benchmark.json`, `docs/dev/performance.md`, `README.md` (all three generated), `CLAUDE.md` (the log-cache bullet)

- [ ] **Step 1: Run the full benchmark on a quiet machine**

Check `uptime` first — a load average above ~3 invalidates the run, and `$PGBENCH_HOME` is shared across worktrees, so confirm no other session is benchmarking.

Run: `~/Library/pnpm/pnpm bench --linux`
Expected: `open_screen` on `linux` under 1.5 s and bounded by `status`; `log_first_page` first call under 500 ms; `deep`, `wide`, `refs` unmoved.

- [ ] **Step 2: Verify the three published artifacts agree**

Run: `~/Library/pnpm/pnpm vitest run test/benchmark.test.ts`
Expected: PASS — it re-renders `README.md` and both `docs/dev/` artifacts from the record and fails if any was hand-edited.

- [ ] **Step 3: Rewrite the findings prose**

`docs/dev/performance.md`'s findings section still says the sort is re-paid per page (fixed by #479) and that ten pages cost 157.67 s (now 112 ms). Replace those readings with what the new run says, and keep the commit-graph finding — it is still why this design exists.

- [ ] **Step 4: Update the CLAUDE.md convention bullet**

The existing `git/log_cache.rs` bullet describes a libgit2-only walk. Extend it to name `git/log_walk.rs` and the `--date-order` contract, in one or two sentences — it is a load-bearing rule that a future session must not undo.

- [ ] **Step 5: Commit all generated artifacts together**

```bash
git add docs/dev/benchmark.json docs/dev/performance.md README.md CLAUDE.md
git commit -m "docs(bench): publish the numbers after the git-backed walk

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

A partial commit here fails `test/benchmark.test.ts` by design.

---

## Self-Review

**Spec coverage.** Stage 1 → Task 1. Seam at `build_walk_order` → Task 4. `--date-order` contract → Task 2 (and Task 7 corrects the baselines). Subprocess + argv safety + fallback → Tasks 3 and 4. Commit-graph, `--split`, `core.commitGraph`, background scheduling → Task 5. Settings switch → Task 6. Re-publishing the stale record → Task 8. Testing section → Tasks 1 (e2e), 2 (characterization + planted violation), 3 (unit), 4 (fallback), 5 (maintenance), 8 (bench).

**Deliberately out of scope**, per the spec: `file_history` (15.9 s on the kernel, same root cause, its own cap and cursor semantics — needs its own issue once this shape is proven) and streaming a partial page (libgit2 yields nothing before the walk completes, so there are no early rows to stream; Stage 2 deletes the wait instead).

**Type consistency.** `rev_list_order(workdir: &Path, starts: &[Oid], cap: usize) -> Option<Vec<Oid>>` and `parse_oid_lines(stdout: &str, cap: usize) -> Option<Vec<Oid>>` are defined in Task 3 and used with those exact signatures in Task 4. `should_write(&Repository) -> bool` and `write_split(&Path) -> bool` are defined and used consistently in Task 5. `build_walk_order`'s signature is unchanged throughout.

**Known soft spots for the executor.** The exact insertion point in `commands/repo.rs` (Task 5, Step 4) needs reading in place — anchor on the statement that returns the handle, not on a doc comment, or the spawn lands inside the preceding item's doc block. Task 1's `e2e/specs/history.e2e.ts` selector is illustrative: read the `e2e-testing` skill and use the spec's existing selectors.
