# Commit menu parity — PR2: the navigation entries

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add *Show repository at this revision* and *Go to parent / child
commit* to the History commit context menu.

**Architecture:** Both are pure frontend. `RepoBrowser` already browses at a
revision and only lacks an entry point, so that one is a new `NavIntent` routed
in `AppShell`. Parent/child navigation moves History's selection, which is local
component state a `src/design/` menu builder cannot reach — so
`commitMenuItems` takes an optional callback, the shape `PGErrorBanner`'s
`onReport` already uses.

**Tech Stack:** React 19 / TypeScript, Zustand, vitest.

**Spec:** `docs/superpowers/specs/2026-09-08-commit-menu-parity-spec.md` §5, §6.

**Stacked on PR1** (`feat/commit-menu-parity`), because both PRs edit the same
region of `commitMenuItems`. Rebase onto `main` once PR1 lands.

## Global Constraints

Same as PR1's plan; the ones that bite here:

- **Node 22 + pnpm** by absolute path — `~/Library/pnpm/pnpm`,
  `~/.cargo/bin/cargo`. The worktree guard refuses CLAUDE.md's
  `export PATH="$HOME/…"` line and refuses compound commands containing a `git`
  token.
- **A new `NavIntent` kind MUST be routed in `AppShell`** — compile-enforced by
  `assertNever` (`src/AppShell.tsx:132`) and pinned by
  `AppShell.navroutes.test.tsx`. A kind with no `case` sets an intent and
  navigates nowhere, and *nothing* fails: not tsc, not unit tests, not e2e
  (that was #133).
- **The log is PAGED.** `s.commits` is a prefix of history, never the answer to
  a containment question. A child that is not loaded must produce a disabled
  entry naming why, never a wrong jump.
- **Menu building stays synchronous.** No `await` outside `onClick`.
- **Scroll by offset, never `scrollIntoView`** — History's list is windowed and
  the target row is usually unmounted.
- No new backend op, no new command, so no `architecture.md` command entry is
  required this time. `docs/dev/frontend.md` still gets the navigation model
  note.

---

### Task 1: `commitChildren` — the reverse-parent lookup

**Files:**
- Create: `src/features/commits/commitChildren.ts`
- Create: `src/features/commits/commitChildren.test.ts`

**Interfaces:**
- Produces: `commitChildren(commits: CommitInfo[], oid: string): CommitInfo[]`
  — every loaded commit listing `oid` among its parents, newest-first (input
  order preserved).

- [ ] **Step 1: Write the failing test**

```ts
// src/features/commits/commitChildren.test.ts
import { describe, expect, it } from "vitest";
import { commitChildren } from "./commitChildren";
import type { CommitInfo } from "@/lib/types";

const mk = (oid: string, parents: string[]): CommitInfo => ({
  oid,
  shortOid: oid.slice(0, 7),
  summary: `commit ${oid}`,
  body: null,
  author: "Dev",
  email: "dev@example.com",
  timestamp: 0,
  parents,
  refs: [],
});

describe("commitChildren", () => {
  it("finds the one commit whose parent it is", () => {
    const log = [mk("c", ["b"]), mk("b", ["a"]), mk("a", [])];
    expect(commitChildren(log, "b").map((c) => c.oid)).toEqual(["c"]);
  });

  it("finds several children at a branch point, newest first", () => {
    // Both `c` and `side` were committed on top of `b`.
    const log = [mk("c", ["b"]), mk("side", ["b"]), mk("b", ["a"]), mk("a", [])];
    expect(commitChildren(log, "b").map((c) => c.oid)).toEqual(["c", "side"]);
  });

  it("counts a merge that lists the commit as its SECOND parent", () => {
    const log = [mk("m", ["c", "side"]), mk("c", ["b"]), mk("side", ["b"])];
    expect(commitChildren(log, "side").map((c) => c.oid)).toEqual(["m"]);
  });

  it("is empty for the newest loaded commit", () => {
    const log = [mk("c", ["b"]), mk("b", ["a"])];
    expect(commitChildren(log, "c")).toEqual([]);
  });

  it("is empty for an oid the log does not hold", () => {
    expect(commitChildren([mk("c", ["b"])], "zzz")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `~/Library/pnpm/pnpm vitest run src/features/commits/commitChildren.test.ts`
Expected: FAIL — cannot resolve `./commitChildren`.

- [ ] **Step 3: Implement**

```ts
// src/features/commits/commitChildren.ts
import type { CommitInfo } from "@/lib/types";

/**
 * The loaded commits that list `oid` among their parents — this commit's
 * children, newest first.
 *
 * **A commit can have several children** (a branch point), and a merge counts as
 * a child of BOTH its parents, so every parent slot is searched rather than just
 * the first.
 *
 * **The answer is only as complete as the loaded log**, which is a PREFIX of
 * history: an empty result means "no child in what is loaded", never "no child
 * exists". Callers must say that rather than treat it as a fact about the
 * repository — the menu disables the entry with a label naming the reason.
 */
export function commitChildren(commits: CommitInfo[], oid: string): CommitInfo[] {
  if (!oid) return [];
  return commits.filter((c) => c.parents.includes(oid));
}
```

- [ ] **Step 4: Run and confirm green**

Run: `~/Library/pnpm/pnpm vitest run src/features/commits/commitChildren.test.ts`
Expected: PASS, all five.

- [ ] **Step 5: Commit**

```
feat(commits): find a commit's children in the loaded log
```

---

### Task 2: the `browse-rev` NavIntent

**Files:**
- Modify: `src/features/nav/useNavStore.ts` (the `NavIntent` union)
- Modify: `src/AppShell.tsx` (the routing switch)
- Modify: `src/screens/RepoBrowser.tsx` (consume it; `rev` is local state at ~line 202)
- Modify: `src/AppShell.navroutes.test.tsx`
- Create: `src/screens/RepoBrowser.browseRev.test.tsx`

**Interfaces:**
- Produces: `{ kind: "browse-rev"; rev: string; label: string }` — `rev` is a
  full oid; `label` is what the header shows (`<short> — <subject>`).

- [ ] **Step 1: Read the two files that constrain this**

`AppShell.navroutes.test.tsx` — how it enumerates kinds and what its allow-list
means. `RepoBrowser.tsx` around `const [rev, setRev]` (line ~202), the
`setRev(null)` repo-switch reset (~242), and the toolbar's `setRev(r)` (~1022):
the intent must set the same state that toolbar picker sets, not a parallel one.

- [ ] **Step 2: Write the failing routing test**

Add to `src/AppShell.navroutes.test.tsx`, following the file's existing shape:

```ts
it("routes browse-rev to the repo browser", () => {
  // A kind with no case in AppShell sets an intent and navigates NOWHERE, and
  // nothing else fails — that is #133, and this test is the guard.
  useNavStore.getState().setIntent({
    kind: "browse-rev",
    rev: "a".repeat(40),
    label: "aaaaaaa — commit A",
  });
  // ...assert the screen became "repo", exactly as the sibling cases do.
});
```

- [ ] **Step 3: Run and confirm it fails**

Run: `~/Library/pnpm/pnpm vitest run src/AppShell.navroutes.test.tsx`
Expected: FAIL — the kind is not in the union, so this does not compile.

- [ ] **Step 4: Add the union member**

In `src/features/nav/useNavStore.ts`, beside `{ kind: "commit-self"; oid: string }`:

```ts
  /**
   * Browse the whole tree as it was at one revision (#Rider parity). The
   * RepoBrowser already does this — `listFilesAtRev` / `readFileContentAtRev`
   * and a "Browsing {rev}" header — and had no entry point but its own toolbar.
   */
  | { kind: "browse-rev"; rev: string; label: string }
```

- [ ] **Step 5: Route it in `AppShell`**

Add a `case` beside `commit-self`'s. It must set the RepoBrowser's `rev` before
or as it enters the screen; read how `open-settings` passes a page through
`useSettingsStore` and mirror that shape rather than inventing a third
mechanism. If RepoBrowser's `rev` has to leave local state to receive this,
prefer a `useNavStore` field the screen reads on mount over lifting `rev` into
`useRepoStore` — `rev` is per-window view state, not per-repo data, and
`RepoSlice` is for state a tab switch must carry.

- [ ] **Step 6: Consume it in `RepoBrowser`**

Set `rev` from the intent and clear the intent. Keep the existing
`setRev(null)`-on-repo-switch behaviour intact: browsing a revision of the
previous repository must not survive a tab switch (the comment at ~line 239
already says so).

- [ ] **Step 7: Write the RepoBrowser test**

```ts
// src/screens/RepoBrowser.browseRev.test.tsx
it("browses at the revision the intent names", async () => {
  mockInvoke("list_files_at_rev", () => [{ path: "a.txt", /* …the real shape */ }]);
  useNavStore.getState().setIntent({
    kind: "browse-rev",
    rev: REV,
    label: "aaaaaaa — commit A",
  });
  render(<RepoBrowser />);
  // The header names the revision, and the file list came from the AT-REV call.
  expect(await screen.findByText(/Browsing/)).toBeTruthy();
  expect(getInvokeCalls().find((c) => c.cmd === "list_files_at_rev")?.args).toMatchObject({
    rev: REV,
  });
});
```

Check the real command name and argument shape in `src/lib/tauri.ts` first
(`listFilesAtRev`) and match them; do not trust the name above.

- [ ] **Step 8: Run and confirm green**

Run: `~/Library/pnpm/pnpm vitest run src/AppShell.navroutes.test.tsx src/screens/RepoBrowser.browseRev.test.tsx`
Expected: PASS.

- [ ] **Step 9: Commit**

```
feat(commits): browse the repository at a commit's revision
```

---

### Task 3: `onGoTo` — the callback that lets the menu move History's selection

**Files:**
- Modify: `src/design/context-menu.tsx` (`commitMenuItems` signature + entries)
- Modify: `src/screens/History.tsx` (pass the callback; `sel` is at line 135)
- Create: `src/design/context-menu.goto.test.tsx`

**Interfaces:**
- Produces: `commitMenuItems(commit, opts?: { onGoTo?: (oid: string) => void })`
  — the second parameter is OPTIONAL and every existing call site keeps working
  unchanged.

- [ ] **Step 1: Write the failing tests**

```ts
describe("Go to parent / child commit", () => {
  it("omits both entries entirely when no onGoTo is supplied", () => {
    // The menu is used outside History too; a dead entry there is worse than
    // no entry.
    const labels = commitMenuItems({ sha: B }).map((i) => i.label);
    expect(labels.some((l) => typeof l === "string" && /Go to parent/.test(l))).toBe(false);
    expect(labels.some((l) => typeof l === "string" && /Go to child/.test(l))).toBe(false);
  });

  it("goes to the first parent inline", async () => {
    const onGoTo = vi.fn();
    await labeled(commitMenuItems({ sha: B }, { onGoTo }), /^Go to parent commit/).onClick?.();
    expect(onGoTo).toHaveBeenCalledWith(C); // B's first parent
  });

  it("offers a submenu of every parent for a merge", () => {
    const onGoTo = vi.fn();
    const item = labeled(commitMenuItems({ sha: MERGE }, { onGoTo }), /^Go to parent commit/);
    expect(item.submenu).toHaveLength(2);
    expect(item.submenu?.[0].label).toMatch(/^ccccccc/);
  });

  it("is refused for the root commit, and says why", () => {
    const onGoTo = vi.fn();
    const item = labeled(commitMenuItems({ sha: ROOT }, { onGoTo }), /^Go to parent commit/);
    expect(item.disabled).toBe(true);
    expect(item.label).toMatch(/root commit/);
  });

  it("goes to the one child inline", async () => {
    const onGoTo = vi.fn();
    await labeled(commitMenuItems({ sha: B }, { onGoTo }), /^Go to child commit/).onClick?.();
    expect(onGoTo).toHaveBeenCalledWith(HEAD_SHA);
  });

  it("offers a submenu when a commit has several children", () => {
    const onGoTo = vi.fn();
    // MERGE and SIDE both list C as a parent.
    const item = labeled(commitMenuItems({ sha: C }, { onGoTo }), /^Go to child commit/);
    expect(item.submenu?.length).toBeGreaterThan(1);
  });

  // THE paged-log case. Not "no child exists" — "no child is loaded".
  it("is refused when no child is in the loaded log, and says so", () => {
    const onGoTo = vi.fn();
    const item = labeled(commitMenuItems({ sha: HEAD_SHA }, { onGoTo }), /^Go to child commit/);
    expect(item.disabled).toBe(true);
    expect(item.label).toMatch(/loaded log/);
    expect(item.label).not.toMatch(/no child exists/);
  });
});
```

- [ ] **Step 2: Run and confirm they fail**

Run: `~/Library/pnpm/pnpm vitest run src/design/context-menu.goto.test.tsx`
Expected: FAIL — no such entries, and the second parameter does not exist.

- [ ] **Step 3: Widen the signature**

```ts
export function commitMenuItems(
  commit: { sha?: string; subject?: string } | null,
  opts?: {
    /**
     * Move the caller's selection to `oid`. History owns its selection as LOCAL
     * component state, which a builder in `src/design/` cannot reach — the same
     * reason `PGErrorBanner` takes an `onReport`.
     *
     * Absent means the caller has no selection to move, and the parent/child
     * entries are omitted rather than rendered dead.
     */
    onGoTo?: (oid: string) => void;
  },
): ContextMenuItem[] {
```

- [ ] **Step 4: Add the entries**

Place them after the bisect submenu's divider, per the spec's menu order. Use
`commitChildren(commits, sha)` from Task 1 and `self.parents`. Shape:

```ts
    ...(opts?.onGoTo ? gotoItems(commit?.sha ?? null, commits, opts.onGoTo) : []),
```

with a private helper beside `bisectSubmenu`:

```ts
/**
 * "Go to parent / child commit" — Rider has these on Left/Right; we ship them
 * menu-only (the chord model is single-stroke and Left/Right are list
 * expand/collapse).
 *
 * One target → an inline entry. Several → a submenu, because a merge has two
 * parents and a branch point has two children, and picking silently would be a
 * guess. None → a disabled entry that says WHY, and for a child the honest
 * reason is the paged log, not the repository.
 */
function gotoItems(
  sha: string | null,
  commits: CommitInfo[],
  onGoTo: (oid: string) => void,
): ContextMenuItem[] {
  const self = sha ? (commits.find((c) => c.oid === sha) ?? null) : null;
  const parents = (self?.parents ?? [])
    .map((p) => commits.find((c) => c.oid === p) ?? { oid: p, summary: "" })
    .filter(Boolean);
  const children = sha ? commitChildren(commits, sha) : [];

  const entry = (
    verb: "parent" | "child",
    targets: { oid: string; summary?: string }[],
    emptyReason: string,
  ): ContextMenuItem => {
    if (targets.length === 0) {
      return { icon: "dot", label: `Go to ${verb} commit — ${emptyReason}`, disabled: true };
    }
    if (targets.length === 1) {
      return {
        icon: "dot",
        label: `Go to ${verb} commit`,
        onClick: () => onGoTo(targets[0].oid),
      };
    }
    return {
      icon: "dot",
      label: `Go to ${verb} commit`,
      submenu: targets.map((t) => ({
        icon: "dot",
        label: `${t.oid.slice(0, 7)} — ${t.summary ?? ""}`.trim(),
        onClick: () => onGoTo(t.oid),
      })),
    };
  };

  return [
    entry("parent", parents, "root commit"),
    // NOT "no child exists": s.commits is a PREFIX of history.
    entry("child", children, "none in the loaded log"),
  ];
}
```

Verify `"dot"` is in `IconName` (`src/design/icons.tsx`) — it is used by the
reset submenu already, but check rather than assume; `test/iconSet.test.ts`
fails the build for an undeclared literal.

- [ ] **Step 5: Run and confirm green**

Run: `~/Library/pnpm/pnpm vitest run src/design/`
Expected: PASS, including every pre-existing `context-menu.*` suite. A suite
asserting a full label list will need the new labels added — but note they only
appear when `onGoTo` is passed, so most will be unaffected.

- [ ] **Step 6: Commit**

```
feat(commits): navigate to a commit's parent or child from the menu
```

---

### Task 4: wire History's selection to `onGoTo`

**Files:**
- Modify: `src/screens/History.tsx` (`useContextMenu` call at ~line 259; `sel` at 135)
- Create: `src/screens/History.goto.test.tsx`

- [ ] **Step 1: Read how History selects and scrolls**

`clickSelection` (used at ~line 378), `scrollCommitListTo`'s production
equivalent, and the windowed-list offset scrolling around line 406
(`selectedIndex: cursorIdx`). The callback must do what clicking the row does —
select it AND bring it into view — without `scrollIntoView`, which cannot work
under windowing.

- [ ] **Step 2: Write the failing test**

```ts
it("selects the parent commit when the menu asks to go there", async () => {
  render(<History />);
  // Open the menu on the HEAD row and pick "Go to parent commit", then assert
  // the DETAIL pane switched to the parent — that is the observable effect of
  // the selection moving, and it does not depend on which row is windowed in.
});
```

Drive it the way the sibling History tests drive a context menu; read one first.

- [ ] **Step 3: Pass the callback**

```ts
  const commitMenu = React.useCallback(
    (c: { sha: string; subject: string } | null) =>
      commitMenuItems(c, {
        onGoTo: (oid) => {
          setSel((prev) => clickSelection(order, prev, oid, {}));
          // Scroll by OFFSET — the list is windowed, so the target row is
          // usually unmounted and `scrollIntoView` has nothing to act on.
          scrollToOid(oid);
        },
      }),
    [order],
  );
```

`scrollToOid` is whatever History's existing offset-scroll helper is called —
find it rather than adding a second one; `scrollCommitListTo` in the e2e support
file is the test-side equivalent and names the production concept.

- [ ] **Step 4: Run and confirm green**

Run: `~/Library/pnpm/pnpm vitest run src/screens/History.goto.test.tsx src/screens/`
Expected: PASS.

- [ ] **Step 5: Commit**

```
feat(history): move the selection when the menu navigates
```

---

### Task 5: docs, gates, e2e

**Files:**
- Modify: `docs/dev/frontend.md` (the navigation-model section, and the
  "Rewriting one commit from the History menu" section PR1 added)
- Modify: `e2e/specs/history-ops.e2e.ts`

- [ ] **Step 1: Document**

The `browse-rev` intent in the navigation model; the `onGoTo` callback and WHY
it is a callback (History's selection is local state, `src/design/` cannot reach
it); and the paged-log honesty rule for the child entry.

- [ ] **Step 2: Run every gate**

```
~/Library/pnpm/pnpm tsc --noEmit
~/Library/pnpm/pnpm exec tsc -p e2e/tsconfig.json --noEmit
~/Library/pnpm/pnpm test
~/.cargo/bin/cargo test --manifest-path src-tauri/Cargo.toml
```

The Rust suite is untouched by this PR but run it anyway — it is cheap and this
branch is stacked, so a red would otherwise be attributed to PR1.

- [ ] **Step 3: E2E**

Add one spec: right-click a commit → *Show repository at this revision* → the
browser lists a file that exists at that revision. **`jsClickMenuItem` matches
the label's `textContent` EXACTLY** — pass the ellipsis if the label has one.
Rebuild the snapshot first (`full`), since `src/` changed, and run only this
spec. Read the `N passing` / `N failing` lines; a wrapper exit code of 0 with
failures inside is a shape that has already happened here.

- [ ] **Step 4: Push, open the PR against PR1's branch**

Base it on `feat/commit-menu-parity` while that is open, and retarget to `main`
after PR1 merges. `gh pr create` needs `--body-file`; a `--body` with prose is
refused in this worktree.
