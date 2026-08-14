# Interactive rebase over merge commits — PR2: flatten mode

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A rebase range containing merge commits is usable: merges default to being dropped (git's own flattening behaviour), the plan says so in the row and in a warning strip above it, and a merge can alternatively be kept as one ordinary commit.

**Architecture:** PR1 made a merge in the plan a hard, pre-flight rejection unless it was explicitly dropped. This PR makes the UI produce that plan by default instead of leaving the user to discover the error: `buildRebasePlan` and the Rebase screen's own plan builder mark merge rows and default them to `Drop`, the row component restricts its action list for a merge, and a new `RebaseAction::MainlinePick` (a `cherry-pick -m 1`) offers "keep the merge as one commit" for the case where the integration itself is worth a commit.

**Tech Stack:** Rust + git2 0.20.4 (`CherrypickOptions::mainline`), React + Zustand, vitest/RTL, WebdriverIO (Docker only), `cargo test`.

**Spec:** `docs/superpowers/specs/2026-08-14-rebase-merge-commits-design.md`

**Depends on:** PR1 (`docs/superpowers/plans/2026-08-14-rebase-merge-commits-pr1-safety-model.md`) — `rebase_plan::validate`, `rebase_plan::merge_legal`, and the detached-HEAD execution model must be in place.

## Global Constraints

- Every IPC-crossing fn returns `AppResult<T>`; no `unwrap`/`panic` in commands.
- A new Rust enum variant that crosses IPC updates `src/lib/types.ts` **in the same commit**.
- Frontend never calls `invoke()` directly — typed wrapper in `src/lib/tauri.ts`.
- Any new list-row surface opts into UI density via `--row-step`; `PGRebaseRow` already does (`padding: "calc(6px + var(--row-step) / 2) 10px"`) — keep it.
- Never hardcode the accent hue; use `var(--accent)` / `var(--git-*)` tokens.
- Import UI primitives from `@/design`.
- E2E only ever runs through Docker: rebuild the snapshot with `pnpm test:e2e:docker build`, then `pnpm test:e2e:docker run --spec …`. Never natively.
- Read `.claude/skills/e2e-testing/SKILL.md` before touching the e2e spec.
- Run cargo/pnpm with `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"`.

## File Structure

**Create:**
- `src-tauri/tests/rebase_flatten.rs` — `MainlinePick` semantics and the flattening result.
- `src/features/commits/buildRebasePlan.merge.test.ts` — merge rows default to `Drop`.
- `src/screens/Rebase.merge.test.tsx` — warning strip and restricted merge actions.

**Modify:**
- `src-tauri/src/git/types.rs` — `RebaseAction::MainlinePick`.
- `src-tauri/src/git/rebase_plan.rs` — widen `merge_legal`.
- `src-tauri/src/git/libgit2.rs` — `start_pick` takes a mainline; `advance_rebase` handles `MainlinePick`.
- `src/lib/types.ts` — `RebaseAction` union member.
- `src/features/commits/buildRebasePlan.ts` — merge rows become `Drop`.
- `src/design/git-components.tsx` — `PGRebaseRow`: exact action values, `options` override, merge badge.
- `src/screens/Rebase.tsx` — `PlanRow.isMerge`, restricted actions, warning strip.
- `e2e/support/tempRepo.ts` — `mergeRangeRepo` fixture.
- `e2e/specs/rebase.e2e.ts` — flatten run over a merge.

---

### Task 1: `MainlinePick` — keep a merge as one ordinary commit

**Files:**
- Modify: `src-tauri/src/git/types.rs`
- Modify: `src/lib/types.ts`
- Modify: `src-tauri/src/git/rebase_plan.rs`
- Modify: `src-tauri/src/git/libgit2.rs`
- Create: `src-tauri/tests/rebase_flatten.rs`

**Interfaces:**
- Consumes: `support::merge_history` and `rebase_plan::merge_legal` from PR1.
- Produces: `RebaseAction::MainlinePick` (Rust + TS); `Libgit2Backend::start_pick(&self, repo_id: &RepoId, oid: &str, mainline: u32) -> AppResult<bool>`.

- [ ] **Step 1: Write the failing test**

Create `src-tauri/tests/rebase_flatten.rs`:

```rust
//! Flattening a range that contains a merge: either the merge is dropped (git's
//! default — its side-branch commits are replayed individually) or it is kept
//! as one ordinary commit carrying its diff against its first parent.

mod support;

use platypusgit_lib::git::{
    types::{RebaseAction, RebaseStep},
    GitBackend,
};

use support::{merge_history, TempRepo};

fn step(oid: &str, action: RebaseAction) -> RebaseStep {
    RebaseStep { oid: oid.to_string(), action, message: None }
}

#[test]
fn dropping_the_merge_flattens_the_branch() {
    let tr = TempRepo::with_initial_commit("root\n");
    let h = merge_history(&tr);
    let (backend, handle) = tr.open_with_backend();

    let status = backend
        .rebase_start(
            &handle.id,
            vec![
                step(&h.a, RebaseAction::Pick),
                step(&h.f, RebaseAction::Pick),
                step(&h.c, RebaseAction::Pick),
                step(&h.m, RebaseAction::Drop),
            ],
        )
        .unwrap();
    assert!(!status.in_progress);

    let log = backend.log(&handle.id, None, 20).unwrap();
    let summaries: Vec<&str> = log.iter().map(|c| c.summary.as_str()).collect();
    assert_eq!(
        summaries,
        vec!["C on main", "F on feature", "A on main", "initial"],
        "the branch should be linear, oldest last"
    );
    assert!(
        log.iter().all(|c| c.parents.len() <= 1),
        "no merge commit may survive a flattening rebase"
    );
    // The side branch's content is replayed, not lost.
    assert!(tr.path().join("f.txt").exists(), "F's file must survive");
    assert!(tr.path().join("c.txt").exists(), "C's file must survive");
}

#[test]
fn mainline_pick_keeps_the_merge_as_one_commit() {
    let tr = TempRepo::with_initial_commit("root\n");
    let h = merge_history(&tr);
    let merge_tree = tr
        .repo
        .find_commit(git2::Oid::from_str(&h.m).unwrap())
        .unwrap()
        .tree_id();
    let (backend, handle) = tr.open_with_backend();

    // The side branch is NOT replayed on its own; the merge carries its content
    // in as a single commit (the "I merged a topic in, keep that as one step"
    // case).
    let status = backend
        .rebase_start(
            &handle.id,
            vec![
                step(&h.a, RebaseAction::Pick),
                step(&h.c, RebaseAction::Pick),
                step(&h.m, RebaseAction::MainlinePick),
            ],
        )
        .unwrap();
    assert!(!status.in_progress, "a clean mainline pick should not pause");

    let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(head.parent_count(), 1, "the result must be an ordinary commit");
    assert_eq!(
        head.summary().unwrap(),
        "Merge branch 'feature'",
        "the merge's message is kept"
    );
    assert_eq!(
        head.tree_id(),
        merge_tree,
        "the tree must match the original merge's tree"
    );
}

#[test]
fn mainline_pick_on_a_non_merge_behaves_like_pick() {
    let tr = TempRepo::with_initial_commit("root\n");
    let h = merge_history(&tr);
    let (backend, handle) = tr.open_with_backend();

    let status = backend
        .rebase_start(
            &handle.id,
            vec![
                step(&h.a, RebaseAction::Pick),
                step(&h.c, RebaseAction::MainlinePick),
                step(&h.m, RebaseAction::Drop),
            ],
        )
        .unwrap();
    assert!(!status.in_progress);
    assert_eq!(
        backend.log(&handle.id, None, 5).unwrap()[0].summary,
        "C on main"
    );
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --test rebase_flatten
```

Expected: compile error — `RebaseAction::MainlinePick` does not exist. (`dropping_the_merge_flattens_the_branch` passes once it compiles: PR1 already allows `Drop`.)

- [ ] **Step 3: Add the action (Rust + TS)**

In `src-tauri/src/git/types.rs`, extend `RebaseAction`:

```rust
pub enum RebaseAction {
    Pick,
    Reword,
    Edit,
    Squash,
    Fixup,
    Drop,
    /// A merge commit applied as its diff against its **first** parent — one
    /// ordinary commit, keeping the merge's message (`git cherry-pick -m 1`).
    /// On a non-merge commit it is identical to `Pick`.
    MainlinePick,
}
```

In `src/lib/types.ts`:

```ts
export type RebaseAction =
  | "Pick"
  | "Reword"
  | "Edit"
  | "Squash"
  | "Fixup"
  | "Drop"
  | "MainlinePick";
```

Widen `merge_legal` in `src-tauri/src/git/rebase_plan.rs`:

```rust
/// Actions that mean something for a commit with more than one parent.
///
/// `Drop` flattens (git's default), `MainlinePick` keeps the merge as one
/// ordinary commit. PR3 adds `Merge`, which recreates it.
pub fn merge_legal(action: RebaseAction) -> bool {
    matches!(action, RebaseAction::Drop | RebaseAction::MainlinePick)
}
```

Update the rejection message in `validate` to name both ways out:

```rust
            return Err(AppError::InvalidRebasePlan(format!(
                "{} is a merge commit — it can be dropped (which flattens the \
                 branch) or kept as one commit, but not {:?}ed",
                short(&step.oid),
                step.action
            )));
```

- [ ] **Step 4: Teach the engine the mainline**

In `src-tauri/src/git/libgit2.rs`, give `start_pick` a mainline parameter:

```rust
    /// Apply `oid`'s diff into the index + worktree (a cherry-pick), WITHOUT
    /// committing. `mainline` is 0 for an ordinary commit and 1 for a merge
    /// commit being flattened into one commit — libgit2 refuses a merge without
    /// one ("mainline branch is not specified"), which is exactly the error a
    /// plan containing an unhandled merge used to hit mid-replay.
    fn start_pick(&self, repo_id: &RepoId, oid: &str, mainline: u32) -> AppResult<bool> {
        self.with_repo(repo_id, |repo| {
            let target = repo
                .revparse_single(oid)
                .map_err(|_| AppError::InvalidRef(oid.to_string()))?
                .peel_to_commit()?;
            let mut opts = git2::CherrypickOptions::new();
            opts.mainline(mainline);
            repo.cherrypick(&target, Some(&mut opts))?;
            let statuses = repo.statuses(None)?;
            Ok(!statuses.iter().any(|s| s.status().is_conflicted()))
        })
    }
```

In `advance_rebase`, compute the mainline from the action and the commit's parent count, and pass it:

```rust
            // A merge commit needs a mainline; an ordinary commit must not get
            // one (libgit2 rejects a mainline on a single-parent commit).
            let mainline = if step.action == RebaseAction::MainlinePick {
                let parents = self.with_repo(repo_id, |repo| {
                    Ok(repo
                        .revparse_single(&step.oid)
                        .map_err(|_| AppError::InvalidRef(step.oid.clone()))?
                        .peel_to_commit()?
                        .parent_count())
                })?;
                if parents > 1 { 1 } else { 0 }
            } else {
                0
            };

            if !resuming && !self.start_pick(repo_id, &step.oid, mainline)? {
                // … existing conflict handling, unchanged …
            }
```

Then handle the action in the post-commit `match step.action`, alongside `Pick`:

```rust
                RebaseAction::Pick | RebaseAction::MainlinePick => {
                    self.bump_completed(repo_id)?;
                }
```

- [ ] **Step 5: Run the tests**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --test rebase_flatten
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tsc --noEmit
```

Expected: three new tests pass; the whole backend suite stays green (the `start_pick` signature change touches only `advance_rebase`).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/git/types.rs src-tauri/src/git/rebase_plan.rs \
        src-tauri/src/git/libgit2.rs src-tauri/tests/rebase_flatten.rs src/lib/types.ts
git commit -m "feat(rebase): add MainlinePick — keep a merge as one commit

Why: flattening a range shouldn't force a choice between losing the
merge entirely and replaying its side branch commit-by-commit. A
mainline pick is git cherry-pick -m 1: the merge's diff against its
first parent, as one ordinary commit keeping its message."
```

---

### Task 2: Plans built from a range default their merge rows to `Drop`

**Files:**
- Modify: `src/features/commits/buildRebasePlan.ts`
- Create: `src/features/commits/buildRebasePlan.merge.test.ts`

**Interfaces:**
- Produces: `buildRebasePlan` returning `Drop` for every commit with >1 parent, regardless of `mode`.

- [ ] **Step 1: Write the failing test**

Create `src/features/commits/buildRebasePlan.merge.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildRebasePlan } from "./buildRebasePlan";
import type { CommitInfo } from "@/lib/types";

function mk(oid: string, summary: string, parents: string[]): CommitInfo {
  return {
    oid,
    shortOid: oid.slice(0, 7),
    summary,
    body: null,
    author: "Test",
    email: "t@e.com",
    timestamp: 0,
    parents,
    refs: [],
  };
}

const M = "m".repeat(40);
const C = "c".repeat(40);
const F = "f".repeat(40);
const A = "a".repeat(40);
const ROOT = "r".repeat(40);

/** Newest-first, as the log returns it. */
const log: CommitInfo[] = [
  mk(M, "Merge branch 'feature'", [C, F]),
  mk(C, "C on main", [A]),
  mk(F, "F on feature", [A]),
  mk(A, "A on main", [ROOT]),
  mk(ROOT, "root", []),
];

describe("buildRebasePlan with merges in range", () => {
  it("defaults a merge commit to Drop and keeps everything else a Pick", () => {
    const plan = buildRebasePlan(log, A, { kind: "edit-from" });
    expect(plan).not.toBeNull();
    expect(plan!.map((s) => [s.oid, s.action])).toEqual([
      [F, "Pick"],
      [C, "Pick"],
      [M, "Drop"],
    ]);
  });

  it("a merge is dropped even when it is the fixup target", () => {
    // Nothing in the UI offers this, but a plan is a plan — the backend would
    // reject Fixup on a merge, so the builder must not produce it.
    const plan = buildRebasePlan(log, A, { kind: "fixup", targetOid: M });
    expect(plan!.find((s) => s.oid === M)!.action).toBe("Drop");
  });

  it("leaves a merge-free range untouched", () => {
    const linear = [mk(C, "C", [A]), mk(A, "A", [ROOT]), mk(ROOT, "root", [])];
    const plan = buildRebasePlan(linear, A, { kind: "edit-from" });
    expect(plan!.map((s) => s.action)).toEqual(["Pick"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test src/features/commits/buildRebasePlan.merge.test.ts
```

Expected: the first two fail — every row currently comes back `"Pick"`.

- [ ] **Step 3: Implement**

In `src/features/commits/buildRebasePlan.ts`, extend the doc comment and the mapping. Add to the doc block, after the `mode` list:

```
 * A commit with more than one parent (a merge) is always emitted as "Drop",
 * whatever the mode asks for: that is git's own default (`git rebase -i` drops
 * merges and flattens the branch), and the backend refuses any other action on
 * a merge except MainlinePick, which the user picks per row in the Rebase
 * screen.
```

And in the `map` callback, make it the first branch:

```ts
  return oldestFirst.map((c): RebaseStep => {
    let action: RebaseAction = "Pick";
    let message: string | null = null;
    if (c.parents.length > 1) {
      action = "Drop";
    } else if (mode.kind === "fixup" && c.oid === mode.targetOid) {
```

- [ ] **Step 4: Run the tests**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test src/features/commits/buildRebasePlan
```

Expected: the new file and the existing `buildRebasePlan.test.ts` both pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/commits/buildRebasePlan.ts src/features/commits/buildRebasePlan.merge.test.ts
git commit -m "feat(rebase): default merge rows to Drop when building a plan"
```

---

### Task 3: `PGRebaseRow` speaks exact actions and marks a merge

**Files:**
- Modify: `src/design/git-components.tsx`
- Modify: `src/screens/Rebase.tsx` (the `onActionChange` mapping only)

**Interfaces:**
- Produces: `PGRebaseRowProps { action?: RebaseAction; sha; subject; onActionChange?: (v: RebaseAction) => void; index?; dragging?; options?: RebaseAction[]; badge?: string }`, where `action` and `onActionChange` now use the exact `RebaseAction` strings (`"Pick"`, `"MainlinePick"`, …) instead of lowercase.

- [ ] **Step 1: Write the failing test**

Create `src/design/git-components.rebaseRow.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PGRebaseRow } from "./git-components";

describe("PGRebaseRow", () => {
  it("offers the full action list by default and reports exact action names", async () => {
    const onActionChange = vi.fn();
    render(
      <PGRebaseRow sha="abc1234" subject="feat: thing" action="Pick" onActionChange={onActionChange} />,
    );
    const select = screen.getByRole("combobox");
    expect([...select.querySelectorAll("option")].map((o) => o.getAttribute("value"))).toEqual([
      "Pick",
      "Reword",
      "Edit",
      "Squash",
      "Fixup",
      "Drop",
    ]);
    await userEvent.selectOptions(select, "Drop");
    expect(onActionChange).toHaveBeenCalledWith("Drop");
  });

  it("restricts the list and shows a badge for a merge row", () => {
    render(
      <PGRebaseRow
        sha="def5678"
        subject="Merge branch 'feature'"
        action="Drop"
        badge="merge"
        options={["Drop", "MainlinePick"]}
      />,
    );
    const select = screen.getByRole("combobox");
    expect([...select.querySelectorAll("option")].map((o) => o.getAttribute("value"))).toEqual([
      "Drop",
      "MainlinePick",
    ]);
    expect(screen.getByText("merge")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test src/design/git-components.rebaseRow.test.tsx
```

Expected: fails — option values are lowercase (`"pick"`, …), there is no `options` or `badge` prop.

- [ ] **Step 3: Implement**

In `src/design/git-components.tsx`, replace `PGRebaseRowProps` and the action table:

```tsx
export interface PGRebaseRowProps {
  /** Exact `RebaseAction` string — the same value the backend consumes. */
  action?: RebaseAction;
  sha: string;
  subject: string;
  onActionChange?: (v: RebaseAction) => void;
  index?: number;
  dragging?: boolean;
  /** Restrict the dropdown — a merge row cannot be reworded, edited, or folded. */
  options?: RebaseAction[];
  /** Short label rendered next to the sha, e.g. "merge". */
  badge?: string;
}

const REBASE_ACTION_STYLE: Record<RebaseAction, { label: string; color: string }> = {
  Pick: { label: "pick", color: "var(--git-added)" },
  Reword: { label: "reword", color: "var(--accent)" },
  Edit: { label: "edit", color: "var(--git-modified)" },
  Squash: { label: "squash", color: "var(--accent-2)" },
  Fixup: { label: "fixup", color: "var(--accent-2)" },
  Drop: { label: "drop", color: "var(--git-removed)" },
  MainlinePick: { label: "keep as one", color: "var(--accent-3)" },
};

const DEFAULT_REBASE_ACTIONS: RebaseAction[] = [
  "Pick",
  "Reword",
  "Edit",
  "Squash",
  "Fixup",
  "Drop",
];

export function PGRebaseRow({
  action = "Pick",
  sha,
  subject,
  onActionChange,
  index,
  dragging,
  options,
  badge,
}: PGRebaseRowProps) {
  const values = options ?? DEFAULT_REBASE_ACTIONS;
  const current = REBASE_ACTION_STYLE[action] ?? REBASE_ACTION_STYLE.Pick;
  return (
    <div
      data-testid="rebase-row"
      data-sha={sha}
      data-action={action}
      style={{
        // … existing style block, with the two action-dependent lines becoming:
        opacity: action === "Drop" ? 0.5 : 1,
        textDecoration: action === "Drop" ? "line-through" : "none",
        borderLeft: `3px solid ${current.color}`,
      }}
    >
      {/* … drag icon + index unchanged … */}
      <PGSelect
        value={action}
        onChange={(v) => onActionChange?.(v as RebaseAction)}
        size="sm"
        options={values.map((v) => ({ value: v, label: REBASE_ACTION_STYLE[v].label }))}
        style={{ width: 110, borderColor: current.color, color: current.color } as CSSProperties}
      />
      {badge && (
        <span
          data-testid="rebase-row-badge"
          style={{
            fontSize: "var(--fs-10)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            padding: "1px 5px",
            borderRadius: "var(--r-1)",
            border: "1px solid var(--border-1)",
            color: "var(--fg-2)",
            flexShrink: 0,
          }}
        >
          {badge}
        </span>
      )}
      {/* … sha + subject spans unchanged … */}
    </div>
  );
}
```

Import the type at the top of the file if it is not already imported: `import type { RebaseAction } from "@/lib/types";`.

In `src/screens/Rebase.tsx`, the case-mangling mapping goes away:

```tsx
                        action={row.action}
                        onActionChange={(v) => updateRow(i, { action: v })}
```

- [ ] **Step 4: Run the tests**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test src/design/git-components.rebaseRow.test.tsx
pnpm test src/screens/Rebase
pnpm tsc --noEmit
```

Expected: new component tests pass; the existing `Rebase.test.tsx` still passes; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/design/git-components.tsx src/design/git-components.rebaseRow.test.tsx src/screens/Rebase.tsx
git commit -m "refactor(design): PGRebaseRow takes exact RebaseAction values

Why: the row lowercased its action and the screen re-capitalised the
first letter on the way back, which cannot express a two-word action
like MainlinePick. It now speaks the same strings the backend does, and
accepts a restricted option list plus a badge for merge rows."
```

---

### Task 4: The Rebase screen explains what will happen to the merges

**Files:**
- Modify: `src/screens/Rebase.tsx`
- Create: `src/screens/Rebase.merge.test.tsx`

**Interfaces:**
- Consumes: `PGRebaseRow` `options` / `badge` (Task 3).
- Produces: `PlanRow { oid, shortOid, subject, action, message, isMerge: boolean }`; a warning strip with `data-testid="rebase-merge-warning"`.

- [ ] **Step 1: Write the failing test**

Create `src/screens/Rebase.merge.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import { RebaseScreen } from "./Rebase";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { mockInvoke } from "@/test/invokeMock";
import type { CommitInfo, RebaseStatus, RepoHandle } from "@/lib/types";

const handle: RepoHandle = { id: "repo-1", path: "/tmp/fake-repo", head: "refs/heads/main" };
const SWEPT: RebaseStatus = { inProgress: false, nextIndex: 0, total: 0, pauseReason: null };

function mk(oid: string, summary: string, parents: string[]): CommitInfo {
  return {
    oid,
    shortOid: oid.slice(0, 7),
    summary,
    body: null,
    author: "Tester",
    email: "t@e.com",
    timestamp: 1_700_000_000,
    parents,
    refs: [],
  };
}

const M = "m".repeat(40);
const C = "c".repeat(40);
const F = "f".repeat(40);
const A = "a".repeat(40);

const commits = [
  mk(M, "Merge branch 'feature'", [C, F]),
  mk(C, "C on main", [A]),
  mk(F, "F on feature", [A]),
  mk(A, "A on main", ["0".repeat(40)]),
];

beforeEach(() => {
  useRepoStore.setState({
    current: handle,
    status: [],
    allFiles: [],
    branches: [],
    tags: [],
    stashes: [],
    remotes: [],
    commits,
    loading: false,
    error: null,
    repoState: "Clean",
    rebaseStatus: SWEPT,
    lastRebaseSummary: null,
    activity: {},
  });
  mockInvoke("rebase_status", () => SWEPT);
  useNavStore.setState({
    intent: {
      kind: "rebase-plan",
      plan: [
        { oid: F, action: "Pick", message: null },
        { oid: C, action: "Pick", message: null },
        { oid: M, action: "Drop", message: null },
      ],
    },
  });
});

describe("RebaseScreen with merge commits in the plan", () => {
  it("warns that the merge will be flattened, counting the merges", async () => {
    render(<RebaseScreen />);
    const warning = await screen.findByTestId("rebase-merge-warning");
    expect(warning.textContent).toContain("1 merge commit");
    expect(warning.textContent).toContain("linear");
  });

  it("badges the merge row and restricts its actions", async () => {
    render(<RebaseScreen />);
    const rows = await screen.findAllByTestId("rebase-row");
    const mergeRow = rows.find((r) => r.getAttribute("data-sha") === M.slice(0, 7));
    expect(mergeRow).toBeDefined();
    expect(mergeRow!.querySelector('[data-testid="rebase-row-badge"]')?.textContent).toBe("merge");
    const values = [...mergeRow!.querySelectorAll("option")].map((o) => o.getAttribute("value"));
    expect(values).toEqual(["Drop", "MainlinePick"]);
  });

  it("says nothing when the range has no merges", async () => {
    useNavStore.setState({
      intent: {
        kind: "rebase-plan",
        plan: [{ oid: C, action: "Pick", message: null }],
      },
    });
    render(<RebaseScreen />);
    await screen.findAllByTestId("rebase-row");
    expect(screen.queryByTestId("rebase-merge-warning")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test src/screens/Rebase.merge.test.tsx
```

Expected: fails — no warning strip, no badge, the merge row offers all six actions.

- [ ] **Step 3: Implement**

In `src/screens/Rebase.tsx`:

Add `isMerge` to `PlanRow` and set it in both plan sources.

```tsx
interface PlanRow {
  oid: string;
  shortOid: string;
  subject: string;
  action: RebaseAction;
  message: string;
  /** More than one parent — actions are restricted and the row is badged. */
  isMerge: boolean;
}

/** Actions that mean anything for a merge row; mirrors rebase_plan::merge_legal. */
const MERGE_ACTIONS: RebaseAction[] = ["Drop", "MainlinePick"];

function commitsToPlan(commits: CommitInfo[]): PlanRow[] {
  // Present commits oldest-first (log is newest-first).
  return [...commits].reverse().map((c) => {
    const isMerge = c.parents.length > 1;
    return {
      oid: c.oid,
      shortOid: c.shortOid,
      subject: c.summary,
      // A merge defaults to Drop: that is git's own flattening behaviour, and
      // the backend refuses anything but Drop/MainlinePick on a merge.
      action: (isMerge ? "Drop" : "Pick") as RebaseAction,
      message: "",
      isMerge,
    };
  });
}
```

In the NavIntent effect, carry the flag through:

```tsx
    const rows: PlanRow[] = intent.plan.map((step) => {
      const c = byOid.get(step.oid);
      const isMerge = (c?.parents.length ?? 0) > 1;
      return {
        oid: step.oid,
        shortOid: c?.shortOid ?? step.oid.slice(0, 7),
        subject: c?.summary ?? "",
        action: isMerge && !MERGE_ACTIONS.includes(step.action) ? "Drop" : step.action,
        message: step.message ?? "",
        isMerge,
      };
    });
```

Add the count and the strip. Above the `return`, next to the other derived values:

```tsx
  const mergeCount = plan.filter((r) => r.isMerge).length;
  const flattenedCount = plan.filter((r) => r.isMerge && r.action === "Drop").length;
```

And render it directly above the rows pane (inside the `!rebaseStatus.inProgress` block, after the toolbar):

```tsx
          {mergeCount > 0 && (
            <div
              data-testid="rebase-merge-warning"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 12px",
                borderBottom: "1px solid var(--border-0)",
                background: "oklch(from var(--git-modified) l c h / 0.12)",
                color: "var(--fg-1)",
                fontSize: "var(--fs-12)",
              }}
            >
              <PGIcon name="warn" size={14} style={{ color: "var(--git-modified)" }} />
              <span>
                {mergeCount === 1 ? "1 merge commit" : `${mergeCount} merge commits`} in this
                range.{" "}
                {flattenedCount > 0 && (
                  <>
                    {flattenedCount === mergeCount
                      ? "It will be"
                      : `${flattenedCount} will be`}{" "}
                    flattened — the branch becomes linear, and the merged
                    commits are replayed individually.{" "}
                  </>
                )}
                Choose <strong>keep as one</strong> on a merge row to keep it as a single commit
                instead.
              </span>
            </div>
          )}
```

Import `PGIcon` from `@/design` at the top of the file. The glyph is `warn` (`src/design/icons.tsx`); there is no `warning` key.

Pass the restrictions to the row:

```tsx
                      <PGRebaseRow
                        index={i + 1}
                        sha={row.shortOid}
                        subject={row.subject}
                        action={row.action}
                        badge={row.isMerge ? "merge" : undefined}
                        options={row.isMerge ? MERGE_ACTIONS : undefined}
                        onActionChange={(v) => updateRow(i, { action: v })}
                      />
```

The message textarea condition stays `row.action === "Reword" || row.action === "Squash"` — neither is reachable on a merge row now.

- [ ] **Step 4: Run the tests**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test src/screens/Rebase
pnpm tsc --noEmit
```

Expected: the three new tests pass; the existing `Rebase.test.tsx` still passes.

- [ ] **Step 5: Commit**

```bash
git add src/screens/Rebase.tsx src/screens/Rebase.merge.test.tsx
git commit -m "feat(rebase): badge merge rows and warn that flattening is linear

Why: a range containing a merge silently produced a plan the backend
rejects. Merge rows now default to drop, are badged, offer only the two
actions that mean anything for a merge, and the screen states up front
that the branch becomes linear."
```

---

### Task 5: E2E — a real flattening run over a merge

**Files:**
- Modify: `e2e/support/tempRepo.ts`
- Modify: `e2e/specs/rebase.e2e.ts`

**Interfaces:**
- Produces: `mergeRangeRepo(): TempRepo` — `root → A → (feature: F) → C → M`, `main` checked out at `M`.

- [ ] **Step 1: Read the e2e skill first**

```bash
cat .claude/skills/e2e-testing/SKILL.md
```

Selector conventions, the 5s-per-command penalty, native-dialog stubbing, and rebuild discipline all apply below.

- [ ] **Step 2: Add the fixture**

In `e2e/support/tempRepo.ts`, after `rebaseConflictRepo`, following the style of the fixtures already there (they shell out through `repo.git(...)`):

```ts
/**
 * A range with a merge commit in the middle:
 *
 *   root ── A ──── C ── M   (main)
 *            \        /
 *             ─── F ──      (feature)
 *
 * F and C touch different files, so M merges cleanly. Used by the interactive
 * rebase spec: a rebase from A must flatten M away and keep F's content.
 */
export function mergeRangeRepo(): TempRepo {
  const r = new TempRepo();
  r.commitFile("root.txt", "root\n", "feat: root");
  r.commitFile("a.txt", "a\n", "feat: a on main");
  r.git("checkout", "-b", "feature");
  r.commitFile("f.txt", "f\n", "feat: f on feature");
  r.git("checkout", "main");
  r.commitFile("c.txt", "c\n", "feat: c on main");
  r.git("merge", "--no-ff", "-m", "Merge branch 'feature'", "feature");
  return r;
}
```

`TempRepo` exposes `commitFile(rel, content, msg)`, `write`, `git`, `read`, `headSha`, `hasRef`, and `dispose` (`e2e/support/tempRepo.ts`) — the same helpers `basicRepo` and `rebaseConflictRepo` use.

- [ ] **Step 3: Write the failing spec**

Append to `e2e/specs/rebase.e2e.ts`, inside the existing `describe("interactive rebase")`:

```ts
  it("flattens a merge commit out of the range", async () => {
    repo = mergeRangeRepo();
    await openRepo(repo.path);
    await stubNativeDialogs({ confirm: true });
    await switchScreen("history");
    await scrollCommitListTo("feat: a on main");
    // "Interactive rebase from here" on A puts everything after A in the plan:
    // F, C, and the merge M.
    await jsContextMenu('[data-testid="commit-row"]', { text: "feat: a on main" });
    await jsClickMenuItem("Interactive rebase from here");

    const warning = $('[data-testid="rebase-merge-warning"]');
    await warning.waitForDisplayed({
      timeout: 15_000,
      timeoutMsg: "merge warning never appeared for a range containing a merge",
    });
    expect(await warning.getText()).toContain("1 merge commit");

    await $('[data-testid="rebase-start"]').click();
    await $('[data-testid="rebase-last-summary"]').waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "flattening rebase never reported completion",
    });

    // The merge is gone, the side branch's commit and file survived, and the
    // history is linear.
    expect(repo.git("log", "--oneline", "--merges").trim()).toBe("");
    expect(repo.git("log", "--format=%s").trim().split("\n")).toEqual([
      "feat: c on main",
      "feat: f on feature",
      "feat: a on main",
      "feat: root",
    ]);
    expect(repo.git("status", "--porcelain").trim()).toBe("");
  });
```

Add `mergeRangeRepo` to the spec's import from `../support/tempRepo`.

- [ ] **Step 4: Build the snapshot and run just this spec**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm exec tsc -p e2e/tsconfig.json --noEmit
pnpm test:e2e:docker build
pnpm test:e2e:docker run --spec e2e/specs/rebase.e2e.ts
```

Expected: the whole rebase spec file passes, including the new test. Never run e2e natively.

- [ ] **Step 5: Commit**

```bash
git add e2e/support/tempRepo.ts e2e/specs/rebase.e2e.ts
git commit -m "test(e2e): rebase a range containing a merge commit"
```

---

### Task 6: Whole-suite gate, docs, PR

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Run every layer**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tsc --noEmit
pnpm test
pnpm exec tsc -p e2e/tsconfig.json --noEmit
pnpm test:e2e:docker run --spec e2e/specs/rebase.e2e.ts
```

- [ ] **Step 2: Document the flatten contract**

In `CLAUDE.md`, under Conventions, extend the rebase note added by PR1:

```markdown
- **Merge commits in a rebase plan** may only be `Drop` (flatten — git's own
  default, side-branch commits replayed individually) or `MainlinePick` (keep the
  merge as one ordinary commit, `cherry-pick -m 1`). `rebase_plan::merge_legal`
  is the single source of truth; `MERGE_ACTIONS` in `src/screens/Rebase.tsx`
  mirrors it, and the two must stay in sync or the UI offers an action the
  backend refuses.
```

- [ ] **Step 3: Commit and open the PR**

```bash
git add CLAUDE.md
git commit -m "docs: note which rebase actions a merge commit accepts"
git push -u origin HEAD
gh pr create --title "feat(rebase): flatten merge commits with the plan saying so" --body "$(cat <<'EOF'
## What

PR2 of three from `docs/superpowers/specs/2026-08-14-rebase-merge-commits-design.md`.

PR1 made a merge in a rebase plan a clean pre-flight rejection. This PR makes the
UI produce a plan that works, and explains it:

- Merge rows default to `Drop` — git's own flattening behaviour: the merge
  disappears and its side-branch commits are replayed individually.
- New `RebaseAction::MainlinePick` (`git cherry-pick -m 1`) keeps a merge as one
  ordinary commit with its original message.
- Merge rows are badged and offer only those two actions; a warning strip above
  the plan states how many merges are in range and that the branch becomes linear.
- `PGRebaseRow` now speaks exact `RebaseAction` values instead of lowercasing
  them and re-capitalising on the way back.

## Testing

`cargo test` (new: `rebase_flatten.rs`), `pnpm test` (new:
`buildRebasePlan.merge.test.ts`, `git-components.rebaseRow.test.tsx`,
`Rebase.merge.test.tsx`), `pnpm tsc --noEmit`, and
`pnpm test:e2e:docker run --spec e2e/specs/rebase.e2e.ts` (new flattening spec).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
