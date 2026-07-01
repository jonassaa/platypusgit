# Command Palette — Actions & Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the ⌘P command palette from nav+search into a full command runner exposing nearly every implemented git op, with inline parameterized actions, type-filter chips, and frecency-ranked results.

**Architecture:** The palette becomes a small step-stack state machine (`root` / `pick` / `input`). Each catalog command's `run()` either acts directly, pushes an inline param step, or fires a nav intent to launch existing UI. The command catalog moves into a dedicated `commands.ts`; frecency lives in a pure `frecency.ts`. `CommandPalette.tsx` renders the active step and handles keyboard.

**Tech Stack:** React + TypeScript, Zustand, Vitest + React Testing Library (jsdom), Tauri `invoke` mocked via `mockInvoke`.

## Global Constraints

- **Frontend never calls `invoke()` directly** — all git ops go through `useRepoStore` actions (which wrap `lib/tauri.ts`). The palette calls store actions only.
- **Design system imports from `@/design`** — no `src/components/ui/`.
- **No Rust/backend changes** — pure frontend surface over existing `GitBackend` ops.
- **Styling:** CSS vars (`var(--color-accent)`, `var(--bg-1)`, `var(--fg-0)`, `var(--bg-selection)`, `var(--git-*)`); inline `style={{}}` is fine (matches existing palette).
- **Type names mirror the spec exactly:** `PaletteItem`, `PaletteStep`, `ChipKind`, `ResultType`.
- **Commit style:** Conventional Commits, `feat(palette): …`, trailing `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Toolchain:** prepend `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"` before `pnpm`. Tests: `pnpm test`. Type-check: `pnpm tsc --noEmit`.

---

## Existing signatures this plan relies on (verbatim)

From `src/features/repo/useRepoStore.ts` (`useRepoStore.getState()`):

```ts
// state
current: RepoHandle | null
branches: BranchInfo[]; tags: TagInfo[]; stashes: StashInfo[]
remotes: RemoteInfo[]; commits: CommitInfo[]; allFiles: FileStatus[]
repoState: GitRepoState            // "Clean" | "Merge" | "Rebase" | ...
// actions
fetchAll(): Promise<void>
refreshAll(): Promise<void>
refreshAllFiles(): Promise<void>
checkoutBranch(name): Promise<void>
checkoutRef(reference): Promise<void>
createAndSwitchBranch(name, opts?: {from?; autoStash?}): Promise<boolean>
deleteBranch(name, force?): Promise<void>
renameBranch(from, to): Promise<void>
mergeBranch(name): Promise<void>
rebaseOnto(upstream): Promise<void>
createTag(name, target: TagTarget): Promise<void>   // TagTarget = {oid, annotation: string|null}
deleteTag(name): Promise<void>
pushTag(remote, name): Promise<void>
cherryPick(oid): Promise<void>
revert(oid): Promise<void>
reset(target, mode: ResetMode): Promise<void>        // ResetMode = "Soft"|"Mixed"|"Hard"
stashSave(opts: StashSaveOptions): Promise<string|null> // {message: string|null, includeUntracked, keepIndex}
stashApply(index): Promise<void>; stashPop(index): Promise<void>
stashDrop(index): Promise<void>; stashBranch(index, branch): Promise<void>
fetch(remote): Promise<void>
pull(remote, branch, mode?: PullMode): Promise<void>  // PullMode = "FastForward"|"Merge"|"Rebase"
push(remote, branch, force?: PushForce): Promise<void> // PushForce = "None"|"WithLease"|"Force"
```

From `src/lib/derive.ts`: `currentBranch(branches): BranchInfo | null` (returns `b.isHead`).
From `src/features/nav/useNavStore.ts`: `setIntent({ kind: "switch-screen", screen: string })`, `{ kind: "diff-file", path }`, `{ kind: "commit-vs-wt", oid }`.
From `src/features/palette/fuzzyMatch.ts`: `fuzzyMatch(query, target): { matched: boolean; score: number; indices: number[] }`.
Types in `src/lib/types.ts`: `BranchInfo {name,isHead,isRemote,upstream,ahead,behind,tip}`, `CommitInfo {oid,shortOid,summary,...,timestamp}`, `TagInfo {name,shortOid,oid}`, `StashInfo {index,shortOid,message}`, `RemoteInfo {name,url}`.

---

## File structure

```
src/features/palette/
├── types.ts            NEW  — PaletteItem, PaletteStep, ChipKind, ResultType (shared, no deps)
├── frecency.ts         NEW  — localStorage frecency store + scoring (pure)
├── frecency.test.ts    NEW
├── commands.ts         NEW  — buildCommands() catalog + pick-item helpers
├── commands.test.ts    NEW
├── usePaletteStore.ts  MOD  — step stack, activeChip, push/pop
├── CommandPalette.tsx  MOD  — render active step, chips, empty-state, frecency boost
├── CommandPalette.test.tsx MOD
└── fuzzyMatch.ts       unchanged
```

---

### Task 1: Shared palette types

**Files:**
- Create: `src/features/palette/types.ts`

**Interfaces:**
- Produces: `ResultType`, `ChipKind`, `PaletteItem`, `PaletteStep` — imported by `commands.ts`, `usePaletteStore.ts`, `CommandPalette.tsx`.

This task has no test of its own (pure type declarations); it is verified by `pnpm tsc --noEmit` and consumed by every later task.

- [ ] **Step 1: Create the types module**

```ts
// src/features/palette/types.ts

/** The four result categories shown at the root step. */
export type ResultType = "command" | "branch" | "file" | "commit";

/** Active type-filter chip. "all" = no filtering (default). */
export type ChipKind = "all" | ResultType;

/** A single selectable palette row. Its `run()` is the only behaviour hook. */
export interface PaletteItem {
  type: ResultType;
  /** Stable key for React + frecency tracking. */
  id: string;
  /** String the fuzzy matcher runs against. */
  search: string;
  /** Primary label shown to the user. */
  label: string;
  /** Optional muted secondary detail. */
  detail?: string;
  icon: string;
  /** When true the label renders danger-tinted (destructive op). */
  danger?: boolean;
  /**
   * Executes the item. May act directly, push a param step, or fire a nav
   * intent. The component closes the palette *before* calling run() only for
   * non-step items — see CommandPalette.activate.
   */
  run: () => void;
}

/** One screen of the palette state machine. */
export type PaletteStep =
  | { kind: "root" }
  | { kind: "pick"; title: string; items: PaletteItem[] }
  | {
      kind: "input";
      title: string;
      placeholder: string;
      initial?: string;
      /** Return an error string to block submit, or null to allow. */
      validate?: (value: string) => string | null;
      onSubmit: (value: string) => void;
    };
```

- [ ] **Step 2: Type-check**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"; pnpm tsc --noEmit`
Expected: PASS (no errors; module unused so far is fine).

- [ ] **Step 3: Commit**

```bash
git add src/features/palette/types.ts
git commit -m "feat(palette): shared step-machine + item types

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Frecency module

**Files:**
- Create: `src/features/palette/frecency.ts`
- Test: `src/features/palette/frecency.test.ts`

**Interfaces:**
- Produces:
  - `type FrecencyMap = Record<string, { count: number; lastUsed: number }>`
  - `loadFrecency(): FrecencyMap`
  - `bumpFrecency(id: string, now: number): void`
  - `frecencyScore(map: FrecencyMap, id: string, now: number): number`
  - `recentIds(map: FrecencyMap, limit: number): string[]`
- Consumed by `CommandPalette.tsx`.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/palette/frecency.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  loadFrecency,
  bumpFrecency,
  frecencyScore,
  recentIds,
} from "./frecency";

const DAY = 24 * 3600 * 1000;

describe("frecency", () => {
  beforeEach(() => localStorage.clear());

  it("starts empty", () => {
    expect(loadFrecency()).toEqual({});
  });

  it("bump increments count and records lastUsed", () => {
    bumpFrecency("a", 1000);
    bumpFrecency("a", 2000);
    const map = loadFrecency();
    expect(map.a.count).toBe(2);
    expect(map.a.lastUsed).toBe(2000);
  });

  it("more frequent item scores higher at equal recency", () => {
    const now = 10 * DAY;
    bumpFrecency("often", now);
    bumpFrecency("often", now);
    bumpFrecency("rare", now);
    const map = loadFrecency();
    expect(frecencyScore(map, "often", now)).toBeGreaterThan(
      frecencyScore(map, "rare", now),
    );
  });

  it("recency decays score", () => {
    const now = 30 * DAY;
    bumpFrecency("old", 0);
    bumpFrecency("new", now);
    const map = loadFrecency();
    expect(frecencyScore(map, "new", now)).toBeGreaterThan(
      frecencyScore(map, "old", now),
    );
  });

  it("unknown id scores 0", () => {
    expect(frecencyScore({}, "nope", 1000)).toBe(0);
  });

  it("recentIds returns ids by lastUsed descending", () => {
    bumpFrecency("first", 100);
    bumpFrecency("second", 300);
    bumpFrecency("third", 200);
    expect(recentIds(loadFrecency(), 2)).toEqual(["second", "third"]);
  });

  it("evicts lowest-scoring entries beyond the cap", () => {
    const now = 1000;
    for (let i = 0; i < 250; i++) bumpFrecency(`id${i}`, now + i);
    const map = loadFrecency();
    expect(Object.keys(map).length).toBeLessThanOrEqual(200);
    // most-recent survivor kept
    expect(map["id249"]).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"; pnpm test frecency`
Expected: FAIL — `frecency.ts` does not exist / functions undefined.

- [ ] **Step 3: Write the implementation**

```ts
// src/features/palette/frecency.ts

/** Per-item usage record. */
export interface FrecencyEntry {
  count: number;
  /** Epoch ms of the most recent use. */
  lastUsed: number;
}

export type FrecencyMap = Record<string, FrecencyEntry>;

const KEY = "pg-palette-frecency";
const CAP = 200;
const HALF_LIFE_MS = 3 * 24 * 3600 * 1000; // 3 days
/** Scales frecency into the fuzzy-score range so it nudges, not dominates. */
const BOOST = 5;

export function loadFrecency(): FrecencyMap {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as FrecencyMap) : {};
  } catch {
    return {};
  }
}

function save(map: FrecencyMap, now: number): void {
  const ids = Object.keys(map);
  if (ids.length > CAP) {
    // Evict lowest-scoring entries down to CAP.
    const ranked = ids.sort(
      (a, b) => frecencyScore(map, b, now) - frecencyScore(map, a, now),
    );
    for (const id of ranked.slice(CAP)) delete map[id];
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* storage full / unavailable — frecency is best-effort */
  }
}

export function bumpFrecency(id: string, now: number): void {
  const map = loadFrecency();
  const prev = map[id];
  map[id] = { count: (prev?.count ?? 0) + 1, lastUsed: now };
  save(map, now);
}

export function frecencyScore(
  map: FrecencyMap,
  id: string,
  now: number,
): number {
  const e = map[id];
  if (!e) return 0;
  const recency = Math.pow(0.5, (now - e.lastUsed) / HALF_LIFE_MS);
  return e.count * recency * BOOST;
}

export function recentIds(map: FrecencyMap, limit: number): string[] {
  return Object.keys(map)
    .sort((a, b) => map[b].lastUsed - map[a].lastUsed)
    .slice(0, limit);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"; pnpm test frecency`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/palette/frecency.ts src/features/palette/frecency.test.ts
git commit -m "feat(palette): frecency store for palette item ranking

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Palette store — step stack & chips

**Files:**
- Modify: `src/features/palette/usePaletteStore.ts`
- Test: `src/features/palette/usePaletteStore.test.ts` (create)

**Interfaces:**
- Consumes: `PaletteStep`, `ChipKind` from `./types` (Task 1).
- Produces (store shape):
  - state: `open: boolean`, `stack: PaletteStep[]`, `query: string`, `activeChip: ChipKind`
  - `openPalette()`, `closePalette()`, `setQuery(q)`, `setChip(c)`, `pushStep(step)`, `popStep()`
  - Invariant: `stack` always non-empty while `open`, with `{kind:"root"}` at index 0.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/palette/usePaletteStore.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { usePaletteStore } from "./usePaletteStore";

const reset = () =>
  usePaletteStore.setState({
    open: false,
    stack: [{ kind: "root" }],
    query: "",
    activeChip: "all",
  });

describe("usePaletteStore", () => {
  beforeEach(reset);

  it("openPalette resets to a single root step", () => {
    usePaletteStore.setState({ query: "x", activeChip: "branch" });
    usePaletteStore.getState().openPalette();
    const s = usePaletteStore.getState();
    expect(s.open).toBe(true);
    expect(s.stack).toEqual([{ kind: "root" }]);
    expect(s.query).toBe("");
    expect(s.activeChip).toBe("all");
  });

  it("pushStep appends a step and clears the query", () => {
    usePaletteStore.getState().openPalette();
    usePaletteStore.getState().setQuery("merge");
    usePaletteStore
      .getState()
      .pushStep({ kind: "pick", title: "Merge", items: [] });
    const s = usePaletteStore.getState();
    expect(s.stack).toHaveLength(2);
    expect(s.stack[1].kind).toBe("pick");
    expect(s.query).toBe("");
  });

  it("popStep removes the top step", () => {
    usePaletteStore.getState().openPalette();
    usePaletteStore
      .getState()
      .pushStep({ kind: "pick", title: "X", items: [] });
    usePaletteStore.getState().popStep();
    expect(usePaletteStore.getState().stack).toHaveLength(1);
    expect(usePaletteStore.getState().open).toBe(true);
  });

  it("popStep at root closes the palette", () => {
    usePaletteStore.getState().openPalette();
    usePaletteStore.getState().popStep();
    expect(usePaletteStore.getState().open).toBe(false);
  });

  it("setChip updates the active chip", () => {
    usePaletteStore.getState().setChip("file");
    expect(usePaletteStore.getState().activeChip).toBe("file");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"; pnpm test usePaletteStore`
Expected: FAIL — `stack`/`pushStep`/`popStep`/`setChip` undefined.

- [ ] **Step 3: Rewrite the store**

```ts
// src/features/palette/usePaletteStore.ts
import { create } from "zustand";
import type { PaletteStep, ChipKind } from "./types";

/**
 * UI state for the command palette (⌘P). Holds open state, the step stack of
 * the inline state machine, the current query, and the active type-filter
 * chip. Result *data* is read live from the other feature stores by the
 * component + commands module, so nothing here knows about branches/files/etc.
 */
interface PaletteState {
  open: boolean;
  /** Bottom is always `{ kind: "root" }`; the top step is what renders. */
  stack: PaletteStep[];
  /** Query for the active (top) step. */
  query: string;
  /** Root-only type filter. */
  activeChip: ChipKind;
  openPalette: () => void;
  closePalette: () => void;
  setQuery: (q: string) => void;
  setChip: (c: ChipKind) => void;
  pushStep: (step: PaletteStep) => void;
  popStep: () => void;
}

export const usePaletteStore = create<PaletteState>((set) => ({
  open: false,
  stack: [{ kind: "root" }],
  query: "",
  activeChip: "all",
  openPalette: () =>
    set({ open: true, stack: [{ kind: "root" }], query: "", activeChip: "all" }),
  closePalette: () => set({ open: false }),
  setQuery: (query) => set({ query }),
  setChip: (activeChip) => set({ activeChip }),
  pushStep: (step) =>
    set((s) => ({ stack: [...s.stack, step], query: "" })),
  popStep: () =>
    set((s) => {
      if (s.stack.length <= 1) return { open: false };
      return { stack: s.stack.slice(0, -1), query: "" };
    }),
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"; pnpm test usePaletteStore`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/palette/usePaletteStore.ts src/features/palette/usePaletteStore.test.ts
git commit -m "feat(palette): step-stack + chip state in palette store

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Command catalog (`commands.ts`)

**Files:**
- Create: `src/features/palette/commands.ts`
- Test: `src/features/palette/commands.test.ts`

**Interfaces:**
- Consumes: `PaletteItem`, `PaletteStep` (Task 1); `usePaletteStore.getState().pushStep/closePalette` (Task 3); `useRepoStore`, `useNavStore`, `currentBranch`.
- Produces: `buildCommands(): PaletteItem[]` — the full action catalog (NOT the branch/file/commit search rows, which stay in the component). Replaces the old in-component `buildCommands()`.

**Design notes:**
- All commands read store state via `getState()` *inside* `run()` closures so pick-step item lists reflect live data at activation time.
- Helper item-builders produce the pick-step `PaletteItem[]` for branches/commits/tags/stashes/remotes.
- "Smart" push/pull: if `currentBranch().upstream` is set, run directly against the upstream's remote; else push a remote-pick step.
- Conditional items: stash items only when `stashes.length`; continue/abort only when `repoState !== "Clean"`.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/palette/commands.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildCommands } from "./commands";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { usePaletteStore } from "./usePaletteStore";
import type { BranchInfo, StashInfo } from "@/lib/types";

const mkBranch = (name: string, isHead = false, upstream: string | null = null): BranchInfo => ({
  name, isHead, isRemote: false, upstream, ahead: 0, behind: 0, tip: "deadbeef",
});

function setRepo(partial: Record<string, unknown>) {
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
    status: [], allFiles: [], branches: [], tags: [], stashes: [],
    remotes: [], commits: [], loading: false, error: null,
    repoState: "Clean",
    rebaseStatus: { inProgress: false, nextIndex: 0, total: 0, pauseReason: null },
    activity: {},
    ...partial,
  } as never);
}

const ids = () => buildCommands().map((i) => i.id);

describe("buildCommands", () => {
  beforeEach(() => {
    setRepo({});
    usePaletteStore.setState({ open: true, stack: [{ kind: "root" }], query: "", activeChip: "all" });
  });

  it("always includes screen nav + fetch/refresh", () => {
    expect(ids()).toEqual(expect.arrayContaining([
      "screen:branches", "screen:settings", "action:fetch-all", "action:refresh",
    ]));
  });

  it("omits stash-pop when there are no stashes", () => {
    expect(ids()).not.toContain("action:stash-pop-latest");
  });

  it("includes stash-pop when stashes exist", () => {
    setRepo({ stashes: [{ index: 0, shortOid: "abc", message: "wip" } as StashInfo] });
    expect(ids()).toContain("action:stash-pop-latest");
  });

  it("omits continue/abort when repo is clean", () => {
    expect(ids()).not.toContain("action:abort-op");
    expect(ids()).not.toContain("action:continue-op");
  });

  it("includes continue/abort mid-operation", () => {
    setRepo({ repoState: "Rebase" });
    expect(ids()).toEqual(expect.arrayContaining(["action:abort-op", "action:continue-op"]));
  });

  it("push current with upstream runs push directly (no step pushed)", () => {
    const push = vi.fn().mockResolvedValue(undefined);
    setRepo({ branches: [mkBranch("main", true, "origin/main")], push });
    const pushStep = vi.spyOn(usePaletteStore.getState(), "pushStep");
    const item = buildCommands().find((i) => i.id === "action:push-current")!;
    item.run();
    expect(push).toHaveBeenCalledWith("origin", "main", "None");
    expect(pushStep).not.toHaveBeenCalled();
  });

  it("merge command pushes a branch-pick step", () => {
    setRepo({ branches: [mkBranch("main", true), mkBranch("feat/x")] });
    const pushed: unknown[] = [];
    usePaletteStore.setState({ pushStep: (s) => pushed.push(s) } as never);
    buildCommands().find((i) => i.id === "action:merge")!.run();
    expect(pushed).toHaveLength(1);
    const step = pushed[0] as { kind: string; items: { label: string }[] };
    expect(step.kind).toBe("pick");
    // only non-head branches offered as merge sources
    expect(step.items.map((i) => i.label)).toEqual(["feat/x"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"; pnpm test commands`
Expected: FAIL — `commands.ts` missing.

- [ ] **Step 3: Implement the catalog**

```ts
// src/features/palette/commands.ts
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { usePaletteStore } from "./usePaletteStore";
import { currentBranch } from "@/lib/derive";
import { relativeTime } from "@/lib/derive";
import type { PaletteItem, PaletteStep } from "./types";

const palette = () => usePaletteStore.getState();
const repoState = () => useRepoStore.getState();

/** Close the palette, then run the op. */
function direct(fn: () => void): () => void {
  return () => {
    palette().closePalette();
    fn();
  };
}

/** Push an inline step (palette stays open). */
function step(make: () => PaletteStep): () => void {
  return () => palette().pushStep(make());
}

// ---- pick-step item builders (read live store data) -----------------------

function branchItems(
  predicate: (b: import("@/lib/types").BranchInfo) => boolean,
  icon: string,
  onPick: (name: string) => void,
): PaletteItem[] {
  return repoState()
    .branches.filter(predicate)
    .map((b) => ({
      type: "branch" as const,
      id: `pick-branch:${b.isRemote ? "r" : "l"}:${b.name}`,
      search: b.name,
      label: b.name,
      detail: b.isRemote ? "remote" : (b.upstream ?? undefined),
      icon,
      run: () => {
        palette().closePalette();
        onPick(b.name);
      },
    }));
}

function commitItems(
  icon: string,
  onPick: (oid: string) => void,
): PaletteItem[] {
  return repoState().commits.map((c) => ({
    type: "commit" as const,
    id: `pick-commit:${c.oid}`,
    search: `${c.summary} ${c.shortOid} ${c.author}`,
    label: c.summary,
    detail: `${c.shortOid} · ${relativeTime(c.timestamp)}`,
    icon,
    run: () => {
      palette().closePalette();
      onPick(c.oid);
    },
  }));
}

function tagItems(icon: string, onPick: (name: string) => void): PaletteItem[] {
  return repoState().tags.map((t) => ({
    type: "command" as const,
    id: `pick-tag:${t.name}`,
    search: t.name,
    label: t.name,
    detail: t.shortOid,
    icon,
    run: () => {
      palette().closePalette();
      onPick(t.name);
    },
  }));
}

function stashItems(
  icon: string,
  onPick: (index: number) => void,
): PaletteItem[] {
  return repoState().stashes.map((s) => ({
    type: "command" as const,
    id: `pick-stash:${s.index}`,
    search: `${s.message} ${s.shortOid}`,
    label: s.message || `stash@{${s.index}}`,
    detail: s.shortOid,
    icon,
    run: () => {
      palette().closePalette();
      onPick(s.index);
    },
  }));
}

function remoteItems(
  icon: string,
  onPick: (name: string) => void,
): PaletteItem[] {
  return repoState().remotes.map((r) => ({
    type: "command" as const,
    id: `pick-remote:${r.name}`,
    search: r.name,
    label: r.name,
    detail: r.url ?? undefined,
    icon,
    run: () => {
      palette().closePalette();
      onPick(r.name);
    },
  }));
}

// ---- the catalog ----------------------------------------------------------

const SCREENS: [string, string, string, string?][] = [
  ["repo", "Files", "folder", "⌘1"],
  ["commit", "Commit", "commit", "⌘2"],
  ["history", "History", "history", "⌘3"],
  ["branches", "Branches", "branch", "⌘4"],
  ["conflict", "Conflicts", "conflict", "⌘5"],
  ["rebase", "Rebase", "rebase", "⌘6"],
  ["remote", "Remotes", "link", "⌘7"],
  ["diff", "Diff viewer", "fileCode", "⌘8"],
  ["reflog", "Reflog", "clock", "⌘9"],
  ["settings", "Settings", "settings"],
];

export function buildCommands(): PaletteItem[] {
  const repo = repoState();
  const nav = useNavStore.getState();
  const head = currentBranch(repo.branches);
  const headName = head?.name ?? null;
  const headTip = head?.tip ?? repo.commits[0]?.oid ?? null;
  const upstreamRemote = head?.upstream?.split("/")[0] ?? null;
  const items: PaletteItem[] = [];

  // -- navigation (launch existing screens) --
  for (const [id, label, icon, shortcut] of SCREENS) {
    items.push({
      type: "command",
      id: `screen:${id}`,
      search: `${label} ${id} go to`,
      label: `Go to ${label}`,
      detail: shortcut,
      icon,
      run: direct(() => nav.setIntent({ kind: "switch-screen", screen: id })),
    });
  }

  // -- direct actions --
  items.push(
    {
      type: "command", id: "action:fetch-all", search: "Fetch all remotes",
      label: "Fetch all remotes", icon: "fetch",
      run: direct(() => void repo.fetchAll()),
    },
    {
      type: "command", id: "action:refresh", search: "Refresh repository",
      label: "Refresh repository", icon: "sync",
      run: direct(() => void repo.refreshAll()),
    },
  );

  // -- smart push / pull / force-push (need a current branch) --
  if (headName) {
    const name = headName;
    items.push({
      type: "command", id: "action:push-current",
      search: "Push current branch", label: `Push ${name}`,
      detail: head?.upstream ?? "set upstream", icon: "push",
      run: upstreamRemote
        ? direct(() => void repo.push(upstreamRemote, name, "None"))
        : step(() => ({
            kind: "pick", title: `Push ${name} to…`,
            items: remoteItems("push", (r) => void repo.push(r, name, "None")),
          })),
    });
    items.push({
      type: "command", id: "action:pull-current",
      search: "Pull current branch", label: `Pull ${name}`,
      detail: head?.upstream ?? undefined, icon: "pull",
      run: upstreamRemote
        ? direct(() => void repo.pull(upstreamRemote, name))
        : step(() => ({
            kind: "pick", title: `Pull ${name} from…`,
            items: remoteItems("pull", (r) => void repo.pull(r, name)),
          })),
    });
    items.push({
      type: "command", id: "action:force-push-current",
      search: "Force push current branch with lease",
      label: `Force-push ${name} (with lease)`, danger: true,
      detail: head?.upstream ?? undefined, icon: "push",
      run: upstreamRemote
        ? direct(() => void repo.push(upstreamRemote, name, "WithLease"))
        : step(() => ({
            kind: "pick", title: `Force-push ${name} to…`,
            items: remoteItems("push", (r) => void repo.push(r, name, "WithLease")),
          })),
    });
  }

  // -- branch ops --
  items.push({
    type: "command", id: "action:checkout-branch",
    search: "Checkout branch switch", label: "Checkout branch…", icon: "branch",
    run: step(() => ({
      kind: "pick", title: "Checkout branch",
      items: branchItems((b) => !b.isHead, "branch", (n) => void repo.checkoutBranch(n)),
    })),
  });
  items.push({
    type: "command", id: "action:create-branch",
    search: "Create new branch", label: "Create branch…", icon: "plus",
    run: step(() => ({
      kind: "input", title: "Create branch", placeholder: "new-branch-name",
      validate: (v) => (v.trim() ? null : "Branch name required"),
      onSubmit: (v) => {
        palette().closePalette();
        void repo.createAndSwitchBranch(v.trim(), { autoStash: true });
      },
    })),
  });
  items.push({
    type: "command", id: "action:merge",
    search: "Merge branch into current", label: "Merge branch into current…", icon: "merge",
    run: step(() => ({
      kind: "pick", title: "Merge into current",
      items: branchItems((b) => !b.isHead, "merge", (n) => void repo.mergeBranch(n)),
    })),
  });
  items.push({
    type: "command", id: "action:rebase-onto",
    search: "Rebase current onto branch", label: "Rebase current onto…", icon: "rebase",
    run: step(() => ({
      kind: "pick", title: "Rebase onto",
      items: branchItems((b) => !b.isHead, "rebase", (n) => void repo.rebaseOnto(n)),
    })),
  });
  items.push({
    type: "command", id: "action:delete-branch",
    search: "Delete branch", label: "Delete branch…", danger: true, icon: "trash",
    run: step(() => ({
      kind: "pick", title: "Delete branch",
      items: branchItems((b) => !b.isHead && !b.isRemote, "trash", (n) =>
        void repo.deleteBranch(n)),
    })),
  });
  items.push({
    type: "command", id: "action:rename-branch",
    search: "Rename branch", label: "Rename branch…", icon: "branch",
    run: step(() => ({
      kind: "pick", title: "Rename branch",
      items: branchItems((b) => !b.isRemote, "branch", (oldName) =>
        palette().pushStep({
          kind: "input", title: `Rename ${oldName}`, placeholder: "new-name",
          initial: oldName,
          validate: (v) => (v.trim() ? null : "Name required"),
          onSubmit: (v) => {
            palette().closePalette();
            void repo.renameBranch(oldName, v.trim());
          },
        })),
    })),
  });

  // -- commit ops --
  items.push({
    type: "command", id: "action:cherry-pick",
    search: "Cherry-pick commit", label: "Cherry-pick commit…", icon: "commit",
    run: step(() => ({
      kind: "pick", title: "Cherry-pick",
      items: commitItems("commit", (oid) => void repo.cherryPick(oid)),
    })),
  });
  items.push({
    type: "command", id: "action:revert",
    search: "Revert commit", label: "Revert commit…", icon: "history",
    run: step(() => ({
      kind: "pick", title: "Revert",
      items: commitItems("history", (oid) => void repo.revert(oid)),
    })),
  });
  items.push({
    type: "command", id: "action:reset",
    search: "Reset current branch to commit", label: "Reset current branch to…",
    danger: true, icon: "rebase",
    run: step(() => ({
      kind: "pick", title: "Reset to commit",
      items: commitItems("commit", (oid) =>
        palette().pushStep({
          kind: "pick", title: "Reset mode",
          items: (["Soft", "Mixed", "Hard"] as const).map((mode) => ({
            type: "command" as const, id: `reset-mode:${mode}`,
            search: mode, label: mode, danger: mode === "Hard",
            icon: "rebase",
            run: () => { palette().closePalette(); void repo.reset(oid, mode); },
          })),
        })),
    })),
  });

  // -- tag ops --
  items.push({
    type: "command", id: "action:create-tag",
    search: "Create tag", label: "Create tag…", icon: "tag",
    run: step(() => ({
      kind: "input", title: "Create tag (at HEAD)", placeholder: "v1.2.3",
      validate: (v) => (!v.trim() ? "Tag name required" : headTip ? null : "No commit to tag"),
      onSubmit: (v) => {
        palette().closePalette();
        if (headTip) void repo.createTag(v.trim(), { oid: headTip, annotation: null });
      },
    })),
  });
  if (repo.tags.length) {
    items.push({
      type: "command", id: "action:delete-tag",
      search: "Delete tag", label: "Delete tag…", danger: true, icon: "tag",
      run: step(() => ({
        kind: "pick", title: "Delete tag",
        items: tagItems("tag", (n) => void repo.deleteTag(n)),
      })),
    });
    items.push({
      type: "command", id: "action:push-tag",
      search: "Push tag to remote", label: "Push tag…", icon: "tag",
      run: step(() => ({
        kind: "pick", title: "Push tag",
        items: tagItems("tag", (tagName) =>
          palette().pushStep({
            kind: "pick", title: `Push ${tagName} to…`,
            items: remoteItems("push", (r) => void repo.pushTag(r, tagName)),
          })),
      })),
    });
  }

  // -- stash ops --
  items.push({
    type: "command", id: "action:stash-save",
    search: "Stash changes save", label: "Stash changes…", icon: "stash",
    run: step(() => ({
      kind: "input", title: "Stash changes", placeholder: "message (optional)",
      onSubmit: (v) => {
        palette().closePalette();
        void repo.stashSave({
          message: v.trim() || null, includeUntracked: true, keepIndex: false,
        });
      },
    })),
  });
  if (repo.stashes.length) {
    items.push(
      {
        type: "command", id: "action:stash-pop-latest",
        search: "Pop latest stash", label: "Pop latest stash", icon: "stash",
        run: direct(() => void repo.stashPop(0)),
      },
      {
        type: "command", id: "action:stash-apply",
        search: "Apply stash", label: "Apply stash…", icon: "stash",
        run: step(() => ({
          kind: "pick", title: "Apply stash",
          items: stashItems("stash", (i) => void repo.stashApply(i)),
        })),
      },
      {
        type: "command", id: "action:stash-pop",
        search: "Pop stash", label: "Pop stash…", icon: "stash",
        run: step(() => ({
          kind: "pick", title: "Pop stash",
          items: stashItems("stash", (i) => void repo.stashPop(i)),
        })),
      },
      {
        type: "command", id: "action:stash-drop",
        search: "Drop stash", label: "Drop stash…", danger: true, icon: "trash",
        run: step(() => ({
          kind: "pick", title: "Drop stash",
          items: stashItems("trash", (i) => void repo.stashDrop(i)),
        })),
      },
      {
        type: "command", id: "action:stash-branch",
        search: "Create branch from stash", label: "Stash to branch…", icon: "branch",
        run: step(() => ({
          kind: "pick", title: "Stash → branch",
          items: stashItems("stash", (index) =>
            palette().pushStep({
              kind: "input", title: "New branch from stash", placeholder: "branch-name",
              validate: (v) => (v.trim() ? null : "Branch name required"),
              onSubmit: (v) => {
                palette().closePalette();
                void repo.stashBranch(index, v.trim());
              },
            })),
        })),
      },
    );
  }

  // -- in-progress operation controls --
  if (repo.repoState !== "Clean") {
    items.push(
      {
        type: "command", id: "action:continue-op",
        search: "Continue operation rebase merge", label: "Continue current operation",
        icon: "rebase", run: direct(() => void repo.continueOperation()),
      },
      {
        type: "command", id: "action:abort-op",
        search: "Abort operation rebase merge", label: "Abort current operation",
        danger: true, icon: "trash", run: direct(() => void repo.abortOperation()),
      },
    );
  }

  return items;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"; pnpm test commands`
Expected: PASS (8 tests).

- [ ] **Step 5: Type-check**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"; pnpm tsc --noEmit`
Expected: PASS. (Note: `relativeTime` and `currentBranch` both come from `@/lib/derive`; combine into one import statement.)

- [ ] **Step 6: Commit**

```bash
git add src/features/palette/commands.ts src/features/palette/commands.test.ts
git commit -m "feat(palette): command catalog with inline param steps

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Render the step machine in `CommandPalette.tsx`

**Files:**
- Modify: `src/features/palette/CommandPalette.tsx`
- Test: `src/features/palette/CommandPalette.test.tsx` (extend)

**Interfaces:**
- Consumes: `buildCommands()` (Task 4); `PaletteItem`, `PaletteStep`, `ResultType` (Task 1); store `stack/pushStep/popStep/query/activeChip` (Task 3).
- Produces: a palette that renders root / pick / input steps, with breadcrumb + back navigation.

**Design notes:**
- Replace the in-component `buildCommands()` with the import from `./commands`. The branch/file/commit *search rows* stay built in the component (reactive selectors) and are concatenated with `buildCommands()` for the root step.
- `const step = stack[stack.length - 1]`.
- Root step: render groups (commands + branch/file/commit data items) exactly as today.
- Pick step: fuzzy-filter `step.items` (single flat list, no groups), render with the same `renderRow`.
- Input step: render a text field; Enter submits via `onSubmit` (after `validate`); show inline validation error.
- Breadcrumb: when `stack.length > 1`, show the chain of step titles above the input; `Esc` and empty-`Backspace` call `popStep()`.

- [ ] **Step 1: Write the failing component test (append to CommandPalette.test.tsx)**

```ts
it("runs a direct command and closes (Go to Branches)", async () => {
  const user = userEvent.setup();
  usePaletteStore.getState().openPalette();
  render(<CommandPalette />);
  await user.keyboard("Go to Branches");
  await user.keyboard("{Enter}");
  expect(useNavStore.getState().intent).toEqual({ kind: "switch-screen", screen: "branches" });
  expect(usePaletteStore.getState().open).toBe(false);
});

it("merge command opens an inline branch-pick step", async () => {
  const user = userEvent.setup();
  useRepoStore.setState({ branches: [mkBranch("main", true), mkBranch("feat/x")] });
  usePaletteStore.getState().openPalette();
  render(<CommandPalette />);
  await user.keyboard("Merge branch");
  await user.keyboard("{Enter}");
  // palette still open, now on a pick step titled "Merge into current"
  expect(usePaletteStore.getState().open).toBe(true);
  expect(usePaletteStore.getState().stack.at(-1)?.kind).toBe("pick");
  expect(await screen.findByText("Merge into current")).toBeTruthy();
});

it("Escape pops a step before closing", async () => {
  const user = userEvent.setup();
  useRepoStore.setState({ branches: [mkBranch("main", true), mkBranch("feat/x")] });
  usePaletteStore.getState().openPalette();
  usePaletteStore.getState().pushStep({ kind: "pick", title: "T", items: [] });
  render(<CommandPalette />);
  await user.keyboard("{Escape}");
  expect(usePaletteStore.getState().open).toBe(true);  // popped to root
  await user.keyboard("{Escape}");
  expect(usePaletteStore.getState().open).toBe(false); // closed from root
});
```

(Keep `mkBranch` with the `upstream`/`tip` fields — update the existing helper in this file to include `tip: null` if not already present.)

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"; pnpm test CommandPalette`
Expected: FAIL — step rendering / breadcrumb not implemented.

- [ ] **Step 3: Rewrite `CommandPalette.tsx`**

Replace the file with the version below. Key changes from the current file: import `buildCommands` from `./commands` and the types from `./types` (delete the local copies); read `stack`/`pushStep`/`popStep` from the store; branch rendering on `step.kind`. The `highlight`, `renderRow`, section header, fuzzy scoring, focus-trap Tab handler, and portal are preserved.

```tsx
import React from "react";
import ReactDOM from "react-dom";
import { PGIcon, PGSearchInput } from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { usePaletteStore } from "./usePaletteStore";
import { buildCommands } from "./commands";
import { fuzzyMatch } from "./fuzzyMatch";
import { relativeTime } from "@/lib/derive";
import type { PaletteItem, ResultType } from "./types";

function highlight(text: string, indices: number[]): React.ReactNode {
  if (indices.length === 0) return text;
  const hit = new Set(indices);
  const out: React.ReactNode[] = [];
  let run = "";
  let runHit = false;
  const flush = (key: number) => {
    if (run === "") return;
    if (runHit) {
      out.push(
        <span key={key} style={{ color: "var(--color-accent)", fontWeight: 600 }}>
          {run}
        </span>,
      );
    } else {
      out.push(run);
    }
    run = "";
  };
  for (let i = 0; i < text.length; i++) {
    const isHit = hit.has(i);
    if (isHit !== runHit) flush(i);
    run += text[i];
    runHit = isHit;
  }
  flush(text.length);
  return out;
}

interface ScoredRow {
  item: PaletteItem;
  score: number;
  labelIndices: number[];
}

const TYPE_LABEL: Record<ResultType, string> = {
  command: "Commands",
  branch: "Branches",
  file: "Files",
  commit: "Commits",
};
const TYPE_ORDER: ResultType[] = ["command", "branch", "file", "commit"];
const CAP: Record<ResultType, number> = { command: 12, branch: 8, file: 12, commit: 8 };
const WIDTH = 560;

export function CommandPalette() {
  const open = usePaletteStore((s) => s.open);
  const stack = usePaletteStore((s) => s.stack);
  const query = usePaletteStore((s) => s.query);
  const setQuery = usePaletteStore((s) => s.setQuery);
  const closePalette = usePaletteStore((s) => s.closePalette);
  const popStep = usePaletteStore((s) => s.popStep);

  const repoOpen = useRepoStore((s) => !!s.current);
  const branches = useRepoStore((s) => s.branches);
  const allFiles = useRepoStore((s) => s.allFiles);
  const commits = useRepoStore((s) => s.commits);
  const setIntent = useNavStore((s) => s.setIntent);

  const step = stack[stack.length - 1];

  const [activeIndex, setActiveIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const dialogRef = React.useRef<HTMLDivElement | null>(null);

  // Root-step candidate set: commands (catalog) + live branch/file/commit rows.
  const candidates = React.useMemo<PaletteItem[]>(() => {
    if (step.kind !== "root") return [];
    const items: PaletteItem[] = buildCommands();
    for (const b of branches) {
      items.push({
        type: "branch",
        id: `branch:${b.isRemote ? "r" : "l"}:${b.name}`,
        search: b.name,
        label: b.name,
        detail: b.isRemote ? "remote" : (b.upstream ?? undefined),
        icon: "branch",
        run: () => { closePalette(); void useRepoStore.getState().checkoutBranch(b.name); },
      });
    }
    for (const f of allFiles) {
      const slash = f.path.lastIndexOf("/");
      items.push({
        type: "file",
        id: `file:${f.path}`,
        search: f.path,
        label: slash >= 0 ? f.path.slice(slash + 1) : f.path,
        detail: slash >= 0 ? f.path.slice(0, slash) : undefined,
        icon: "file",
        run: () => { closePalette(); setIntent({ kind: "diff-file", path: f.path }); },
      });
    }
    for (const c of commits) {
      items.push({
        type: "commit",
        id: `commit:${c.oid}`,
        search: `${c.summary} ${c.shortOid} ${c.author}`,
        label: c.summary,
        detail: `${c.shortOid} · ${relativeTime(c.timestamp)}`,
        icon: "commit",
        run: () => { closePalette(); setIntent({ kind: "commit-vs-wt", oid: c.oid }); },
      });
    }
    return items;
  }, [step.kind, branches, allFiles, commits, closePalette, setIntent]);

  // Source list for the active step: root → candidates; pick → step.items.
  const source: PaletteItem[] =
    step.kind === "root" ? candidates : step.kind === "pick" ? step.items : [];

  // Filter + score + (root only) group + cap, then flatten for keyboard nav.
  const { flat, groups } = React.useMemo(() => {
    const byType: Record<ResultType, ScoredRow[]> = { command: [], branch: [], file: [], commit: [] };
    for (const item of source) {
      const m = fuzzyMatch(query, item.search);
      if (!m.matched) continue;
      const labelIndices = query.length === 0 ? [] : fuzzyMatch(query, item.label).indices;
      byType[item.type].push({ item, score: m.score, labelIndices });
    }
    const groupsOut: { type: ResultType; rows: ScoredRow[] }[] = [];
    const flatOut: ScoredRow[] = [];
    for (const type of TYPE_ORDER) {
      const sorted = byType[type].sort((a, b) => b.score - a.score).slice(0, CAP[type]);
      if (sorted.length === 0) continue;
      groupsOut.push({ type, rows: sorted });
      flatOut.push(...sorted);
    }
    return { flat: flatOut, groups: groupsOut };
  }, [source, query]);

  React.useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
    if (repoOpen) void useRepoStore.getState().refreshAllFiles();
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open, repoOpen, stack.length]);

  React.useEffect(() => { setActiveIndex(0); }, [query]);
  React.useEffect(() => {
    if (activeIndex >= flat.length) setActiveIndex(Math.max(0, flat.length - 1));
  }, [flat.length, activeIndex]);
  React.useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-pal-index="${activeIndex}"]`);
    el?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  if (!open) return null;

  const activate = (row: ScoredRow | undefined) => {
    if (!row) return;
    row.item.run(); // run() itself closes (direct/launch) or pushes a step
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); popStep(); return; }
    if (e.key === "Backspace" && query === "" && stack.length > 1) {
      e.preventDefault(); popStep(); return;
    }
    if (step.kind === "input") {
      if (e.key === "Enter") { e.preventDefault(); submitInput(); }
      return; // input step has no list nav
    }
    if (e.key === "ArrowDown") {
      e.preventDefault(); setActiveIndex((i) => Math.min(flat.length - 1, i + 1)); return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault(); setActiveIndex((i) => Math.max(0, i - 1)); return;
    }
    if (e.key === "Enter") { e.preventDefault(); activate(flat[activeIndex]); return; }
    if (e.key === "Tab") {
      const root = dialogRef.current;
      if (!root) return;
      const focusable = Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (focusable.length === 0) { e.preventDefault(); inputRef.current?.focus(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (activeEl === first || !root.contains(activeEl)) { e.preventDefault(); last.focus(); }
      } else {
        if (activeEl === last || !root.contains(activeEl)) { e.preventDefault(); first.focus(); }
      }
    }
  };

  // ---- input step submit ----
  const [inputError, setInputError] = React.useState<string | null>(null);
  const submitInput = () => {
    if (step.kind !== "input") return;
    const err = step.validate?.(query) ?? null;
    if (err) { setInputError(err); return; }
    setInputError(null);
    step.onSubmit(query);
  };
  React.useEffect(() => { setInputError(null); }, [stack.length]);

  const sectionHeader = (label: string, count: number) => (
    <div style={{
      padding: "8px 12px 2px", fontFamily: "var(--font-mono)", fontSize: "var(--fs-10)",
      color: "var(--fg-2)", textTransform: "uppercase", letterSpacing: "0.05em",
    }}>
      {label} <span style={{ color: "var(--fg-3)" }}>({count})</span>
    </div>
  );

  const renderRow = (row: ScoredRow, flatIndex: number) => {
    const { item, labelIndices } = row;
    const active = flatIndex === activeIndex;
    return (
      <div
        key={item.id}
        data-pal-index={flatIndex}
        data-pal-type={item.type}
        onClick={() => activate(row)}
        onMouseEnter={() => setActiveIndex(flatIndex)}
        style={{
          display: "flex", alignItems: "center", gap: 8, height: 30, padding: "0 12px",
          background: active ? "var(--bg-selection)" : "transparent", cursor: "pointer",
          fontFamily: "var(--font-mono)", fontSize: "var(--fs-12)",
        }}
      >
        <PGIcon name={item.icon} size={13} style={{ color: "var(--fg-2)" }} />
        <span title={item.label} style={{
          flexShrink: 0, maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: item.danger ? "var(--git-removed)" : "var(--fg-0)",
        }}>
          {highlight(item.label, labelIndices)}
        </span>
        {item.detail && (
          <span title={item.detail} style={{
            flex: 1, minWidth: 0, textAlign: "right", overflow: "hidden",
            textOverflow: "ellipsis", whiteSpace: "nowrap",
            color: "var(--fg-3)", fontSize: "var(--fs-10)",
          }}>
            {item.detail}
          </span>
        )}
      </div>
    );
  };

  let runningIndex = 0;

  // Breadcrumb of step titles (root excluded).
  const crumbs = stack
    .map((s) => (s.kind === "root" ? null : s.title))
    .filter((t): t is string => t != null);

  const placeholder =
    step.kind === "input" ? step.placeholder
    : step.kind === "pick" ? `Filter ${step.title.toLowerCase()}…`
    : "Search branches, files, commits, commands…";

  const content = (
    <div
      role="dialog" aria-modal="true" aria-label="Command palette"
      onMouseDown={(e) => { if (e.target === e.currentTarget) closePalette(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 200, display: "flex",
        justifyContent: "center", alignItems: "flex-start", paddingTop: "12vh",
        background: "rgba(0,0,0,0.45)",
      }}
    >
      <div
        ref={dialogRef} onKeyDown={onKeyDown}
        style={{
          width: WIDTH, maxWidth: "90vw", maxHeight: "60vh", background: "var(--bg-1)",
          border: "1px solid var(--border-1)", borderRadius: "var(--r-3)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.45)", display: "flex",
          flexDirection: "column", overflow: "hidden",
        }}
      >
        {crumbs.length > 0 && (
          <div style={{
            padding: "6px 12px", borderBottom: "1px solid var(--border-0)",
            fontFamily: "var(--font-mono)", fontSize: "var(--fs-10)", color: "var(--fg-2)",
          }}>
            {crumbs.join(" › ")}
          </div>
        )}
        <div style={{ padding: 8, borderBottom: "1px solid var(--border-0)" }}>
          <PGSearchInput
            value={query} onChange={setQuery} placeholder={placeholder} inputRef={inputRef}
          />
          {step.kind === "input" && inputError && (
            <div style={{
              padding: "4px 4px 0", fontSize: "var(--fs-10)",
              color: "var(--git-removed)", fontFamily: "var(--font-mono)",
            }}>
              {inputError}
            </div>
          )}
        </div>
        {step.kind === "input" ? (
          <div style={{
            padding: 12, fontSize: "var(--fs-11)", color: "var(--fg-3)",
            fontFamily: "var(--font-mono)",
          }}>
            Press Enter to confirm · Esc to go back
          </div>
        ) : (
          <div ref={listRef} style={{ flex: 1, overflow: "auto", paddingBottom: 4 }}>
            {flat.length === 0 ? (
              <div style={{
                padding: 16, fontSize: "var(--fs-12)", color: "var(--fg-3)",
                fontFamily: "var(--font-mono)",
              }}>
                {query ? `No matches for "${query}".` : "Type to search."}
              </div>
            ) : step.kind === "pick" ? (
              flat.map((row) => renderRow(row, runningIndex++))
            ) : (
              groups.map((g) => (
                <React.Fragment key={g.type}>
                  {sectionHeader(TYPE_LABEL[g.type], g.rows.length)}
                  {g.rows.map((item) => renderRow(item, runningIndex++))}
                </React.Fragment>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );

  return ReactDOM.createPortal(content, document.body);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"; pnpm test CommandPalette`
Expected: PASS (existing tests + 3 new). If a pre-existing test referenced the old in-component `buildCommands` behaviour, it should still pass because the catalog produces the same `screen:*` / `action:fetch-all` / `action:refresh` ids and labels.

- [ ] **Step 5: Type-check + full suite**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"; pnpm tsc --noEmit && pnpm test`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/features/palette/CommandPalette.tsx src/features/palette/CommandPalette.test.tsx
git commit -m "feat(palette): render step machine with inline pick/input steps

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Hint chips (root step)

**Files:**
- Modify: `src/features/palette/CommandPalette.tsx`
- Test: `src/features/palette/CommandPalette.test.tsx` (extend)

**Interfaces:**
- Consumes: `activeChip`/`setChip` (Task 3), `ChipKind` (Task 1).
- Produces: a clickable chip row on the root step; `⌃Tab`/`⌃⇧Tab` cycling; group filtering by chip.

- [ ] **Step 1: Write the failing test (append)**

```ts
it("chip filters the root list to one type", async () => {
  const user = userEvent.setup();
  useRepoStore.setState({ branches: [mkBranch("feature-foo")] });
  usePaletteStore.getState().openPalette();
  render(<CommandPalette />);
  // Branches chip
  await user.click(screen.getByRole("button", { name: "Branches" }));
  expect(usePaletteStore.getState().activeChip).toBe("branch");
  // commands group header should be gone, branches present
  expect(screen.queryByText("Commands")).toBeNull();
  expect(screen.getByText("Branches")).toBeTruthy();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"; pnpm test CommandPalette`
Expected: FAIL — no chip buttons.

- [ ] **Step 3: Implement chips**

In `CommandPalette.tsx`:

3a. Add to the store-hook block near the top of the component:

```tsx
  const activeChip = usePaletteStore((s) => s.activeChip);
  const setChip = usePaletteStore((s) => s.setChip);
```

3b. Add the chip constant near `TYPE_ORDER`:

```tsx
const CHIPS: { kind: import("./types").ChipKind; label: string }[] = [
  { kind: "all", label: "All" },
  { kind: "command", label: "Commands" },
  { kind: "branch", label: "Branches" },
  { kind: "file", label: "Files" },
  { kind: "commit", label: "Commits" },
];
```

3c. Filter groups by the active chip. Change the `groups.map(...)` render branch (root step) to filter first:

```tsx
              (activeChip === "all" ? groups : groups.filter((g) => g.type === activeChip)).map((g) => (
```

3d. Add `⌃Tab` cycling at the very top of `onKeyDown`, before the `Escape` check (only meaningful on root):

```tsx
    if (e.key === "Tab" && e.ctrlKey && step.kind === "root") {
      e.preventDefault();
      const i = CHIPS.findIndex((c) => c.kind === activeChip);
      const next = (i + (e.shiftKey ? CHIPS.length - 1 : 1)) % CHIPS.length;
      setChip(CHIPS[next].kind);
      return;
    }
```

3e. Render the chip row on the root step only, immediately after the `PGSearchInput`'s wrapping `<div>` (inside it, below the input):

```tsx
          {step.kind === "root" && (
            <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
              {CHIPS.map((c) => (
                <button
                  key={c.kind}
                  onClick={() => setChip(c.kind)}
                  style={{
                    padding: "2px 8px", borderRadius: "var(--r-2)",
                    fontFamily: "var(--font-mono)", fontSize: "var(--fs-10)",
                    border: "1px solid var(--border-1)", cursor: "pointer",
                    background: activeChip === c.kind ? "var(--color-accent)" : "transparent",
                    color: activeChip === c.kind ? "var(--bg-0)" : "var(--fg-2)",
                  }}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}
```

- [ ] **Step 4: Run to verify it passes**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"; pnpm test CommandPalette`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/palette/CommandPalette.tsx src/features/palette/CommandPalette.test.tsx
git commit -m "feat(palette): type-filter hint chips on root step

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Frecency boost + useful empty state

**Files:**
- Modify: `src/features/palette/CommandPalette.tsx`
- Test: `src/features/palette/CommandPalette.test.tsx` (extend)

**Interfaces:**
- Consumes: `frecencyScore`, `bumpFrecency`, `loadFrecency`, `recentIds` (Task 2).
- Produces: frecency-boosted scoring; bump on activate; an empty-query root screen showing Quick actions + Recents.

**Design notes:**
- Load the frecency map once per open with `useMemo` keyed on `open` + `stack.length` (re-resolve after a bump-causing close is irrelevant since palette closes).
- Boost: in the scoring loop, `score += frecencyScore(map, item.id, now)` where `now = Date.now()`.
- Bump: in `activate`, call `bumpFrecency(row.item.id, Date.now())` before `row.item.run()`.
- Empty-query root screen: when `step.kind === "root" && query === ""`, render two custom sections instead of the normal groups:
  - **Quick actions** — the catalog items whose ids are in `QUICK_IDS` (push/pull current, commit, fetch-all), in that order, skipping any not present.
  - **Recent** — `recentIds(map, 6)` resolved against `candidates` (skip ids no longer present).
  - Both render with `renderRow`; keep `runningIndex` continuous so keyboard nav works across both sections.

- [ ] **Step 1: Write the failing test (append)**

```ts
it("shows Quick actions on empty query when a branch is checked out", async () => {
  useRepoStore.setState({ branches: [mkBranch("main", true)] });
  usePaletteStore.getState().openPalette();
  render(<CommandPalette />);
  expect(await screen.findByText("Quick actions")).toBeTruthy();
  expect(screen.getByText(rowText("Fetch all remotes"))).toBeTruthy();
});

it("shows Recent items from frecency on empty query", async () => {
  const { bumpFrecency } = await import("./frecency");
  bumpFrecency("screen:history", Date.now());
  usePaletteStore.getState().openPalette();
  render(<CommandPalette />);
  expect(await screen.findByText("Recent")).toBeTruthy();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"; pnpm test CommandPalette`
Expected: FAIL — no "Quick actions"/"Recent" sections.

- [ ] **Step 3: Implement**

3a. Add imports:

```tsx
import { frecencyScore, bumpFrecency, loadFrecency, recentIds } from "./frecency";
```

3b. Add quick-action id list near the other constants:

```tsx
const QUICK_IDS = ["action:push-current", "action:pull-current", "screen:commit", "action:fetch-all"];
```

3c. Load the frecency map per open:

```tsx
  const frecency = React.useMemo(() => loadFrecency(), [open, stack.length]);
```

3d. Fold the boost into the scoring loop (root + pick). In the `byType` loop body, after computing `m`:

```tsx
      const boosted = m.score + frecencyScore(frecency, item.id, Date.now());
      byType[item.type].push({ item, score: boosted, labelIndices });
```

3e. Bump on activate:

```tsx
  const activate = (row: ScoredRow | undefined) => {
    if (!row) return;
    bumpFrecency(row.item.id, Date.now());
    row.item.run();
  };
```

3f. Empty-state sections. Replace the root-step empty branch. Currently when `flat.length === 0` it shows "Type to search."; instead, for the root step with an empty query, render Quick actions + Recent. Build them just before `content`:

```tsx
  const byId = (id: string) => candidates.find((c) => c.id === id);
  const quickRows: PaletteItem[] =
    step.kind === "root" && query === ""
      ? QUICK_IDS.map(byId).filter((x): x is PaletteItem => x != null)
      : [];
  const recentRows: PaletteItem[] =
    step.kind === "root" && query === ""
      ? recentIds(frecency, 6)
          .map(byId)
          .filter((x): x is PaletteItem => x != null)
      : [];
  const showEmptyHome = step.kind === "root" && query === "" && (quickRows.length > 0 || recentRows.length > 0);
```

Wrap each `PaletteItem` into a `ScoredRow` for `renderRow` (empty `labelIndices`, score 0). Update the list render so that, on the root step with an empty query, it renders the home sections; otherwise the normal groups/flat logic:

```tsx
            {showEmptyHome ? (
              <>
                {quickRows.length > 0 && sectionHeader("Quick actions", quickRows.length)}
                {quickRows.map((item) =>
                  renderRow({ item, score: 0, labelIndices: [] }, runningIndex++),
                )}
                {recentRows.length > 0 && sectionHeader("Recent", recentRows.length)}
                {recentRows.map((item) =>
                  renderRow({ item, score: 0, labelIndices: [] }, runningIndex++),
                )}
              </>
            ) : flat.length === 0 ? (
              <div style={{
                padding: 16, fontSize: "var(--fs-12)", color: "var(--fg-3)",
                fontFamily: "var(--font-mono)",
              }}>
                {query ? `No matches for "${query}".` : "Type to search."}
              </div>
            ) : step.kind === "pick" ? (
              flat.map((row) => renderRow(row, runningIndex++))
            ) : (
              (activeChip === "all" ? groups : groups.filter((g) => g.type === activeChip)).map((g) => (
                <React.Fragment key={g.type}>
                  {sectionHeader(TYPE_LABEL[g.type], g.rows.length)}
                  {g.rows.map((item) => renderRow(item, runningIndex++))}
                </React.Fragment>
              ))
            )}
```

Also update the keyboard-nav `flat` list so Enter/Arrows work on the home screen. Build a `navRows` that the keyboard uses:

```tsx
  const navRows: ScoredRow[] = showEmptyHome
    ? [...quickRows, ...recentRows].map((item) => ({ item, score: 0, labelIndices: [] }))
    : flat;
```

…and in `onKeyDown` replace the three `flat` references (ArrowDown bound, ArrowUp, Enter activate) with `navRows`, and the active-index clamp effect's `flat.length` with `navRows.length`. (Define `navRows` before `onKeyDown`.)

- [ ] **Step 4: Run to verify it passes**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"; pnpm test CommandPalette`
Expected: PASS.

- [ ] **Step 5: Type-check + full suite**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"; pnpm tsc --noEmit && pnpm test`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/features/palette/CommandPalette.tsx src/features/palette/CommandPalette.test.tsx
git commit -m "feat(palette): frecency ranking + quick-actions empty state

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Manual smoke + docs touch-up

**Files:**
- Modify: `CLAUDE.md` (palette feature note, if the features map lists palette responsibilities)

- [ ] **Step 1: Run the app and smoke-test**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"; pnpm tauri dev`
Verify manually (against a scratch repo):
- ⌘P opens; chips render; `⌃Tab` cycles chips.
- Empty query shows Quick actions + Recent.
- "Merge branch into current…" → pick step → selecting a branch runs merge.
- "Create branch…" → input step → Enter creates+switches.
- "Reset current branch to…" → pick commit → pick mode → runs.
- Esc steps back one level, then closes from root.
- A frequently-run command floats up after repeated use.

- [ ] **Step 2: Update CLAUDE.md feature note**

In the `features/` map under `src/`, update the palette line to reflect the new responsibilities:

```
├── palette/         usePaletteStore (step stack + chips), commands (catalog),
│                    frecency, CommandPalette (⌘P runner: nav + search + actions)
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note expanded command palette responsibilities

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-review notes (for the implementer)

- **Spec coverage:** hybrid actions (direct/inline/launch) → Task 4; chips → Task 6; frecency + empty state → Tasks 2 & 7; comprehensive catalog → Task 4; step machine → Tasks 1, 3, 5. Error handling via existing store banner (no new surface) — inline `validate` on input steps covered in Task 5/4.
- **Out of scope (do NOT build):** context-aware ranking, prefix syntax, backend changes, extra confirm dialogs.
- **`createTag` uses `{ oid: headTip, annotation: null }`** — there is no `{kind:"head"}` target; HEAD oid comes from `currentBranch().tip ?? commits[0].oid`.
- **Push/pull force arg:** `push(remote, branch, "None" | "WithLease")`; `PullMode` left default (omit the 3rd arg).
- **`relativeTime` + `currentBranch`** both import from `@/lib/derive` — single import line in `commands.ts`.
- Danger styling uses `var(--git-removed)` (verified present in `src/index.css`); there is no `--git-deleted`/`--color-danger` token.
