# Interactive rebase onto any commit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pick any commit or branch as a new base and replay the current branch onto it through the interactive Rebase screen — `git rebase -i <newbase>`.

**Architecture:** The backend already does this: `rebase_start` takes the run's base from the first non-Drop step's `onto`, and `rebase_plan::validate` accepts an `onto` below the range with no ancestry check. So the work is (a) a range from `commitsBetween` instead of `commitsSince` when the base is diverged, with the limit derived from `aheadBehind` so a plan can never be silently truncated, (b) one pure helper that attaches the base to the plan's first non-Drop step at submit time, and (c) a new `rebase-onto` NavIntent plus three context-menu entry points.

**Tech Stack:** Rust (git2/libgit2) + Tauri 2 backend; React 19 + TypeScript + Zustand frontend; vitest (jsdom + node projects); `cargo test` integration suite over real temp repos.

**Spec:** `docs/superpowers/specs/2026-08-19-rebase-onto-any-commit-spec.md`

## Global Constraints

- Toolchain: Node 22 + **pnpm** (at `~/Library/pnpm`), Rust stable at `~/.cargo/bin`. Every shell step must be prefixed with `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"`.
- Gates, all four: `pnpm tsc --noEmit`, `pnpm test`, `pnpm exec tsc -p e2e/tsconfig.json --noEmit`, `cargo test --manifest-path src-tauri/Cargo.toml`.
- **Do NOT loosen `commits_since`.** Its ancestor requirement is an invariant of the on-branch flow.
- **`BranchInfo.tip` is a FULL oid.** Never shorten it at the source; `shortSha` belongs at display sites only.
- Frontend never calls `invoke()` directly — only the typed wrappers in `src/lib/tauri.ts`.
- Every new `NavIntent` kind needs a `case` in `AppShell.tsx`'s routing switch **and** a row in `AppShell.navroutes.test.tsx`'s `EXPECTED` table. Both are compile-enforced.
- Any new row surface opts into UI density via `var(--row-step)`. (Nothing here adds a list row; the two new strips are chrome, which stays fixed.)
- E2E runs **only** through `pnpm test:e2e:docker` — never natively. One cold container build at a time across all worktrees.
- Commit style: Conventional Commits, imperative subject under 72 chars, `Co-Authored-By: Claude …` trailer.

---

## File Structure

**Create**

| File | Responsibility |
| --- | --- |
| `src/features/commits/withPlanBase.ts` | PURE: attach a run's base to a plan's first non-Drop step. |
| `src/features/commits/withPlanBase.test.ts` | Its unit tests (node-grade pure logic). |
| `src/screens/Rebase.onto.test.tsx` | Component tests for the diverged-base flow on the Rebase screen. |
| `src-tauri/tests/rebase_onto_new_base.rs` | Rust integration: replay a branch onto a genuinely diverged base. |

**Modify**

| File | Change |
| --- | --- |
| `src/features/nav/useNavStore.ts` | Add the `rebase-onto` intent kind. |
| `src/AppShell.tsx` | Route `rebase-onto` → `rebase`. |
| `src/AppShell.navroutes.test.tsx` | `EXPECTED` row for `rebase-onto`. |
| `src/screens/Rebase.tsx` | One `resolveBase` path (aheadBehind → commitsSince/commitsBetween), `baseRev`/`baseStats`/`baseNotice` state, the summary strip, the out-of-picker notice strip, `withPlanBase` at submit. |
| `src/features/rebase/RebaseBasePicker.tsx` | Delete the dead `invalidOids` prop. |
| `src/design/context-menu.tsx` | Three new menu items + a `branchTipOid` helper. |
| `src/features/commits/buildPreservePlan.ts` | Doc comment: the first step's base now comes from `withPlanBase`. |
| `CLAUDE.md` | Spec/plan list entry, the interactive-rebase-engine bullets, the nav-intent list. |
| `e2e/specs/rebase.e2e.ts` | One case for the new flow (Task 8, gated on a cheap fixture). |

---

### Task 1: `withPlanBase` — the pure base attachment

**Files:**
- Create: `src/features/commits/withPlanBase.ts`
- Test: `src/features/commits/withPlanBase.test.ts`

**Interfaces:**
- Consumes: `RebaseStep`, `RebaseAction` from `@/lib/types`.
- Produces: `withPlanBase(steps: RebaseStep[], baseOid: string | null): RebaseStep[]`.

- [ ] **Step 1: Write the failing test**

Create `src/features/commits/withPlanBase.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { withPlanBase } from "./withPlanBase";
import type { RebaseStep } from "@/lib/types";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const BASE = "9".repeat(40);

function step(oid: string, over: Partial<RebaseStep> = {}): RebaseStep {
  return { oid, action: "Pick", message: null, onto: null, mergeParents: [], ...over };
}

describe("withPlanBase", () => {
  it("names the base on the first step and leaves the rest linear", () => {
    const out = withPlanBase([step(A), step(B), step(C)], BASE);
    expect(out.map((s) => s.onto)).toEqual([BASE, null, null]);
  });

  it("skips leading drops — the engine reads the first NON-Drop step", () => {
    const out = withPlanBase(
      [step(A, { action: "Drop" }), step(B), step(C)],
      BASE,
    );
    expect(out.map((s) => s.onto)).toEqual([null, BASE, null]);
  });

  it("leaves an intermediate step's own base alone (the preserve case)", () => {
    const out = withPlanBase([step(A), step(B, { onto: A }), step(C)], BASE);
    expect(out.map((s) => s.onto)).toEqual([BASE, A, null]);
  });

  it("overwrites the first step's own base — a picked base outranks it", () => {
    const out = withPlanBase([step(A, { onto: C }), step(B)], BASE);
    expect(out[0].onto).toBe(BASE);
  });

  it("is the identity when no base is known", () => {
    const plan = [step(A), step(B)];
    expect(withPlanBase(plan, null)).toBe(plan);
  });

  it("is the identity for an all-Drop plan (the backend refuses it anyway)", () => {
    const plan = [step(A, { action: "Drop" }), step(B, { action: "Drop" })];
    expect(withPlanBase(plan, BASE).map((s) => s.onto)).toEqual([null, null]);
  });

  it("does not mutate its input", () => {
    const plan = [step(A), step(B)];
    withPlanBase(plan, BASE);
    expect(plan[0].onto).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm vitest run --project unit src/features/commits/withPlanBase.test.ts
```

Expected: FAIL — `Failed to resolve import "./withPlanBase"`.

- [ ] **Step 3: Write the implementation**

Create `src/features/commits/withPlanBase.ts`:

```ts
import type { RebaseStep } from "@/lib/types";

/**
 * Attach a run's base to a plan: `onto: baseOid` on the FIRST non-Drop step.
 *
 * `rebase_start` takes the run's base from exactly that step's `onto`, falling
 * back to its first parent when there is none (`libgit2.rs`). Naming the base
 * explicitly is what makes a plan `git rebase --onto <base>` — the whole reason a
 * diverged base works at all — and `rebase_plan::validate` accepts any existing
 * commit there, with no ancestry requirement.
 *
 * Call this at SUBMIT, never when the rows are built. Flatten mode lets the user
 * reorder the plan, and the base belongs to the plan's first step rather than to
 * the row that happened to be first when it was built: pinned at build time, a
 * row dragged out of first place would take the base with it and the run would
 * detach somewhere else.
 *
 * `baseOid: null` means "nothing better than the engine's parent fallback is
 * known" (a root commit, or an oldest step outside the loaded log) and returns
 * the plan untouched. `baseOid` may be any revspec — an oid, a prefix, a branch
 * name — because both the validator and the engine `revparse_single` it.
 */
export function withPlanBase(
  steps: RebaseStep[],
  baseOid: string | null,
): RebaseStep[] {
  if (!baseOid) return steps;
  const first = steps.findIndex((s) => s.action !== "Drop");
  if (first < 0) return steps;
  return steps.map((s, i) => (i === first ? { ...s, onto: baseOid } : s));
}
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
pnpm vitest run --project unit src/features/commits/withPlanBase.test.ts
```

Expected: 7 passing.

- [ ] **Step 5: Mutation-check**

Change `s.action !== "Drop"` to `true` (i.e. `const first = 0;`), re-run, and
confirm the leading-drops test fails. Restore. Then change the returned object to
`{ ...s }` (no `onto`), re-run, confirm the first two tests fail. Restore.

- [ ] **Step 6: Commit**

```bash
git add src/features/commits/withPlanBase.ts src/features/commits/withPlanBase.test.ts
git commit -m "feat(rebase): pure helper naming a plan's base on its first step"
```

---

### Task 2: The `rebase-onto` NavIntent and its routing

**Files:**
- Modify: `src/features/nav/useNavStore.ts` (the `NavIntent` union)
- Modify: `src/AppShell.tsx` (the routing switch, near `case "rebase-plan":`)
- Test: `src/AppShell.navroutes.test.tsx` (the `EXPECTED` table)

**Interfaces:**
- Produces: `{ kind: "rebase-onto"; base: string; label: string }` on `NavIntent`. `base` is any revspec (full oid preferred); `label` is display text — for a commit `"abc1234 — subject"`, for a branch its name.

- [ ] **Step 1: Write the failing test**

In `src/AppShell.navroutes.test.tsx`, add to `EXPECTED` right after the
`"rebase-plan"` row:

```ts
  // The diverged-base flow (186). The intent names a base and nothing else —
  // the SCREEN resolves the range, because the log is paged and a branch menu
  // has no commit list at all.
  "rebase-onto": {
    intent: { kind: "rebase-onto", base: OID2, label: "other" },
    screen: "rebase",
  },
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm vitest run --project unit src/AppShell.navroutes.test.tsx
```

Expected: FAIL — TypeScript rejects `"rebase-onto"` as an unknown key of the
mapped type (and, once the union has it, the run fails on `assertNever`).

- [ ] **Step 3: Add the kind and route it**

In `src/features/nav/useNavStore.ts`, after the `rebase-plan` member:

```ts
  | { kind: "rebase-plan"; plan: RebaseStep[] }
  /**
   * Replay the current branch onto a NEW base, interactively (186) — the
   * `git rebase -i <newbase>` half. `base` is any revspec (a full oid where the
   * caller has one, else a branch name); `label` is what to call it on screen.
   *
   * Deliberately NOT a `rebase-plan` carrying a base: the range is `base..HEAD`
   * and only the backend can walk it. The log is PAGED, so a plan assembled from
   * `useRepoStore.commits` would silently come up short for exactly the diverged
   * bases this exists for — and a branch context menu has a name, not commits.
   */
  | { kind: "rebase-onto"; base: string; label: string }
```

In `src/AppShell.tsx`, extend the existing case:

```ts
      case "rebase-plan":
      // The base-only variant (186). Same destination: the Rebase screen owns
      // the range walk and the plan either way.
      case "rebase-onto":
        setScreen("rebase");
        break;
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
pnpm vitest run --project unit src/AppShell.navroutes.test.tsx
```

Expected: all rows pass, including `sends "rebase-onto" to rebase`.

- [ ] **Step 5: Mutation-check**

Delete `case "rebase-onto":` from `AppShell.tsx` and re-run: the row must fail
with `expected "history" to be "rebase"` (and `tsc` must fail on `assertNever`).
Restore.

- [ ] **Step 6: Commit**

```bash
git add src/features/nav/useNavStore.ts src/AppShell.tsx src/AppShell.navroutes.test.tsx
git commit -m "feat(nav): rebase-onto intent routed to the Rebase screen"
```

---

### Task 3: The Rebase screen resolves any base

**Files:**
- Modify: `src/screens/Rebase.tsx`
- Test: `src/screens/Rebase.onto.test.tsx` (create)

**Interfaces:**
- Consumes: `withPlanBase` (Task 1); `rebase-onto` (Task 2); `aheadBehind`, `commitsBetween`, `commitsSince` from `@/lib/tauri`; `AheadBehind` from `@/lib/types`.
- Produces: `data-testid="rebase-base-summary"` and `data-testid="rebase-base-notice"` on the screen.

- [ ] **Step 1: Write the failing test**

Create `src/screens/Rebase.onto.test.tsx`:

```tsx
// The diverged-base flow (186): a `rebase-onto` intent names a base, the screen
// walks `base..HEAD` on the backend, and the submitted plan carries that base on
// its first non-Drop step.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RebaseScreen } from "./Rebase";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { mockInvoke } from "@/test/invokeMock";
import type { CommitInfo, RebaseStatus, RebaseStep, RepoHandle } from "@/lib/types";

const handle: RepoHandle = { id: "repo-1", path: "/tmp/fake-repo", head: "refs/heads/main" };

const SWEPT: RebaseStatus = {
  inProgress: false,
  nextIndex: 0,
  total: 0,
  pauseReason: null,
  lastCompleted: null,
};

const BASE = "9".repeat(40);
const ROOT = "0".repeat(40);

function mk(oid: string, summary: string, parent: string): CommitInfo {
  return {
    oid,
    shortOid: oid.slice(0, 7),
    summary,
    body: null,
    author: "Tester",
    email: "t@example.com",
    timestamp: 1_700_000_000,
    parents: [parent],
    refs: [],
  };
}

/** `base..HEAD`, newest-first — what `commits_between` returns. */
const RANGE = [
  mk("c".repeat(40), "feat: third", "b".repeat(40)),
  mk("b".repeat(40), "feat: second", "a".repeat(40)),
  mk("a".repeat(40), "feat: first", ROOT),
];

/** Records what the screen actually submitted. */
function wire(opts: {
  ahead: number;
  behind: number;
  mergeBase: string | null;
  range?: CommitInfo[];
}): { started: () => RebaseStep[][]; betweenLimits: () => Array<number | undefined> } {
  const started: RebaseStep[][] = [];
  const betweenLimits: Array<number | undefined> = [];
  mockInvoke("get_status", () => []);
  mockInvoke("list_branches", () => []);
  mockInvoke("list_tags", () => []);
  mockInvoke("list_stashes", () => []);
  mockInvoke("list_remotes", () => []);
  mockInvoke("get_log_page", () => ({ commits: RANGE, nextCursor: null }));
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("rebase_status", () => SWEPT);
  mockInvoke("ahead_behind", () => ({
    ahead: opts.ahead,
    behind: opts.behind,
    mergeBase: opts.mergeBase,
  }));
  mockInvoke("commits_between", (args) => {
    betweenLimits.push((args as { limit?: number }).limit);
    return opts.range ?? RANGE;
  });
  mockInvoke("commits_since", () => opts.range ?? RANGE);
  mockInvoke("rebase_start", (args) => {
    started.push((args as { plan: RebaseStep[] }).plan);
    return SWEPT;
  });
  return { started: () => started, betweenLimits: () => betweenLimits };
}

function seedOntoIntent(): void {
  useNavStore.setState({ intent: { kind: "rebase-onto", base: BASE, label: "other" } });
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  useRepoStore.setState({
    current: handle,
    status: [],
    allFiles: [],
    branches: [],
    tags: [],
    stashes: [],
    remotes: [],
    commits: RANGE,
    loading: false,
    error: null,
    repoState: "Clean",
    rebaseStatus: SWEPT,
    activity: {},
  } as never);
  useNavStore.setState({ intent: null });
});

describe("RebaseScreen — a diverged base", () => {
  it("plans base..HEAD and submits the base on the first step", async () => {
    const rec = wire({ ahead: 3, behind: 2, mergeBase: ROOT });
    seedOntoIntent();
    render(<RebaseScreen />);

    await waitFor(() => expect(screen.getAllByText(/feat: /)).toHaveLength(3));
    // The limit is derived from `ahead`, never left to the handler's default of
    // 200 — a truncated plan would drop commits and still move the branch ref.
    expect(rec.betweenLimits()).toEqual([4]);

    await userEvent.click(screen.getByTestId("rebase-start"));

    await waitFor(() => expect(rec.started()).toHaveLength(1));
    const plan = rec.started()[0];
    expect(plan.map((s) => s.oid)).toEqual([
      "a".repeat(40),
      "b".repeat(40),
      "c".repeat(40),
    ]);
    expect(plan.map((s) => s.onto)).toEqual([BASE, null, null]);
  });

  it("states what will be replayed, including the merge base", async () => {
    wire({ ahead: 3, behind: 2, mergeBase: ROOT });
    seedOntoIntent();
    render(<RebaseScreen />);

    const strip = await screen.findByTestId("rebase-base-summary");
    expect(strip).toHaveTextContent("3 commits will be replayed onto other.");
    expect(strip).toHaveTextContent("other has 2 commits this branch does not.");
    expect(strip).toHaveTextContent(`Merge base ${ROOT.slice(0, 7)}.`);
  });

  it("warns when the histories are unrelated", async () => {
    wire({ ahead: 3, behind: 2, mergeBase: null });
    seedOntoIntent();
    render(<RebaseScreen />);

    const strip = await screen.findByTestId("rebase-base-summary");
    expect(strip).toHaveTextContent("No common ancestor");
  });

  it("shows a visible notice and no plan when there is nothing to replay", async () => {
    const rec = wire({ ahead: 0, behind: 4, mergeBase: ROOT });
    seedOntoIntent();
    render(<RebaseScreen />);

    // The picker is CLOSED here — an intent has no anchor — so the notice has to
    // live on the screen or the menu item would fail in total silence.
    const notice = await screen.findByTestId("rebase-base-notice");
    expect(notice).toHaveTextContent("No commits between HEAD and other.");
    expect(screen.getByTestId("rebase-start")).toBeDisabled();
    expect(rec.betweenLimits()).toEqual([]);
  });

  it("refuses a partial range rather than planning a truncated rebase", async () => {
    wire({ ahead: 3, behind: 2, mergeBase: ROOT, range: RANGE.slice(0, 2) });
    seedOntoIntent();
    render(<RebaseScreen />);

    const notice = await screen.findByTestId("rebase-base-notice");
    expect(notice).toHaveTextContent("partial rebase");
    expect(screen.getByTestId("rebase-start")).toBeDisabled();
  });

  it("keeps the base on the first step after a reorder", async () => {
    const rec = wire({ ahead: 3, behind: 2, mergeBase: ROOT });
    seedOntoIntent();
    render(<RebaseScreen />);

    await waitFor(() => expect(screen.getAllByTestId("rebase-move-up")).toHaveLength(3));
    // Move the newest commit (row 3) to the top. Without withPlanBase running at
    // SUBMIT, the base would still be sitting on the row that used to be first.
    await userEvent.click(screen.getAllByTestId("rebase-move-up")[2]);
    await userEvent.click(screen.getAllByTestId("rebase-move-up")[1]);

    await userEvent.click(screen.getByTestId("rebase-start"));
    await waitFor(() => expect(rec.started()).toHaveLength(1));
    const plan = rec.started()[0];
    expect(plan[0].oid).toBe("c".repeat(40));
    expect(plan.map((s) => s.onto)).toEqual([BASE, null, null]);
  });

  it("uses commits_since — not commits_between — for an ancestor base", async () => {
    const rec = wire({ ahead: 3, behind: 0, mergeBase: BASE });
    seedOntoIntent();
    render(<RebaseScreen />);

    await waitFor(() => expect(screen.getAllByText(/feat: /)).toHaveLength(3));
    expect(rec.betweenLimits()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm vitest run --project unit src/screens/Rebase.onto.test.tsx
```

Expected: FAIL — no `rebase-base-summary`, no plan built (the screen ignores the
new intent kind).

- [ ] **Step 3: Implement — imports and state**

In `src/screens/Rebase.tsx`, replace the `commitsSince` import line with:

```ts
import { aheadBehind, commitsBetween, commitsSince } from "@/lib/tauri";
```

Add `AheadBehind` to the type import from `@/lib/types`, and import the helper:

```ts
import { withPlanBase } from "@/features/commits/withPlanBase";
```

Replace the `baseLabel` / `pickerNotice` state declarations with:

```ts
  const [baseLabel, setBaseLabel] = useState<string | null>(null);
  /**
   * The revspec the run detaches at, carried to submit by `withPlanBase`. Any
   * revspec is legal (a full oid where we have one, a prefix from the picker's
   * hash row, a branch name from a branch menu) because both the validator and
   * the engine `revparse_single` it. Null means "use the engine's parent
   * fallback" — a root commit, or an oldest step outside the loaded log.
   */
  const [baseRev, setBaseRev] = useState<string | null>(null);
  /** Counts for the summary strip; only a RESOLVED base has them. */
  const [baseStats, setBaseStats] = useState<AheadBehind | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [baseNotice, setBaseNotice] = useState<string | null>(null);
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);
```

- [ ] **Step 4: Implement — the one `resolveBase` path**

Replace the whole `handlePickBase` callback with:

```ts
  /**
   * Resolve a base to a range and a plan. ONE path for the picker and for a
   * `rebase-onto` intent, so the strip's counts and the plan can never describe
   * different ranges.
   *
   * `aheadBehind` comes first because its answer chooses the primitive, with no
   * failed round trip:
   *   - ahead === 0  → nothing to replay (base is HEAD, or a descendant of it).
   *   - behind === 0 → base is an ANCESTOR of HEAD, by graph_ahead_behind's own
   *     definition: nothing reachable from base is missing from HEAD. That is
   *     `commitsSince`'s domain — the unchanged path, and the one primitive that
   *     enforces the invariant, so it keeps its only caller.
   *   - behind > 0   → diverged (or unrelated): `commitsBetween`, which requires
   *     no ancestry (#131).
   *
   * `commits_between`'s handler defaults `limit` to 200 and simply breaks at the
   * cap, so the limit is derived from the exact count and the length is verified.
   * A silently truncated plan would leave commits unreplayed and still move the
   * branch ref — refuse instead.
   */
  const resolveBase = useCallback(
    async (rev: string, label: string) => {
      if (!current) return;
      const baseName = label.split(" — ")[0];
      try {
        const stats = await aheadBehind(current.id, rev, "HEAD");
        if (stats.ahead === 0) {
          setBaseNotice(`No commits between HEAD and ${baseName}.`);
          return;
        }
        const next =
          stats.behind === 0
            ? await commitsSince(current.id, rev)
            : await commitsBetween(current.id, rev, "HEAD", stats.ahead + 1);
        if (next.length !== stats.ahead) {
          setBaseNotice(
            `Read ${next.length} of ${stats.ahead} commits between ${baseName} and HEAD — refusing to plan a partial rebase.`,
          );
          return;
        }
        setRange(next);
        setPlan(commitsToPlan(next, mergeMode));
        setBaseRev(rev);
        setBaseLabel(label);
        setBaseStats(stats);
        setBaseNotice(null);
        setPickerOpen(false);
      } catch (e) {
        setBaseNotice(appErrorMessage(e));
      }
    },
    [current, mergeMode],
  );
```

- [ ] **Step 5: Implement — handle the intent, and remember every plan's base**

In the existing `rebase-plan` effect, change the guard and add the new branch at
the top:

```ts
  React.useEffect(() => {
    if (intent?.kind === "rebase-onto") {
      void resolveBase(intent.base, intent.label);
      clearIntent();
      return;
    }
    if (intent?.kind !== "rebase-plan") return;
```

Further down in the same effect, where the base label is derived, also store the
oid — a plan whose base is known cannot have it moved by a reorder:

```ts
    setBaseRev(baseOid ?? null);
    setBaseStats(null);
    setBaseNotice(null);
    setBaseLabel(
```

and add `resolveBase` to that effect's dependency array.

In `handleClear`, reset the new state too:

```ts
  const handleClear = () => {
    setPlan([]);
    setRange([]);
    setBaseLabel(null);
    setBaseRev(null);
    setBaseStats(null);
    setBaseNotice(null);
  };
```

and in `handleStart`'s success arm add `setBaseRev(null); setBaseStats(null);`
beside the existing `setBaseLabel(null)`.

- [ ] **Step 6: Implement — attach the base at submit**

In `handleStart`, wrap the mapped steps:

```ts
    // The base rides on the plan's FIRST non-Drop step, attached HERE rather than
    // when the rows were built: flatten mode lets the user reorder, and
    // `rebase_start` reads the base off whatever step ends up first.
    const steps: RebaseStep[] = withPlanBase(
      plan.map((r) => ({
        oid: r.oid,
        action: r.action,
        message:
          r.action === "Reword" || r.action === "Squash" ? r.message || null : null,
        onto: r.onto,
        mergeParents: r.mergeParents,
      })),
      baseRev,
    );
```

- [ ] **Step 7: Implement — the two strips**

Immediately after the toolbar `</div>` and before the merge-count banner:

```tsx
          {/* What will be replayed. Once the base can be diverged, "everything
              newer than the base" stops being obvious — so say how many commits,
              what the base adds, and where the two histories met. */}
          {baseStats && baseLabel && plan.length > 0 && (
            <div
              data-testid="rebase-base-summary"
              style={{
                padding: "6px 12px",
                borderBottom: "1px solid var(--border-0)",
                background: "var(--bg-1)",
                color: "var(--fg-2)",
                fontSize: "var(--fs-12)",
              }}
            >
              {baseStats.ahead === 1
                ? "1 commit will be replayed onto "
                : `${baseStats.ahead} commits will be replayed onto `}
              {baseLabel.split(" — ")[0]}.
              {baseStats.behind > 0 && (
                <>
                  {" "}
                  {baseLabel.split(" — ")[0]} has {baseStats.behind}{" "}
                  {baseStats.behind === 1 ? "commit" : "commits"} this branch does not.
                </>
              )}
              {baseStats.behind > 0 && baseStats.mergeBase && (
                <> Merge base {baseStats.mergeBase.slice(0, 7)}.</>
              )}
              {baseStats.mergeBase === null && (
                <> No common ancestor — the whole branch will be replayed.</>
              )}
            </div>
          )}

          {/* A base can also fail to resolve, and the picker is not always open
              to say so: a context-menu intent has no anchor, so without this the
              menu item would do nothing at all and explain nothing. */}
          {baseNotice && !pickerOpen && (
            <div
              data-testid="rebase-base-notice"
              style={{
                padding: "6px 12px",
                borderBottom: "1px solid var(--git-conflict)",
                background: "oklch(from var(--git-conflict) l c h / 0.12)",
                color: "var(--fg-0)",
                fontSize: "var(--fs-12)",
              }}
            >
              {baseNotice}
            </div>
          )}
```

Finally, rewire the picker's props at the bottom of the file and the toolbar
button's notice reset:

```tsx
      <RebaseBasePicker
        anchor={pickerAnchor}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={resolveBase}
        notice={baseNotice}
      />
```

and in the "New rebase" / "Change base" button's `onClick`, replace
`setPickerNotice(null)` with `setBaseNotice(null)`.

- [ ] **Step 8: Run the tests**

```bash
pnpm vitest run --project unit src/screens/Rebase.onto.test.tsx src/screens/Rebase.test.tsx src/screens/Rebase.merge.test.tsx src/screens/Rebase.preserve.test.tsx src/screens/Rebase.reorder.test.tsx
```

Expected: all pass. (The existing four suites must stay green — `handleStart` now
attaches a base for intent plans too.)

- [ ] **Step 9: Mutation-check**

1. Change `stats.ahead + 1` to `undefined` (handler default 200): the
   `betweenLimits` assertion must fail.
2. Delete the `next.length !== stats.ahead` guard: the "refuses a partial range"
   test must fail.
3. Move `withPlanBase` from `handleStart` into `commitsToPlan`: the reorder test
   must fail.
4. Render the notice strip only when `pickerOpen`: the "nothing to replay" and
   "partial range" tests must fail.

Restore after each.

- [ ] **Step 10: Commit**

```bash
git add src/screens/Rebase.tsx src/screens/Rebase.onto.test.tsx
git commit -m "feat(rebase): plan a rebase onto any base, diverged or not"
```

---

### Task 4: Delete the dead `invalidOids` prop

**Files:**
- Modify: `src/features/rebase/RebaseBasePicker.tsx`

**Interfaces:**
- Produces: `RebaseBasePicker` with no `invalidOids` prop.

- [ ] **Step 1: Confirm it is dead**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
grep -rn "invalidOids" src/
```

Expected: only the three lines inside `RebaseBasePicker.tsx` — declaration,
destructure, and the `ineligible` read. No call site passes it.

- [ ] **Step 2: Remove it**

Delete from the `Props` interface:

```ts
  /** OIDs that are not on the current branch's history — used to mark rows as ineligible. */
  invalidOids?: Set<string>;
```

Delete `invalidOids,` from the destructured parameter list, and in `renderRow`
delete the `ineligible` line, the `title={ineligible ? … : undefined}` attribute
and the `opacity: ineligible ? 0.5 : 1` style. Add above `Props`:

```ts
// There is deliberately no "ineligible row" state (186). A prop for it existed
// and nothing ever passed it — and what it encoded, "not on the current branch's
// history", is now the primary reason to pick a base at all, so a live version
// would grey out exactly the rows this picker exists to offer. The genuine
// refusals (nothing to replay, an unresolvable revspec) are backend answers and
// arrive through `notice`.
```

- [ ] **Step 3: Verify**

```bash
pnpm tsc --noEmit && grep -rn "invalidOids" src/ ; echo "exit=$?"
```

Expected: `tsc` clean, `grep` finds nothing.

- [ ] **Step 4: Commit**

```bash
git add src/features/rebase/RebaseBasePicker.tsx
git commit -m "refactor(rebase): drop the base picker's never-passed invalidOids"
```

---

### Task 5: Three entry points

**Files:**
- Modify: `src/design/context-menu.tsx`

**Interfaces:**
- Consumes: `rebase-onto` (Task 2).
- Produces: a module-local `branchTipOid(name: string): string | null`.

- [ ] **Step 1: Add the tip lookup helper**

Next to `ancestryLog()` in `src/design/context-menu.tsx`:

```ts
/**
 * A branch's tip oid, for menu items that must name a fixed commit rather than a
 * moving ref (186). `BranchInfo.tip` is a FULL oid and is used as one — it was
 * once truncated to 7 chars and every comparison against `CommitInfo.oid` then
 * failed silently. Null when the branch is unknown or its tip is unresolvable;
 * the caller then falls back to the NAME, which the backend revparses anyway.
 */
function branchTipOid(name: string): string | null {
  return useRepoStore.getState().branches.find((b) => b.name === name)?.tip ?? null;
}
```

- [ ] **Step 2: The commit-menu item**

In `commitMenuItems`, immediately after the `Interactive rebase from here` item:

```ts
    {
      icon: "rebase",
      // The OTHER half of interactive rebase (186), and a genuinely different
      // action: "from here" makes the clicked commit the OLDEST REPLAYED commit
      // (base = its parent); this makes it the NEW BASE, which is not in the plan
      // at all. Disabled for a commit already on this branch, mirroring
      // branchMenuItems' `disabled: isCurrent` — replaying onto your own ancestor
      // is a no-op, and the item above is what that flow wants. So the two are
      // never both enabled for one commit.
      label: onBranch
        ? "Rebase current branch onto this — already on this branch"
        : "Rebase current branch onto this…",
      disabled: onBranch || !commit?.sha,
      onClick: () => {
        if (!commit?.sha) return;
        useNavStore.getState().setIntent({
          kind: "rebase-onto",
          base: commit.sha,
          label: `${sha.slice(0, 7)} — ${commit.subject ?? ""}`.trim(),
        });
      },
    },
```

- [ ] **Step 3: The local-branch item**

In `branchMenuItems`, immediately after the existing `Rebase current onto this`:

```ts
    {
      icon: "rebase",
      // No confirm, unlike the non-interactive sibling above: this rewrites
      // nothing. It opens a plan, and `Start rebase` is the destructive step.
      label: "Rebase current onto this — interactive…",
      disabled: isCurrent,
      onClick: () => {
        if (!name) return;
        useNavStore.getState().setIntent({
          kind: "rebase-onto",
          base: branchTipOid(name) ?? name,
          label: name,
        });
      },
    },
```

- [ ] **Step 4: The remote-branch item**

In `remoteBranchMenuItems`, immediately after its `Rebase current onto this`:

```ts
    {
      icon: "rebase",
      // Never disabled — a remote-tracking branch is never the current branch.
      label: "Rebase current onto this — interactive…",
      onClick: () => {
        if (!name) return;
        useNavStore.getState().setIntent({
          kind: "rebase-onto",
          base: branchTipOid(name) ?? name,
          label: name,
        });
      },
    },
```

- [ ] **Step 5: Verify**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit && pnpm vitest run --project unit
```

Expected: clean, and the whole `unit` project green.

- [ ] **Step 6: Commit**

```bash
git add src/design/context-menu.tsx
git commit -m "feat(history): rebase the current branch onto any commit or branch"
```

---

### Task 6: Rust integration — a genuinely diverged base

**Files:**
- Create: `src-tauri/tests/rebase_onto_new_base.rs`

**Interfaces:**
- Consumes: `support::TempRepo` (`with_initial_commit`, `open_with_backend`, `path`, `repo`), `support::git_in`, `GitBackend`, `RebaseAction`, `RebaseStep`.

- [ ] **Step 1: Write the failing test**

Create `src-tauri/tests/rebase_onto_new_base.rs`:

```rust
//! `git rebase -i <newbase>` — replaying a branch onto a base it does NOT
//! descend from (186).
//!
//! The engine already supports this: `rebase_start` takes the run's base from
//! the first non-Drop step's `onto`, and `rebase_plan::validate` accepts any
//! existing commit there with no ancestry requirement. These tests pin that,
//! because nothing else exercises an `onto` below the range — and pin the range
//! primitive split too: `commits_between` answers for a diverged pair,
//! `commits_since` refuses, and that refusal is deliberate.

mod support;

use platypusgit_lib::git::{
    types::{RebaseAction, RebaseStep},
    GitBackend,
};

use support::{git_in, TempRepo};

/// ```text
/// root ── A ── D ── E   (main, HEAD)
///     \
///      ─ B ── C         (other)
/// ```
/// Every commit touches its own file, so nothing conflicts.
struct Diverged {
    root: String,
    other_tip: String,
    main_tip: String,
}

fn diverged(tr: &TempRepo) -> Diverged {
    let root = git_in(tr.path(), &["rev-parse", "HEAD"]).trim().to_string();

    git_in(tr.path(), &["checkout", "-b", "other"]);
    tr.add_commit("b.txt", "b\n", "B on other");
    tr.add_commit("c.txt", "c\n", "C on other");
    let other_tip = git_in(tr.path(), &["rev-parse", "HEAD"]).trim().to_string();

    git_in(tr.path(), &["checkout", "main"]);
    tr.add_commit("a.txt", "a\n", "A on main");
    tr.add_commit("d.txt", "d\n", "D on main");
    tr.add_commit("e.txt", "e\n", "E on main");
    let main_tip = git_in(tr.path(), &["rev-parse", "HEAD"]).trim().to_string();

    Diverged { root, other_tip, main_tip }
}

fn step(oid: &str, onto: Option<&str>) -> RebaseStep {
    RebaseStep {
        oid: oid.to_string(),
        action: RebaseAction::Pick,
        message: None,
        onto: onto.map(|s| s.to_string()),
        merge_parents: Vec::new(),
    }
}

#[test]
fn commits_between_is_the_range_and_commits_since_refuses_it() {
    let tr = TempRepo::with_initial_commit("root\n");
    let h = diverged(&tr);
    let (backend, handle) = tr.open_with_backend();

    let range = backend
        .commits_between(&handle.id, &h.other_tip, "HEAD", 100)
        .unwrap();
    let summaries: Vec<&str> = range.iter().map(|c| c.summary.as_str()).collect();
    assert_eq!(
        summaries,
        vec!["E on main", "D on main", "A on main"],
        "base..HEAD is HEAD's commits not reachable from the new base"
    );

    // The invariant that stays: a rebase base for the ON-BRANCH flow must be an
    // ancestor. Loosening this is explicitly out of scope.
    assert!(
        backend.commits_since(&handle.id, &h.other_tip).is_err(),
        "commits_since must keep refusing a non-ancestor base"
    );
}

#[test]
fn replays_the_branch_onto_a_diverged_base() {
    let tr = TempRepo::with_initial_commit("root\n");
    let h = diverged(&tr);
    let (backend, handle) = tr.open_with_backend();

    let range = backend
        .commits_between(&handle.id, &h.other_tip, "HEAD", 100)
        .unwrap();
    // Oldest-first, with the new base named on the first step — the plan shape
    // the Rebase screen submits.
    let mut plan: Vec<RebaseStep> = range
        .iter()
        .rev()
        .map(|c| step(&c.oid, None))
        .collect();
    plan[0].onto = Some(h.other_tip.clone());

    let status = backend.rebase_start(&handle.id, plan).unwrap();
    assert!(!status.in_progress, "a clean replay finishes in one call");

    let log = git_in(tr.path(), &["log", "--format=%s"]);
    assert_eq!(
        log.trim().split('\n').collect::<Vec<_>>(),
        vec!["E on main", "D on main", "A on main", "C on other", "B on other", "initial"],
        "main must sit on top of other's tip"
    );

    // The branch ref moved, exactly once, and HEAD is attached to it again.
    assert_eq!(
        git_in(tr.path(), &["symbolic-ref", "HEAD"]).trim(),
        "refs/heads/main"
    );
    assert_eq!(
        git_in(tr.path(), &["rev-parse", "ORIG_HEAD"]).trim(),
        h.main_tip,
        "ORIG_HEAD is the pre-rebase tip — `git reset --hard ORIG_HEAD` undoes this"
    );
    assert_eq!(git_in(tr.path(), &["status", "--porcelain"]).trim(), "");
    // Both sides' content survives.
    for f in ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt"] {
        assert!(tr.path().join(f).exists(), "{f} must exist after the replay");
    }
    // `other` itself is untouched.
    assert_eq!(
        git_in(tr.path(), &["rev-parse", "other"]).trim(),
        h.other_tip
    );
    assert_ne!(h.root, h.other_tip);
}

#[test]
fn a_short_prefix_and_a_branch_name_both_work_as_the_new_base() {
    // The base picker's free-form hash row and the branch menus hand over a
    // PREFIX and a NAME, not a full oid — and after this feature that is the
    // common path, because a diverged base is usually outside the loaded log.
    // Both `ahead_behind` and `rebase_start` revparse whatever they are given.
    let tr = TempRepo::with_initial_commit("root\n");
    let h = diverged(&tr);
    let (backend, handle) = tr.open_with_backend();

    let by_oid = backend.ahead_behind(&handle.id, &h.other_tip, "HEAD").unwrap();
    let by_prefix = backend
        .ahead_behind(&handle.id, &h.other_tip[..7], "HEAD")
        .unwrap();
    let by_name = backend.ahead_behind(&handle.id, "other", "HEAD").unwrap();
    assert_eq!(by_oid.ahead, 3);
    assert_eq!(by_oid.behind, 2);
    assert_eq!(by_oid.merge_base, Some(h.root.clone()));
    assert_eq!(by_prefix.ahead, by_oid.ahead);
    assert_eq!(by_name.ahead, by_oid.ahead);

    let range = backend
        .commits_between(&handle.id, &h.other_tip[..7], "HEAD", 100)
        .unwrap();
    assert_eq!(range.len(), 3);

    let mut plan: Vec<RebaseStep> = range.iter().rev().map(|c| step(&c.oid, None)).collect();
    plan[0].onto = Some(h.other_tip[..7].to_string());
    backend.rebase_start(&handle.id, plan).unwrap();

    assert_eq!(
        git_in(tr.path(), &["rev-parse", "HEAD~3"]).trim(),
        h.other_tip,
        "a 7-char prefix must land on the same base as the full oid"
    );
}
```

- [ ] **Step 2: Run it and confirm it fails or passes for the right reason**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --test rebase_onto_new_base
```

These tests characterise existing backend behaviour, so they are expected to
PASS on the first run. That is the point of Step 3: prove they can fail.

- [ ] **Step 3: Mutation-check**

In `src-tauri/src/git/libgit2.rs`'s `rebase_start`, temporarily replace
`let first_step_onto = first_step.onto.clone();` with
`let first_step_onto: Option<String> = None;` — i.e. ignore the plan's base.
Re-run: `replays_the_branch_onto_a_diverged_base` and
`a_short_prefix_and_a_branch_name_both_work_as_the_new_base` must both fail.
Restore.

Then, in `commits_between`, temporarily add an ancestry check mirroring
`commits_since`'s and confirm
`commits_between_is_the_range_and_commits_since_refuses_it` fails. Restore.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/tests/rebase_onto_new_base.rs
git commit -m "test(rebase): pin replaying a branch onto a diverged base"
```

---

### Task 7: Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `src/features/commits/buildPreservePlan.ts` (doc comment only)

- [ ] **Step 1: The spec/plan list**

In `CLAUDE.md`'s "Recent specs/plans" list, add above the `2026-08-18-diff-minimap-*`
entry:

```markdown
- `2026-08-19-rebase-onto-any-commit-*` — interactive rebase onto a base the
  branch does not descend from: the range from `commitsBetween` with an
  `aheadBehind`-derived limit, the base attached to the plan's first non-Drop
  step at SUBMIT, and a `rebase-onto` NavIntent behind three menu items (186).
```

- [ ] **Step 2: The interactive-rebase-engine section**

In `CLAUDE.md`'s "Interactive rebase engine" section, after the "The plan is
validated before the repository is touched" bullet, add:

```markdown
- **A plan may name a base the branch does not descend from — that is
  `git rebase --onto`** (186). `rebase_start` reads the run's base off the FIRST
  non-Drop step's `onto` and `rebase_plan::validate` accepts any existing commit
  there, with no ancestry requirement, so the diverged case needed no engine
  change. Three consequences:
  - The base is attached at **submit**, by `withPlanBase`
    (`features/commits/withPlanBase.ts`), never when the rows are built. Flatten
    mode lets the user reorder, and the base belongs to whichever step ends up
    first — baked into a row, a drag would carry it away, which is a bug that
    predates the diverged base (a reordered plan used to detach at the middle of
    its own range).
  - The frontend range is `commitsBetween(base, HEAD)` when the base is diverged
    and `commitsSince` when it is an ancestor, chosen by `aheadBehind`'s
    `behind === 0`. **`commits_since` is not loosened** — its ancestor
    requirement is the on-branch flow's invariant, and this keeps it its only
    caller.
  - `commits_between`'s handler defaults `limit` to **200** and breaks at the cap,
    so the limit is derived from `aheadBehind`'s exact `ahead` and the length is
    verified. A truncated plan leaves commits unreplayed and still moves the
    branch ref, so a mismatch is refused rather than planned.
```

- [ ] **Step 3: The nav-intent list**

In the `features/nav/` line of the frontend tree, extend the parenthesised list:

```
├── nav/             useNavStore — cross-screen intents (diff-file, commit-vs-wt,
│                    file-history, blame, rebase-plan, rebase-onto, stash-diff) +
```

- [ ] **Step 4: `buildPreservePlan`'s comment**

In `src/features/commits/buildPreservePlan.ts`, replace the last sentence of the
`onto` comment with:

```
    // Only name a base when it is not where the replay already sits. Naming it
    // unconditionally would work, but it would make every step a reset and hide
    // the linear default from anyone reading the plan. The FIRST step stays null
    // here on purpose: its base is the range's base, which the Rebase screen
    // attaches with `withPlanBase` at submit (186) — and which `rebase_start`
    // derives from the first parent when nothing names it.
```

- [ ] **Step 5: Verify the doc invariants still hold**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm vitest run --project docs
```

Expected: green. (No new `invoke_handler!` id, no new Rust module, no new
`src/features/*` directory, so the coverage assertions are unaffected — this run
is the proof, not the assumption.)

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md src/features/commits/buildPreservePlan.ts
git commit -m "docs: interactive rebase onto a diverged base"
```

---

### Task 8: E2E and the full gate

**Files:**
- Modify: `e2e/specs/rebase.e2e.ts`

- [ ] **Step 1: Read the e2e skill first**

Read `.claude/skills/e2e-testing/SKILL.md` before touching the spec — selector
conventions, the 5s driver-bridge penalty, fixture geometry, rebuild discipline.

- [ ] **Step 2: Add one case**

Append to `e2e/specs/rebase.e2e.ts`'s `describe("interactive rebase")`, following
the file's own fixture and menu helpers:

```ts
  it("replays the branch onto a diverged commit", async () => {
    // main and other diverge off a common root; the new base is other's tip,
    // which is NOT on main — the case every existing test cannot reach.
    // Drive History's commit menu → "Rebase current branch onto this…", then
    // Start rebase, then assert `git log` puts main's commits on top of other's.
  });
```

Fill it in against the file's existing helpers. If the repo fixture needed for a
diverged branch is not cheap to build with what `e2e/support/tempRepo.ts` already
offers, **skip this step** and record that in the PR description — the routing is
already proven by `AppShell.navroutes.test.tsx` (which drives the real shell) and
the engine by Task 6.

- [ ] **Step 3: Check the Docker build slot is free**

```bash
docker compose ls; docker ps
```

Another agent may hold it. Only one cold container build at a time across ALL
worktrees — wait if one is in flight (`compose run --build` creates no container
until the image build finishes, so a build in progress is invisible to
`docker ps` alone).

- [ ] **Step 4: Build the snapshot and run the spec**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test:e2e:docker build
pnpm test:e2e:docker run --spec e2e/specs/rebase.e2e.ts
```

Expected: green. `src/` changed, so the rebuild is mandatory — the `run` phase
silently tests the old binary otherwise.

- [ ] **Step 5: Run every gate**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit
pnpm test
pnpm exec tsc -p e2e/tsconfig.json --noEmit
cargo test --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 6: Squash and open the PR**

```bash
git fetch origin
git reset --soft origin/main
git commit -m "feat(rebase): interactive rebase onto any commit"
git push -u origin feat/rebase-onto-any-commit
gh pr create --title "feat(rebase): interactive rebase onto any commit" --body "…"
```

**The PR body and commit message must never put `close`/`closes`/`closed`/
`fix`/`fixes`/`fixed`/`resolve`/`resolves`/`resolved` immediately before
`#186`** — GitHub ignores negations, so even "Does not close #186" closes it.
Write "issue 186", no `#`. Verify:

```bash
gh pr view <n> --json closingIssuesReferences
```

Expected: an empty array.

---

## Self-Review

**Spec coverage.** Decision 1 → Task 3 Step 4. Decision 2 → Task 3 Steps 4 + 9.
Decision 3 → Tasks 1 and 3 (Steps 5–6). Decision 4 → Task 2. Decision 5 → Task 5.
Decision 6 → Task 4. Decision 7 → Task 3 Step 7. Decision 8 → Task 3 Step 7 plus
Task 3's test list. Out-of-scope items are asserted where they matter: Task 6's
first test pins that `commits_since` still refuses. Testing section → Tasks 1, 3,
6, 8.

**Placeholders.** Task 8 Step 2 is the one deliberately open step: an e2e body
cannot be written without the spec file's helpers in front of the writer, and the
step says exactly what to build, what to assert, and what to do (and record) if
the fixture is not cheap. Everything else carries real code.

**Type consistency.** `withPlanBase(steps, baseOid)` is defined in Task 1 and
called with `(mappedSteps, baseRev)` in Task 3 — `baseRev` is
`string | null`, matching. `AheadBehind` is `{ ahead, behind, mergeBase }`
(`src/lib/types.ts`) and only those three fields are read. `RebaseStep.onto` is
`string | null | undefined`; every construction passes an explicit value.
`branchTipOid` returns `string | null` and both call sites use `?? name`.
