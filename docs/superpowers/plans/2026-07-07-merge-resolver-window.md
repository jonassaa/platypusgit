# Merge Resolver Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A separate OS-level merge-conflict resolver window (Rider-style three-pane: ours | editable result | theirs) with per-conflict keyboard side selection, launched from the Conflict screen, auto-advancing through conflicted files.

**Architecture:** Second Tauri webview window (label `merge`) sharing the Vite bundle, routed by a `?window=merge` query param in `main.tsx`. Conflict chunking is a pure frontend function (`node-diff3` over the base/ours/theirs strings that `conflict_sides` already returns). The result pane is CodeMirror 6; per-conflict regions are tracked in a CM `StateField`. One new backend op, `save_resolution`, writes the result text and stages it. Cross-window sync is Tauri events + a `tauri://destroyed` subscription — no shared JS state.

**Tech Stack:** Tauri 2 (multi-window, events), React 19, Zustand-free window (local state), CodeMirror 6 (`@codemirror/state`, `@codemirror/view`, `@codemirror/commands`), `node-diff3`, vitest + RTL, WebdriverIO e2e via `@wdio/tauri-service` (`browser.tauri.switchWindow`).

**Spec:** `docs/superpowers/specs/2026-07-07-merge-resolver-window-design.md`

## Global Constraints

- Every shell invocation of `pnpm`/`cargo` needs `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"` first (assistant shell lacks interactive rc).
- Work happens in the existing worktree on branch `feat/merge-resolver-window`. Never commit to `main`.
- Conventional Commits, subject < 72 chars, `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.
- Rust: all IPC-crossing fns return `AppResult<T>`; no unwrap/panic in commands; git2 work wrapped in `tokio::task::spawn_blocking`.
- TS: frontend never calls `invoke()` directly — typed wrappers in `src/lib/tauri.ts` only.
- UI primitives from `@/design` barrel; no `src/components/ui/`. Path alias `@/` → `src/`.
- Styling: CSS vars (`var(--bg-0)`, `var(--fg-0)`, `var(--git-*)`, `var(--font-mono)`), inline `style={{…}}` is idiomatic here.
- After any `src/` or `src-tauri/` change, e2e requires the full `pnpm test:e2e` (rebuild); `pnpm test:e2e:run` alone tests a stale binary snapshot.
- Before writing/debugging e2e specs, read `.claude/skills/e2e-testing/SKILL.md`.
- e2e typecheck gate: `pnpm exec tsc -p e2e/tsconfig.json --noEmit` (root tsc excludes `e2e/`).
- Spec deviations already agreed during planning (do not "fix" these back):
  - `merge://closed` event replaced by a `tauri://destroyed` subscription in the opener (also covers the OS close button).
  - Side panes highlight conflict regions only (not non-conflicting changed regions) — diff3 `ok` regions don't attribute which side changed; v1 trims that polish.
  - Header shows "N files remaining" instead of "file 2 of 5".

---

### Task 1: Backend op `save_resolution`

**Files:**
- Modify: `src-tauri/src/git/mod.rs` (conflict-resolution trait section, after `mark_resolved`)
- Modify: `src-tauri/src/git/libgit2.rs` (after `mark_resolved` impl, ~line 2240)
- Modify: `src-tauri/src/git/cli.rs` (stub near the other conflict stubs)
- Modify: `src-tauri/src/commands/conflict.rs`
- Modify: `src-tauri/src/lib.rs` (invoke_handler, after `commands::conflict::mark_resolved`)
- Modify: `src/lib/tauri.ts` (Conflict resolution section)
- Test: `src-tauri/tests/conflict.rs`

**Interfaces:**
- Consumes: existing `with_conflicting_merge()` fixture, `AppError::{Io, InvalidPath, NotImplemented, Internal}`, `with_repo` helper.
- Produces: trait method `fn save_resolution(&self, repo_id: &RepoId, path: &Path, content: &str) -> AppResult<()>`; Tauri command `save_resolution(repo_id, path, content)`; TS wrapper `saveResolution(repoId: string, path: string, content: string): Promise<void>` — Task 6 calls the TS wrapper; component tests mock command name `"save_resolution"`.

- [ ] **Step 1: Write the failing tests** — append to `src-tauri/tests/conflict.rs`:

```rust
#[test]
fn save_resolution_writes_content_and_clears_conflict() {
    let tr = with_conflicting_merge();
    let (backend, handle) = tr.open_with_backend();
    backend
        .save_resolution(
            &handle.id,
            &PathBuf::from("README.md"),
            "merged content\n",
        )
        .expect("save_resolution");
    assert_eq!(read_file(tr.path(), "README.md"), "merged content\n");
    let status = backend.status(&handle.id).unwrap();
    if let Some(entry) = status.iter().find(|f| f.path == "README.md") {
        assert!(!matches!(
            entry.worktree,
            platypusgit_lib::git::types::StatusFlag::Conflicted
        ));
    }
}

#[test]
fn save_resolution_then_continue_creates_merge_commit() {
    let tr = with_conflicting_merge();
    let (backend, handle) = tr.open_with_backend();
    backend
        .save_resolution(&handle.id, &PathBuf::from("README.md"), "reconciled\n")
        .unwrap();
    // Conflict truly cleared in the index — continue_operation no longer refuses.
    let oid = backend
        .continue_operation(&handle.id)
        .expect("continue after save_resolution");
    assert_eq!(oid.len(), 40);
}
```

- [ ] **Step 2: Run to verify they fail to compile** (no trait method yet):

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && cargo test --manifest-path src-tauri/Cargo.toml --test conflict 2>&1 | tail -20`
Expected: compile error `no method named 'save_resolution'`.

- [ ] **Step 3: Implement.** Trait method in `src-tauri/src/git/mod.rs`, directly after the `mark_resolved` declaration in the `// === conflict resolution ===` section:

```rust
    /// Write `content` to the worktree file and stage it, clearing the conflict.
    fn save_resolution(&self, repo_id: &RepoId, path: &Path, content: &str) -> AppResult<()>;
```

Impl in `src-tauri/src/git/libgit2.rs`, directly after the `mark_resolved` impl:

```rust
    fn save_resolution(&self, repo_id: &RepoId, path: &Path, content: &str) -> AppResult<()> {
        self.with_repo(repo_id, |repo| {
            let workdir = repo
                .workdir()
                .ok_or_else(|| AppError::InvalidPath("bare repository".into()))?;
            std::fs::write(workdir.join(path), content)
                .map_err(|e| AppError::Io(e.to_string()))?;
            let mut index = repo.index()?;
            // remove_path drops all three conflict stages; add_path re-inserts
            // the just-written worktree version as stage 0 (same dance as
            // mark_resolved).
            let _ = index.remove_path(path);
            index.add_path(path)?;
            index.write()?;
            Ok(())
        })
    }
```

Stub in `src-tauri/src/git/cli.rs`, next to the other conflict stubs:

```rust
    fn save_resolution(&self, _repo_id: &RepoId, _path: &Path, _content: &str) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
```

Command in `src-tauri/src/commands/conflict.rs`, after `mark_resolved`:

```rust
/// Write an in-app merge resolution to the worktree and stage it.
#[tauri::command]
pub async fn save_resolution(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
    content: String,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let path = PathBuf::from(path);
    tokio::task::spawn_blocking(move || backend.save_resolution(&repo_id, &path, &content))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}
```

Register in `src-tauri/src/lib.rs` after `commands::conflict::mark_resolved,`:

```rust
            commands::conflict::save_resolution,
```

TS wrapper in `src/lib/tauri.ts`, after `markResolved`:

```ts
export async function saveResolution(
  repoId: string,
  path: string,
  content: string,
): Promise<void> {
  return invoke<void>("save_resolution", { repoId, path, content });
}
```

- [ ] **Step 4: Run tests + checks:**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && cargo test --manifest-path src-tauri/Cargo.toml --test conflict && cargo check --manifest-path src-tauri/Cargo.toml && pnpm tsc --noEmit`
Expected: all conflict tests pass (9 now), check clean, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/git/mod.rs src-tauri/src/git/libgit2.rs src-tauri/src/git/cli.rs \
  src-tauri/src/commands/conflict.rs src-tauri/src/lib.rs src/lib/tauri.ts src-tauri/tests/conflict.rs
git commit -m "feat(conflict): save_resolution backend op — write + stage merge result

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Merge chunk model (`node-diff3`)

**Files:**
- Create: `src/features/merge/mergeModel.ts`
- Test: `src/features/merge/mergeModel.test.ts`
- Modify: `package.json` (dep)

**Interfaces:**
- Consumes: `ConflictSides` from `@/lib/types` (`{ path, base: string|null, ours: string|null, theirs: string|null, binary: boolean }`); `diff3Merge` from `node-diff3` (`MergeRegion<string>[]` of `{ ok?: string[] } | { conflict?: { a, aIndex, o, oIndex, b, bIndex } }`).
- Produces (used by Tasks 4–6):

```ts
export type ChunkResolution = "ours" | "theirs" | "both" | "manual";

export interface ConflictRegion {
  id: number;
  ours: { start: number; lines: string[] };   // line range in the FULL ours file
  base: { start: number; lines: string[] };
  theirs: { start: number; lines: string[] }; // line range in the FULL theirs file
}

export interface ResultRegion {
  id: number;
  /** char offsets into initialResult; to == from for empty-base conflicts */
  from: number;
  to: number;
}

export interface MergeModel {
  oursLines: string[];
  theirsLines: string[];
  conflicts: ConflictRegion[];   // ordered by document position
  initialResult: string;         // ok regions verbatim; conflict regions filled with BASE lines
  resultRegions: ResultRegion[]; // one per conflict, char offsets into initialResult
  trailingNewline: boolean;
}

/** null → not a 3-pane case (binary, or a side deleted) — caller shows chooser. */
export function buildMergeModel(sides: ConflictSides): MergeModel | null;

/** Replacement lines for accepting a side on one conflict. */
export function resolutionLines(c: ConflictRegion, res: "ours" | "theirs" | "both"): string[];

export function splitLines(text: string): string[]; // "a\nb\n" → ["a","b"]; "" → []
```

Semantics to implement exactly:
- `splitLines`: split on `"\n"`; drop the final empty element iff the text ends with `"\n"`. `""` → `[]`.
- `trailingNewline`: `ours.endsWith("\n")`, falling back to `theirs` then `base` when ours is empty. Used by Task 6 when assembling the saved file (`lines.join("\n") + (trailingNewline ? "\n" : "")` equivalent — the editor holds text without a trailing sentinel; Apply appends `"\n"` iff `trailingNewline` and the doc is non-empty and doesn't already end with one).
- `buildMergeModel` returns `null` when `sides.binary` or `sides.ours == null` or `sides.theirs == null`. `base == null` with both sides present is fine — treat base as `""` (both-added conflict).
- Call `diff3Merge(oursLines, baseLines, theirsLines, { excludeFalseConflicts: true })` with **line arrays** (never raw strings — the default string separator is whitespace, which would garble content).
- Walk regions building `initialResult` as a line array + char cursor: `ok` regions append their lines; `conflict` regions record `from` (current char offset), append the conflict's **`o` (base) lines**, record `to`. Char offsets: each appended line contributes `line.length + 1` (the `"\n"` separator) except no trailing separator bookkeeping — simplest correct approach: build `resultLines: string[]`, track region boundaries in **line** indexes, then convert to char offsets in one pass at the end (`offsetOfLine(i) = sum of (len+1) for lines < i`), with `initialResult = resultLines.join("\n")`. For an empty-base conflict, `from == to == offsetOfLine(regionStartLine)`.
- `resolutionLines`: `ours` → `c.ours.lines`; `theirs` → `c.theirs.lines`; `both` → `[...c.ours.lines, ...c.theirs.lines]`.

- [ ] **Step 1: Add dependency**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm add node-diff3`
Expected: `node-diff3 3.2.x` in dependencies.

- [ ] **Step 2: Write the failing tests** — `src/features/merge/mergeModel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildMergeModel,
  resolutionLines,
  splitLines,
  type MergeModel,
} from "./mergeModel";
import type { ConflictSides } from "@/lib/types";

function sides(base: string | null, ours: string | null, theirs: string | null): ConflictSides {
  return { path: "f.txt", base, ours, theirs, binary: false };
}

describe("splitLines", () => {
  it("drops the trailing empty segment of newline-terminated text", () => {
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
  });
  it("keeps a non-terminated last line", () => {
    expect(splitLines("a\nb")).toEqual(["a", "b"]);
  });
  it("empty text has no lines", () => {
    expect(splitLines("")).toEqual([]);
  });
});

describe("buildMergeModel", () => {
  it("returns null for binary and deleted-side conflicts", () => {
    expect(buildMergeModel({ ...sides("b\n", "o\n", "t\n"), binary: true })).toBeNull();
    expect(buildMergeModel(sides("b\n", null, "t\n"))).toBeNull();
    expect(buildMergeModel(sides("b\n", "o\n", null))).toBeNull();
  });

  it("single conflicting line: one conflict region, base as placeholder", () => {
    const m = buildMergeModel(sides("base\n", "ours change\n", "theirs change\n"))!;
    expect(m.conflicts).toHaveLength(1);
    const c = m.conflicts[0];
    expect(c.ours.lines).toEqual(["ours change"]);
    expect(c.base.lines).toEqual(["base"]);
    expect(c.theirs.lines).toEqual(["theirs change"]);
    expect(m.initialResult).toBe("base");
    expect(m.resultRegions).toEqual([{ id: 0, from: 0, to: 4 }]);
    expect(m.trailingNewline).toBe(true);
  });

  it("auto-applies non-conflicting changes around a conflict", () => {
    // Changed lines must be separated by untouched lines — diff3 merges
    // ADJACENT change hunks into a single region. Here: ours edits line 0,
    // theirs edits line 4 (both non-conflicting), both edit line 2 (conflict);
    // lines 1 and 3 are untouched separators.
    const base = "one\ntwo\nthree\nfour\nfive\n";
    const ours = "ONE\ntwo\nC-ours\nfour\nfive\n";
    const theirs = "one\ntwo\nC-theirs\nfour\nFIVE\n";
    const m = buildMergeModel(sides(base, ours, theirs))!;
    expect(m.conflicts).toHaveLength(1);
    // Non-conflicting edits from BOTH sides land in the initial result;
    // the conflict placeholder is the base line "three".
    expect(m.initialResult.split("\n")).toEqual(["ONE", "two", "three", "four", "FIVE"]);
    const r = m.resultRegions[0];
    expect(m.initialResult.slice(r.from, r.to)).toBe("three");
    // Side line ranges point into the full side files.
    expect(m.conflicts[0].ours).toEqual({ start: 2, lines: ["C-ours"] });
    expect(m.conflicts[0].theirs).toEqual({ start: 2, lines: ["C-theirs"] });
  });

  it("both-added conflict (no base) yields an empty placeholder region", () => {
    const m = buildMergeModel(sides(null, "mine\n", "yours\n"))!;
    expect(m.conflicts).toHaveLength(1);
    expect(m.conflicts[0].base.lines).toEqual([]);
    const r = m.resultRegions[0];
    expect(r.from).toBe(r.to);
    expect(m.initialResult).toBe("");
  });

  it("identical non-conflicting texts produce zero conflicts", () => {
    const m = buildMergeModel(sides("a\nb\n", "a\nb\n", "a\nb\n"))!;
    expect(m.conflicts).toHaveLength(0);
    expect(m.initialResult).toBe("a\nb");
  });

  it("multiple conflicts keep document order and distinct offsets", () => {
    const base = "h1\nx\nmid\ny\nt1\n";
    const ours = "h1\nx-ours\nmid\ny-ours\nt1\n";
    const theirs = "h1\nx-theirs\nmid\ny-theirs\nt1\n";
    const m = buildMergeModel(sides(base, ours, theirs))!;
    expect(m.conflicts.map((c) => c.id)).toEqual([0, 1]);
    const [r0, r1] = m.resultRegions;
    expect(r0.to).toBeLessThanOrEqual(r1.from);
    expect(m.initialResult.slice(r0.from, r0.to)).toBe("x");
    expect(m.initialResult.slice(r1.from, r1.to)).toBe("y");
  });
});

describe("resolutionLines", () => {
  const c = {
    id: 0,
    ours: { start: 0, lines: ["O1", "O2"] },
    base: { start: 0, lines: ["B"] },
    theirs: { start: 0, lines: ["T"] },
  };
  it("ours / theirs / both", () => {
    expect(resolutionLines(c, "ours")).toEqual(["O1", "O2"]);
    expect(resolutionLines(c, "theirs")).toEqual(["T"]);
    expect(resolutionLines(c, "both")).toEqual(["O1", "O2", "T"]);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm vitest run src/features/merge/mergeModel.test.ts`
Expected: FAIL — module `./mergeModel` not found.

- [ ] **Step 4: Implement `src/features/merge/mergeModel.ts`** per the Interfaces block above. Skeleton (complete except trivial bodies spelled out in Interfaces):

```ts
// mergeModel — pure diff3 chunking for the merge resolver window.
// diff3Merge(ours, base, theirs) over LINE ARRAYS; `ok` regions are
// auto-applied into the initial result, `conflict` regions are filled with
// base lines and tracked as char-offset regions for the editor to own.

import { diff3Merge } from "node-diff3";
import type { ConflictSides } from "@/lib/types";

export type ChunkResolution = "ours" | "theirs" | "both" | "manual";

export interface ConflictRegion {
  id: number;
  ours: { start: number; lines: string[] };
  base: { start: number; lines: string[] };
  theirs: { start: number; lines: string[] };
}

export interface ResultRegion {
  id: number;
  from: number;
  to: number;
}

export interface MergeModel {
  oursLines: string[];
  theirsLines: string[];
  conflicts: ConflictRegion[];
  initialResult: string;
  resultRegions: ResultRegion[];
  trailingNewline: boolean;
}

export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function buildMergeModel(sides: ConflictSides): MergeModel | null {
  if (sides.binary || sides.ours == null || sides.theirs == null) return null;
  const oursLines = splitLines(sides.ours);
  const theirsLines = splitLines(sides.theirs);
  const baseLines = splitLines(sides.base ?? "");

  const regions = diff3Merge(oursLines, baseLines, theirsLines, {
    excludeFalseConflicts: true,
  });

  const resultLines: string[] = [];
  const conflicts: ConflictRegion[] = [];
  // line-index boundaries first; converted to char offsets at the end
  const lineRegions: Array<{ id: number; startLine: number; lineCount: number }> = [];

  for (const region of regions) {
    if (region.ok) {
      resultLines.push(...region.ok);
    } else if (region.conflict) {
      const c = region.conflict;
      const id = conflicts.length;
      conflicts.push({
        id,
        ours: { start: c.aIndex, lines: c.a },
        base: { start: c.oIndex, lines: c.o },
        theirs: { start: c.bIndex, lines: c.b },
      });
      lineRegions.push({ id, startLine: resultLines.length, lineCount: c.o.length });
      resultLines.push(...c.o);
    }
  }

  const initialResult = resultLines.join("\n");
  const offsetOfLine = (i: number): number => {
    let off = 0;
    for (let l = 0; l < i; l++) off += resultLines[l].length + 1;
    return off;
  };
  const resultRegions: ResultRegion[] = lineRegions.map((r) => {
    const from = offsetOfLine(r.startLine);
    const to =
      r.lineCount === 0
        ? from
        : from +
          resultLines
            .slice(r.startLine, r.startLine + r.lineCount)
            .join("\n").length;
    return { id: r.id, from, to };
  });

  const trailingNewline =
    sides.ours !== ""
      ? sides.ours.endsWith("\n")
      : sides.theirs !== ""
        ? sides.theirs.endsWith("\n")
        : (sides.base ?? "").endsWith("\n");

  return { oursLines, theirsLines, conflicts, initialResult, resultRegions, trailingNewline };
}

export function resolutionLines(
  c: ConflictRegion,
  res: "ours" | "theirs" | "both",
): string[] {
  if (res === "ours") return c.ours.lines;
  if (res === "theirs") return c.theirs.lines;
  return [...c.ours.lines, ...c.theirs.lines];
}
```

Note: an `offsetOfLine` boundary case — when a non-empty region starts at the very end of the doc after an empty-line accumulation, `join("\n")` semantics keep offsets consistent because every line index < i contributes `len + 1`. The empty-region `from == to` case is covered by the both-added test.

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run src/features/merge/mergeModel.test.ts`
Expected: PASS (all tests). If the `excludeFalseConflicts`/region shapes surprise you, `console.log(JSON.stringify(regions))` in a scratch test — do NOT reshape the public interface; later tasks depend on it.

- [ ] **Step 6: Full check + commit**

Run: `pnpm tsc --noEmit && pnpm test`
Expected: clean, all suites pass.

```bash
git add package.json pnpm-lock.yaml src/features/merge/mergeModel.ts src/features/merge/mergeModel.test.ts
git commit -m "feat(merge): diff3 chunk model for merge resolver

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Window plumbing — capability, routing, opener, window shell

**Files:**
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src-tauri/tauri.e2e.conf.json` (add `merge` to the `e2e-focus` capability windows)
- Modify: `src/main.tsx`
- Create: `src/features/merge/openMergeWindow.ts`
- Create: `src/features/merge/MergeWindow.tsx` (shell only — header, loading, chooser panel, "all resolved" empty state; the 3-pane body lands in Tasks 4–5)
- Modify: `src/test/setup.ts` (mock `@tauri-apps/api/event` and `@tauri-apps/api/webviewWindow`)
- Test: `src/features/merge/MergeWindow.test.tsx`

**Interfaces:**
- Consumes: `buildMergeModel` (Task 2), `conflictSides`, `getStatus`, `acceptOurs`, `acceptTheirs` wrappers from `@/lib/tauri` (`getStatus(repoId: string): Promise<FileStatus[]>` — confirm exact export name in `src/lib/tauri.ts` before use; it's the wrapper `useRepoStore.refreshAll` calls for `get_status`).
- Produces:
  - `openMergeWindow(repoId: string, path: string): Promise<void>` (Task 7 calls it).
  - `<MergeWindow />` reads `repoId`/`path` from `window.location.search`; exposes DOM hooks used by tests/e2e: `data-testid="merge-window"`, `data-testid="merge-file-path"`, `data-testid="merge-chooser"`, `data-testid="chooser-take-ours"`, `data-testid="chooser-take-theirs"`, `data-testid="merge-remaining"`.
  - Internal helper `findNextConflict(status: FileStatus[], current: string): string | null` exported for tests.
  - Event names: `merge://resolved` (emitted after every successful per-file resolution), `merge://open-file` (payload `{ repoId: string; path: string }`, listened to by MergeWindow).

- [ ] **Step 1: Capability + routing groundwork.**

`src-tauri/capabilities/default.json` — change `windows` and add the window-creation permission:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default permissions for platypusgit",
  "windows": ["main", "merge"],
  "permissions": [
    "core:default",
    "core:window:allow-minimize",
    "core:window:allow-toggle-maximize",
    "core:window:allow-close",
    "core:window:allow-start-dragging",
    "core:window:allow-set-title",
    "core:webview:allow-create-webview-window",
    "dialog:default",
    "dialog:allow-open",
    "os:default",
    "log:default",
    "wdio-webdriver:default"
  ]
}
```

`src-tauri/tauri.e2e.conf.json` — in the `e2e-focus` capability, change `"windows": ["main"]` to `"windows": ["main", "merge"]` (the e2e focus self-heal may need to focus the merge window too).

`src/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { attachConsole } from "@tauri-apps/plugin-log";
import App from "./App";
import { MergeWindow } from "./features/merge/MergeWindow";
import "./index.css";

if (import.meta.env.DEV) {
  attachConsole().catch((err) => {
    console.warn("attachConsole failed", err);
  });
}

// The merge resolver runs as a second Tauri window on the same bundle,
// selected by query param (see features/merge/openMergeWindow.ts).
const isMergeWindow =
  new URLSearchParams(window.location.search).get("window") === "merge";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isMergeWindow ? <MergeWindow /> : <App />}
  </React.StrictMode>,
);
```

- [ ] **Step 2: Opener** — `src/features/merge/openMergeWindow.ts`:

```ts
// Opens (or focuses) the single merge resolver window. The window fetches its
// own data over IPC; the only cross-window state is events.

import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { emit } from "@tauri-apps/api/event";
import { useRepoStore } from "@/features/repo/useRepoStore";

export async function openMergeWindow(repoId: string, path: string): Promise<void> {
  const existing = await WebviewWindow.getByLabel("merge");
  if (existing) {
    await emit("merge://open-file", { repoId, path });
    await existing.setFocus();
    return;
  }
  const win = new WebviewWindow("merge", {
    url: `/?window=merge&repoId=${encodeURIComponent(repoId)}&path=${encodeURIComponent(path)}`,
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 500,
    title: `Resolve: ${path}`,
  });
  // Any exit path (Apply-through-last-file, Esc, OS close button) must leave
  // the main window showing disk truth.
  void win.once("tauri://destroyed", () => {
    void useRepoStore.getState().refreshAll();
  });
  void win.once("tauri://error", (e) => {
    console.error("merge window failed to open", e);
  });
}
```

- [ ] **Step 3: Test mocks** — append to `src/test/setup.ts` after the `@tauri-apps/api/window` mock:

```ts
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => {
  class FakeWebviewWindow {
    static getByLabel = vi.fn().mockResolvedValue(null);
    label: string;
    constructor(label: string) {
      this.label = label;
    }
    once = vi.fn().mockResolvedValue(() => {});
    setFocus = vi.fn().mockResolvedValue(undefined);
    close = vi.fn().mockResolvedValue(undefined);
  }
  return { WebviewWindow: FakeWebviewWindow };
});
```

Also extend the existing `@tauri-apps/api/window` mock's `win` object with `setTitle: vi.fn().mockResolvedValue(undefined)` (MergeWindow sets the title on file switch).

- [ ] **Step 4: Failing component tests** — `src/features/merge/MergeWindow.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MergeWindow, findNextConflict } from "./MergeWindow";
import { mockInvoke, getInvokeCalls } from "@/test/invokeMock";
import type { FileStatus } from "@/lib/types";

function conflictedStatus(paths: string[]): FileStatus[] {
  return paths.map((path) => ({
    path,
    index: { kind: "Conflicted" },
    worktree: { kind: "Conflicted" },
  })) as unknown as FileStatus[];
}

function setSearch(params: string) {
  window.history.replaceState(null, "", `/?${params}`);
}

describe("findNextConflict", () => {
  it("picks the first conflicted path that is not the current file", () => {
    const st = conflictedStatus(["a.txt", "b.txt"]);
    expect(findNextConflict(st, "a.txt")).toBe("b.txt");
  });
  it("returns null when nothing conflicted remains", () => {
    expect(findNextConflict([], "a.txt")).toBeNull();
  });
});

describe("MergeWindow shell", () => {
  it("loads sides for the file from the query string", async () => {
    setSearch("window=merge&repoId=r1&path=conflict.txt");
    mockInvoke("get_status", () => conflictedStatus(["conflict.txt"]));
    mockInvoke("conflict_sides", () => ({
      path: "conflict.txt",
      base: "base\n",
      ours: "ours change\n",
      theirs: "theirs change\n",
      binary: false,
    }));
    render(<MergeWindow />);
    await waitFor(() =>
      expect(screen.getByTestId("merge-file-path")).toHaveTextContent("conflict.txt"),
    );
    expect(
      getInvokeCalls().some(
        (c) => c.cmd === "conflict_sides" && c.args.path === "conflict.txt",
      ),
    ).toBe(true);
  });

  it("shows the chooser for binary conflicts and resolves via accept_theirs", async () => {
    setSearch("window=merge&repoId=r1&path=blob.bin");
    mockInvoke("get_status", () => conflictedStatus(["blob.bin"]));
    mockInvoke("conflict_sides", () => ({
      path: "blob.bin", base: null, ours: null, theirs: null, binary: true,
    }));
    mockInvoke("accept_theirs", () => undefined);
    render(<MergeWindow />);
    await screen.findByTestId("merge-chooser");
    await userEvent.click(screen.getByTestId("chooser-take-theirs"));
    await waitFor(() =>
      expect(getInvokeCalls().some((c) => c.cmd === "accept_theirs")).toBe(true),
    );
  });

  it("shows deleted-side chooser labels when ours is null", async () => {
    setSearch("window=merge&repoId=r1&path=gone.txt");
    mockInvoke("get_status", () => conflictedStatus(["gone.txt"]));
    mockInvoke("conflict_sides", () => ({
      path: "gone.txt", base: "b\n", ours: null, theirs: "t\n", binary: false,
    }));
    render(<MergeWindow />);
    await screen.findByTestId("merge-chooser");
    expect(screen.getByTestId("chooser-take-ours")).toHaveTextContent(/delete/i);
  });
});
```

Run: `pnpm vitest run src/features/merge/MergeWindow.test.tsx`
Expected: FAIL — `MergeWindow` module missing.

- [ ] **Step 5: Implement the shell** — `src/features/merge/MergeWindow.tsx`:

```tsx
// MergeWindow — root component of the `merge` Tauri window (see main.tsx).
// Owns: which file is open, sides fetching, chooser fallback for
// binary/deleted conflicts, auto-advance. The 3-pane editor body mounts in
// <MergeBody> (Tasks 4–5); until then this renders header + placeholder.

import React from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit, listen } from "@tauri-apps/api/event";
import { PGButton, PGEmpty, PGIcon, PGSpinner } from "@/design";
import {
  acceptOurs as acceptOursIpc,
  acceptTheirs as acceptTheirsIpc,
  conflictSides,
  getStatus,
} from "@/lib/tauri";
import type { ConflictSides, FileStatus } from "@/lib/types";

export function findNextConflict(status: FileStatus[], current: string): string | null {
  const next = status.find(
    (s) =>
      (s.worktree.kind === "Conflicted" || s.index.kind === "Conflicted") &&
      s.path !== current,
  );
  return next ? next.path : null;
}

function isConflicted(s: FileStatus): boolean {
  return s.worktree.kind === "Conflicted" || s.index.kind === "Conflicted";
}

export function MergeWindow() {
  const params = new URLSearchParams(window.location.search);
  const [repoId, setRepoId] = React.useState(params.get("repoId") ?? "");
  const [path, setPath] = React.useState(params.get("path") ?? "");
  const [sides, setSides] = React.useState<ConflictSides | null>(null);
  const [remaining, setRemaining] = React.useState(0);
  const [loading, setLoading] = React.useState(true);

  // Load sides + remaining count whenever the target file changes.
  React.useEffect(() => {
    if (!repoId || !path) return;
    let stale = false;
    setLoading(true);
    setSides(null);
    Promise.all([conflictSides(repoId, path), getStatus(repoId)])
      .then(([s, status]) => {
        if (stale) return;
        setSides(s);
        setRemaining(status.filter(isConflicted).length);
      })
      .catch((e) => console.error("merge window load failed", e))
      .finally(() => !stale && setLoading(false));
    void getCurrentWindow().setTitle(`Resolve: ${path}`);
    return () => {
      stale = true;
    };
  }, [repoId, path]);

  // Main window can retarget an already-open resolver.
  React.useEffect(() => {
    const un = listen<{ repoId: string; path: string }>("merge://open-file", (e) => {
      setRepoId(e.payload.repoId);
      setPath(e.payload.path);
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  /** After a file is resolved: notify main, load next conflict or close. */
  const advance = React.useCallback(async () => {
    await emit("merge://resolved", { repoId, path });
    const status = await getStatus(repoId);
    const next = findNextConflict(status, path);
    if (next) setPath(next);
    else await getCurrentWindow().close();
  }, [repoId, path]);

  const chooser = sides && (sides.binary || sides.ours == null || sides.theirs == null);

  return (
    <div
      data-testid="merge-window"
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-0)",
        color: "var(--fg-0)",
      }}
    >
      <div
        style={{
          padding: "10px 14px",
          background: "var(--bg-1)",
          borderBottom: "1px solid var(--border-0)",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <PGIcon name="merge" size={16} />
        <span
          data-testid="merge-file-path"
          style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-13)", flex: 1 }}
        >
          {path}
        </span>
        <span
          data-testid="merge-remaining"
          style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-11)", color: "var(--fg-2)" }}
        >
          {remaining} file{remaining !== 1 ? "s" : ""} remaining
        </span>
      </div>

      {loading ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <PGSpinner size={18} />
        </div>
      ) : chooser ? (
        <ChooserPanel sides={sides!} repoId={repoId} path={path} onResolved={advance} />
      ) : sides ? (
        // Tasks 4–5 replace this placeholder with the 3-pane editor body.
        <PGEmpty icon="merge" title="Merge editor loading">
          3-pane editor lands in the next task.
        </PGEmpty>
      ) : (
        <PGEmpty icon="conflict" title="Nothing to resolve">
          This file has no conflict entry (it may already be resolved).
        </PGEmpty>
      )}
    </div>
  );
}

// Binary or deleted-on-one-side conflicts: no 3-pane editor, just a choice.
function ChooserPanel({
  sides,
  repoId,
  path,
  onResolved,
}: {
  sides: ConflictSides;
  repoId: string;
  path: string;
  onResolved: () => Promise<void>;
}) {
  const [busy, setBusy] = React.useState(false);
  const oursLabel = sides.binary
    ? "Take ours"
    : sides.ours == null
      ? "Resolve as deleted (ours)"
      : "Keep our version";
  const theirsLabel = sides.binary
    ? "Take theirs"
    : sides.theirs == null
      ? "Resolve as deleted (theirs)"
      : "Keep their version";
  const pick = async (side: "ours" | "theirs") => {
    setBusy(true);
    try {
      if (side === "ours") await acceptOursIpc(repoId, path);
      else await acceptTheirsIpc(repoId, path);
      await onResolved();
    } catch (e) {
      console.error("chooser resolution failed", e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      data-testid="merge-chooser"
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        color: "var(--fg-2)",
      }}
    >
      <PGIcon name="file" size={32} />
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-13)" }}>
        {sides.binary
          ? "Binary file — pick a side"
          : "File deleted on one side — pick an outcome"}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <PGButton size="sm" variant="outline" icon="chevronLeft" disabled={busy}
          data-testid="chooser-take-ours" onClick={() => pick("ours")}>
          {oursLabel}
        </PGButton>
        <PGButton size="sm" variant="outline" icon="chevronRight" disabled={busy}
          data-testid="chooser-take-theirs" onClick={() => pick("theirs")}>
          {theirsLabel}
        </PGButton>
      </div>
    </div>
  );
}
```

Check `getStatus` export name in `src/lib/tauri.ts` (the `get_status` wrapper) and `FileStatus` shape in `src/lib/types.ts` (`index`/`worktree` carry `{ kind: … }` flags — mirror whatever `Conflict.tsx:373` filters on). Adjust the two imports if names differ — do not add new wrappers.

- [ ] **Step 6: Run tests, then all tests**

Run: `pnpm vitest run src/features/merge/MergeWindow.test.tsx && pnpm test && pnpm tsc --noEmit`
Expected: new file PASS; full suite PASS (setup.ts mock additions must not break existing suites); tsc clean.

- [ ] **Step 7: Manual smoke (dev app):**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm tauri dev`, confirm the main window still boots normally (query-param routing defaults to `<App/>`), then close it (port 4445 must be free for later e2e runs). The actual second-window flow is exercised manually in Task 9 and by e2e in Task 8.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/capabilities/default.json src-tauri/tauri.e2e.conf.json src/main.tsx \
  src/features/merge/openMergeWindow.ts src/features/merge/MergeWindow.tsx \
  src/test/setup.ts src/features/merge/MergeWindow.test.tsx
git commit -m "feat(merge): second-window plumbing, opener, resolver shell + chooser

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Result editor core (CodeMirror 6)

**Files:**
- Create: `src/features/merge/resultEditor.ts`
- Test: `src/features/merge/resultEditor.test.ts`
- Modify: `package.json` (deps), `src/test/setup.ts` (jsdom CM6 stubs)

**Interfaces:**
- Consumes: `MergeModel`, `ResultRegion`, `ChunkResolution`, `resolutionLines`, `ConflictRegion` from `./mergeModel`.
- Produces (Task 5/6 consume):

```ts
export interface RegionState {
  id: number;
  from: number;                       // current char offsets (mapped through edits)
  to: number;
  resolution: ChunkResolution | null; // null = unresolved
}

export interface EditorHandle {
  view: EditorView;
  /** Replace region text with the side's lines and mark it resolved. */
  accept(id: number, res: "ours" | "theirs" | "both"): void;
  /** Current region states (position-mapped). */
  regions(): RegionState[];
  /** Scroll region into view + move cursor to its start. */
  reveal(id: number): void;
  destroy(): void;
}

export function createResultEditor(opts: {
  model: MergeModel;
  parent: HTMLElement;
  /** Called after every transaction that changed region state or doc. */
  onChange: (regions: RegionState[]) => void;
}): EditorHandle;
```

Implementation requirements:
- Deps: `pnpm add @codemirror/state @codemirror/view @codemirror/commands`.
- A `StateField<RegionState[]>` seeded from `model.resultRegions` (all `resolution: null`).
- A `StateEffect<{ id: number; resolution: ChunkResolution; from: number; to: number }>` (`setRegionEffect`) applied by `accept()` — carries explicit new offsets so replacement text doesn't collapse the region during position mapping.
- Field update: first map every region through `tr.changes` (`mapPos(from, 1)`, `mapPos(to, -1)`, clamp `to >= from`); then apply `setRegionEffect`s verbatim; then, if `tr.docChanged` and the transaction lacks the `programmaticAccept` annotation, mark any UNRESOLVED region whose OLD range overlapped a changed range as `resolution: "manual"` (use `tr.changes.iterChangedRanges((fromA, toA) => …)` against pre-map offsets; overlap test `fromA <= region.to && toA >= region.from`).
- `accept(id, res)`: look up current region, `insert = resolutionLines(conflict, res).join("\n")`; dispatch one transaction `{ changes: { from, to, insert }, effects: setRegionEffect.of({ id, resolution: res, from, to: from + insert.length }), annotations: programmaticAccept.of(true) }`. Empty-base regions (`from === to`) work identically — but when inserting into an empty region that sits flush against surrounding text, prepend/append `"\n"` separators as needed so lines stay whole: if `from > 0` and the char before is not `"\n"`, prefix `"\n"`; if `to < doc.length` and the char at `to` is not `"\n"`, suffix `"\n"` (offsets in the effect must count the added separators).
- Editor extensions: `lineNumbers()`, `history()`, `keymap.of([...defaultKeymap, ...historyKeymap])`, the region field, a `EditorView.updateListener` calling `onChange` when `update.docChanged || update.transactions.some(hasSetRegionEffect)`, and a line-decoration extension painting unresolved regions (`class "merge-unresolved"`) and resolved ones (`class "merge-resolved"`) derived from the field via `EditorView.decorations.compute`. Zero-length regions get a `Decoration.widget` marker (a small `◆ unresolved conflict` pill element with class `merge-empty-marker`).
- Theme: `EditorView.theme({ "&": { fontFamily: "var(--font-mono)", fontSize: "var(--fs-12)", height: "100%" }, ".merge-unresolved": { backgroundColor: "oklch(0.72 0.15 325 / 0.14)" }, ".merge-resolved": { backgroundColor: "oklch(0.72 0.15 155 / 0.08)" } })`.
- jsdom stubs in `src/test/setup.ts` (CM6 measurement APIs missing in jsdom):

```ts
// CodeMirror 6 needs layout APIs jsdom lacks. Rendering fidelity is
// irrelevant in tests — only document/transaction state is asserted.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }) as DOMRect;
}
```

(If vitest reports these already exist or CM needs `document.elementFromPoint`, stub the same way — empty-function stubs are fine.)

- [ ] **Step 1: Add deps**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm add @codemirror/state @codemirror/view @codemirror/commands`

- [ ] **Step 2: Failing tests** — `src/features/merge/resultEditor.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMergeModel } from "./mergeModel";
import { createResultEditor, type EditorHandle } from "./resultEditor";
import type { ConflictSides } from "@/lib/types";

function makeEditor(base: string, ours: string, theirs: string) {
  const sides: ConflictSides = { path: "f.txt", base, ours, theirs, binary: false };
  const model = buildMergeModel(sides)!;
  const onChange = vi.fn();
  const handle = createResultEditor({
    model,
    parent: document.createElement("div"),
    onChange,
  });
  return { model, handle, onChange };
}

let h: EditorHandle | null = null;
afterEach(() => {
  h?.destroy();
  h = null;
});

describe("createResultEditor", () => {
  it("seeds doc with initialResult and one unresolved region", () => {
    const { model, handle } = makeEditor("base\n", "ours change\n", "theirs change\n");
    h = handle;
    expect(handle.view.state.doc.toString()).toBe(model.initialResult);
    expect(handle.regions()).toEqual([
      { id: 0, from: 0, to: 4, resolution: null },
    ]);
  });

  it("accept('ours') replaces region text and marks it resolved", () => {
    const { handle, onChange } = makeEditor("base\n", "ours change\n", "theirs change\n");
    h = handle;
    handle.accept(0, "ours");
    expect(handle.view.state.doc.toString()).toBe("ours change");
    expect(handle.regions()[0]).toMatchObject({ resolution: "ours", from: 0, to: 11 });
    expect(onChange).toHaveBeenCalled();
  });

  it("accept('both') concatenates ours then theirs", () => {
    const { handle } = makeEditor("base\n", "ours change\n", "theirs change\n");
    h = handle;
    handle.accept(0, "both");
    expect(handle.view.state.doc.toString()).toBe("ours change\ntheirs change");
    expect(handle.regions()[0].resolution).toBe("both");
  });

  it("hand-editing inside an unresolved region marks it manual", () => {
    const { handle } = makeEditor("base\n", "ours change\n", "theirs change\n");
    h = handle;
    // Simulate a user edit (no programmaticAccept annotation).
    handle.view.dispatch({ changes: { from: 0, to: 4, insert: "hand" } });
    expect(handle.regions()[0].resolution).toBe("manual");
  });

  it("editing OUTSIDE regions does not resolve anything but maps offsets", () => {
    const base = "one\ntwo\nthree\n";
    const ours = "one\ntwo-ours\nthree\n";
    const theirs = "one\ntwo-theirs\nthree\n";
    const { handle } = makeEditor(base, ours, theirs);
    h = handle;
    const before = handle.regions()[0];
    // Insert at doc start (before the conflict region).
    handle.view.dispatch({ changes: { from: 0, to: 0, insert: "// header\n" } });
    const after = handle.regions()[0];
    expect(after.resolution).toBeNull();
    expect(after.from).toBe(before.from + "// header\n".length);
  });

  it("undo after accept restores text AND unresolved status", () => {
    const { handle } = makeEditor("base\n", "ours change\n", "theirs change\n");
    h = handle;
    handle.accept(0, "theirs");
    expect(handle.regions()[0].resolution).toBe("theirs");
    undo(handle.view); // add `import { undo } from "@codemirror/commands"` at top
    expect(handle.view.state.doc.toString()).toBe("base");
    expect(handle.regions()[0].resolution).toBeNull();
  });

  it("empty-base region accept inserts whole lines with separators", () => {
    const { handle } = makeEditor("", "mine\n", "yours\n");
    h = handle;
    handle.accept(0, "both");
    expect(handle.view.state.doc.toString()).toBe("mine\nyours");
    expect(handle.regions()[0].resolution).toBe("both");
  });
});
```

Note on the undo test: CM6 history inverts doc changes but not our field, so the field's `update` must special-case history transactions — after position-mapping, if `tr.annotation(Transaction.userEvent) === "undo"` and the change intersects a region, set `resolution: null`; if `"redo"` intersects an unresolved region, set `resolution: "manual"`. The test asserts the undo branch only; comment both.

- [ ] **Step 3: Run to verify failure**

Run: `pnpm vitest run src/features/merge/resultEditor.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 4: Implement `resultEditor.ts`** per the requirements block. Structure:

```ts
import {
  Annotation,
  EditorState,
  StateEffect,
  StateField,
  Transaction,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  resolutionLines,
  type ChunkResolution,
  type MergeModel,
} from "./mergeModel";

export interface RegionState {
  id: number;
  from: number;
  to: number;
  resolution: ChunkResolution | null;
}

const programmaticAccept = Annotation.define<boolean>();
const setRegionEffect = StateEffect.define<{
  id: number;
  resolution: ChunkResolution;
  from: number;
  to: number;
}>();
```

The region field — the crux of the file, use this verbatim:

```ts
const regionsField = StateField.define<RegionState[]>({
  create: () => [],
  update(regions, tr) {
    if (!tr.docChanged && !tr.effects.some((e) => e.is(setRegionEffect))) {
      return regions;
    }
    const isAccept = tr.annotation(programmaticAccept) === true;
    const userEvent = tr.annotation(Transaction.userEvent);
    let next = regions.map((r) => {
      // Overlap test against PRE-map offsets.
      let touched = false;
      if (tr.docChanged) {
        tr.changes.iterChangedRanges((fromA, toA) => {
          if (fromA <= r.to && toA >= r.from) touched = true;
        });
      }
      const from = tr.changes.mapPos(r.from, 1);
      const to = Math.max(from, tr.changes.mapPos(r.to, -1));
      let resolution = r.resolution;
      if (touched && !isAccept) {
        if (userEvent === "undo") resolution = null;          // undone accept
        else if (r.resolution === null) resolution = "manual"; // hand edit / redo
      }
      return { ...r, from, to, resolution };
    });
    for (const e of tr.effects) {
      if (e.is(setRegionEffect)) {
        next = next.map((r) =>
          r.id === e.value.id
            ? { ...r, from: e.value.from, to: e.value.to, resolution: e.value.resolution }
            : r,
        );
      }
    }
    return next;
  },
});
```

Then: seed via `regionsField.init(() => model.resultRegions.map((r) => ({ ...r, resolution: null })))` inside `EditorState.create({ doc: model.initialResult, extensions: […] })`; the decoration compute + theme per the requirements block; `createResultEditor` assembles everything and returns the handle. `regions()` reads `view.state.field(regionsField)`. `accept()` computes separator-padded insert text per the requirements, then dispatches changes + `setRegionEffect` + `programmaticAccept.of(true)` in ONE transaction. `reveal(id)` dispatches `{ selection: { anchor: region.from }, effects: EditorView.scrollIntoView(region.from, { y: "center" }) }`. `destroy()` calls `view.destroy()`.

- [ ] **Step 5: Run tests until green, then full suite**

Run: `pnpm vitest run src/features/merge/resultEditor.test.ts && pnpm test && pnpm tsc --noEmit`
Expected: PASS all. Known jsdom trap: if CM throws on `document.elementFromPoint` or `MutationObserver` timing, extend the setup.ts stub block — never fake the CM API itself.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/features/merge/resultEditor.ts \
  src/features/merge/resultEditor.test.ts src/test/setup.ts
git commit -m "feat(merge): CM6 result editor — tracked conflict regions, accepts, manual-edit detection

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Three-pane body — side panes, chevrons, scroll sync

**Files:**
- Create: `src/features/merge/SidePane.tsx`
- Create: `src/features/merge/MergeBody.tsx`
- Modify: `src/features/merge/MergeWindow.tsx` (replace the Task-3 placeholder with `<MergeBody …>`)
- Test: `src/features/merge/MergeBody.test.tsx`

**Interfaces:**
- Consumes: `MergeModel`, `ConflictRegion` (Task 2); `createResultEditor`, `EditorHandle`, `RegionState` (Task 4).
- Produces:

```tsx
// MergeBody props — Task 6 adds keyboard + apply on top of these callbacks.
// Selection (currentConflict) is OWNED BY MergeWindow and passed down; MergeBody
// holds no selection state of its own.
export interface MergeBodyHandle {
  accept(id: number, res: "ours" | "theirs" | "both"): void;
  reveal(id: number): void;
  /** Editor text + regions for Apply (Task 6). */
  resultText(): string;
  regions(): RegionState[];
}
export const MergeBody: React.ForwardRefExoticComponent<
  {
    model: MergeModel;
    currentConflict: number | null;
    onRegionsChange: (r: RegionState[]) => void;
  } & React.RefAttributes<MergeBodyHandle>
>;

// SidePane
export function SidePane(props: {
  side: "ours" | "theirs";
  lines: string[];
  conflicts: ConflictRegion[];
  regionStates: RegionState[];        // resolution status by id (for dimming resolved chevrons)
  currentConflict: number | null;     // highlighted conflict id
  onAccept: (id: number) => void;     // chevron click
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
}): React.JSX.Element;
```

Rendering rules:
- SidePane renders ALL its lines in a single scrollable `<div>` (monospace, `whiteSpace: "pre"`, `lineHeight: "var(--lh-code)"`, one `<div data-line>` per line — uniform height, no wrapping). Lines inside any `conflicts[k]` range for that side get background `oklch(0.72 0.15 325 / 0.12)`; if that conflict is resolved, `oklch(0.72 0.15 155 / 0.07)`; if it is `currentConflict`, add a 2px left border `var(--accent)`.
- Each conflict's FIRST line renders a small chevron button in a left gutter column (`≫` for ours-pane meaning "take ours", `≪` for theirs-pane): `data-testid={side === "ours" ? \`accept-chevron-ours-${id}\` : \`accept-chevron-theirs-${id}\`}`, disabled when that region is resolved. For a conflict with zero lines on that side (side deleted those lines), render a single phantom row `∅` carrying the chevron.
- Pane headers: `YOURS` (color `var(--accent)`) / `THEIRS` (color `var(--accent-2, var(--fg-1))`) — same style as Conflict.tsx SideColumn headers.
- MergeBody layout: `display:flex`, three columns flex 1 each, 1px `var(--border-0)` separators, middle column hosts the CM editor (`data-testid="merge-result"`; mount via `React.useRef` + `useEffect` creating/destroying `createResultEditor`).
- Scroll sync (uniform line heights across panes): anchor table from the model — for conflict k: `oursLine = conflicts[k].ours.start`, `theirsLine = conflicts[k].theirs.start`, `resultLine = line index of regions()[k].from` (compute via `view.state.doc.lineAt(from).number - 1`). Implement `syncFrom(source: "ours" | "result" | "theirs")`: read source top line (`scrollTop / lineHeightPx`; for CM use `view.scrollDOM.scrollTop`), piecewise-linear interpolate between surrounding anchors to a target line per other pane, set their `scrollTop = line * lineHeightPx`. Guard with a `syncing` ref so programmatic scrolls don't re-trigger. Measure `lineHeightPx` once from a rendered line (`getBoundingClientRect().height`, fallback 18). In jsdom heights are 0 — the sync function must no-op when `lineHeightPx <= 0` (guard doubles as the test-environment escape hatch).

- [ ] **Step 1: Failing tests** — `src/features/merge/MergeBody.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MergeBody, type MergeBodyHandle } from "./MergeBody";
import { buildMergeModel } from "./mergeModel";
import type { ConflictSides } from "@/lib/types";

const sides: ConflictSides = {
  path: "f.txt",
  base: "one\nbase\nthree\n",
  ours: "one\nours line\nthree\n",
  theirs: "one\ntheirs line\nthree\n",
  binary: false,
};

function renderBody() {
  const model = buildMergeModel(sides)!;
  const onRegionsChange = vi.fn();
  const ref = React.createRef<MergeBodyHandle>();
  render(<MergeBody ref={ref} model={model} onRegionsChange={onRegionsChange} />);
  return { ref, onRegionsChange };
}

describe("MergeBody", () => {
  it("renders both side panes and the result editor", () => {
    renderBody();
    expect(screen.getByText("YOURS")).toBeInTheDocument();
    expect(screen.getByText("THEIRS")).toBeInTheDocument();
    expect(screen.getByTestId("merge-result")).toBeInTheDocument();
    expect(screen.getByText("ours line")).toBeInTheDocument();
    expect(screen.getByText("theirs line")).toBeInTheDocument();
  });

  it("ours chevron accepts ours into the result", async () => {
    const { ref, onRegionsChange } = renderBody();
    await userEvent.click(screen.getByTestId("accept-chevron-ours-0"));
    expect(ref.current!.resultText()).toBe("one\nours line\nthree");
    expect(ref.current!.regions()[0].resolution).toBe("ours");
    expect(onRegionsChange).toHaveBeenCalled();
  });

  it("theirs chevron disabled after resolution", async () => {
    renderBody();
    await userEvent.click(screen.getByTestId("accept-chevron-ours-0"));
    expect(screen.getByTestId("accept-chevron-theirs-0")).toBeDisabled();
  });

  it("imperative accept('both') works through the handle", () => {
    const { ref } = renderBody();
    ref.current!.accept(0, "both");
    expect(ref.current!.resultText()).toBe("one\nours line\ntheirs line\nthree");
  });
});
```

Run: `pnpm vitest run src/features/merge/MergeBody.test.tsx` — Expected: FAIL (module missing).

- [ ] **Step 2: Implement `SidePane.tsx` and `MergeBody.tsx`** per the rendering rules. MergeBody skeleton:

```tsx
import React from "react";
import { SidePane } from "./SidePane";
import { createResultEditor, type EditorHandle, type RegionState } from "./resultEditor";
import type { MergeModel } from "./mergeModel";

export interface MergeBodyHandle {
  accept(id: number, res: "ours" | "theirs" | "both"): void;
  reveal(id: number): void;
  resultText(): string;
  regions(): RegionState[];
}

export const MergeBody = React.forwardRef<
  MergeBodyHandle,
  {
    model: MergeModel;
    currentConflict: number | null;
    onRegionsChange: (r: RegionState[]) => void;
  }
>(function MergeBody({ model, currentConflict, onRegionsChange }, ref) {
  const editorHost = React.useRef<HTMLDivElement>(null);
  const editor = React.useRef<EditorHandle | null>(null);
  const [regionStates, setRegionStates] = React.useState<RegionState[]>([]);
  const oursScroll = React.useRef<HTMLDivElement>(null);
  const theirsScroll = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!editorHost.current) return;
    const handle = createResultEditor({
      model,
      parent: editorHost.current,
      onChange: (r) => {
        setRegionStates(r);
        onRegionsChange(r);
      },
    });
    editor.current = handle;
    setRegionStates(handle.regions());
    onRegionsChange(handle.regions());
    return () => {
      handle.destroy();
      editor.current = null;
    };
    // model identity changes only when the file changes — full remount wanted.
  }, [model]);

  const accept = React.useCallback((id: number, res: "ours" | "theirs" | "both") => {
    editor.current?.accept(id, res);
  }, []);

  React.useImperativeHandle(ref, () => ({
    accept,
    reveal: (id) => editor.current?.reveal(id),
    resultText: () => editor.current?.view.state.doc.toString() ?? "",
    regions: () => editor.current?.regions() ?? [],
  }));

  // Scroll sync: piecewise-linear interpolation between conflict anchors.
  const syncing = React.useRef(false);
  const syncFrom = React.useCallback(
    (source: "ours" | "result" | "theirs") => {
      if (syncing.current) return;
      const view = editor.current?.view;
      if (!view) return;
      const firstRow = oursScroll.current?.querySelector("[data-line]");
      const lineH = firstRow?.getBoundingClientRect().height ?? 0;
      if (lineH <= 0) return; // jsdom / not laid out yet — nothing to sync
      const regions = editor.current!.regions();
      const resultLineOf = (from: number) => view.state.doc.lineAt(from).number - 1;
      // Anchor rows per pane: [0, …conflict starts…, lineCount] so interpolation
      // covers the whole document.
      const anchors = {
        ours: [0, ...model.conflicts.map((c) => c.ours.start), model.oursLines.length],
        theirs: [0, ...model.conflicts.map((c) => c.theirs.start), model.theirsLines.length],
        result: [0, ...regions.map((r) => resultLineOf(r.from)), view.state.doc.lines],
      };
      const tops = {
        ours: oursScroll.current?.scrollTop ?? 0,
        theirs: theirsScroll.current?.scrollTop ?? 0,
        result: view.scrollDOM.scrollTop,
      };
      const srcLine = tops[source] / lineH;
      const src = anchors[source];
      // Find surrounding anchor segment in the source pane.
      let seg = 0;
      while (seg < src.length - 2 && src[seg + 1] <= srcLine) seg++;
      const span = Math.max(1, src[seg + 1] - src[seg]);
      const frac = (srcLine - src[seg]) / span;
      const project = (target: number[]) =>
        (target[seg] + frac * Math.max(1, target[seg + 1] - target[seg])) * lineH;
      syncing.current = true;
      try {
        if (source !== "ours" && oursScroll.current)
          oursScroll.current.scrollTop = project(anchors.ours);
        if (source !== "theirs" && theirsScroll.current)
          theirsScroll.current.scrollTop = project(anchors.theirs);
        if (source !== "result") view.scrollDOM.scrollTop = project(anchors.result);
      } finally {
        // Release after the scroll events we just caused have fired.
        requestAnimationFrame(() => {
          syncing.current = false;
        });
      }
    },
    [model],
  );

  // Result-pane scroll listener (side panes wire onScroll via props below).
  React.useEffect(() => {
    const dom = editor.current?.view.scrollDOM;
    if (!dom) return;
    const onScroll = () => syncFrom("result");
    dom.addEventListener("scroll", onScroll);
    return () => dom.removeEventListener("scroll", onScroll);
    // editor.current is set by the model effect above; re-run with it.
  }, [model, syncFrom]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
      <SidePane side="ours" lines={model.oursLines} conflicts={model.conflicts}
        regionStates={regionStates} currentConflict={currentConflict}
        onAccept={(id) => accept(id, "ours")}
        scrollRef={oursScroll} onScroll={() => syncFrom("ours")} />
      <div style={{ width: 1, background: "var(--border-0)" }} />
      <div ref={editorHost} data-testid="merge-result"
        style={{ flex: 1, minWidth: 0, overflow: "hidden" }} />
      <div style={{ width: 1, background: "var(--border-0)" }} />
      <SidePane side="theirs" lines={model.theirsLines} conflicts={model.conflicts}
        regionStates={regionStates} currentConflict={currentConflict}
        onAccept={(id) => accept(id, "theirs")}
        scrollRef={theirsScroll} onScroll={() => syncFrom("theirs")} />
    </div>
  );
});
```

Then in `MergeWindow.tsx`, replace the Task-3 placeholder branch (`<PGEmpty icon="merge" title="Merge editor loading">…`) with:

```tsx
      ) : model ? (
        <MergeBody
          key={path}
          ref={bodyRef}
          model={model}
          currentConflict={currentId}
          onRegionsChange={setRegionStates}
        />
      ) : (
```

with these additions to MergeWindow (Task 6 consumes all of them):

```tsx
  const bodyRef = React.useRef<MergeBodyHandle>(null);
  const [regionStates, setRegionStates] = React.useState<RegionState[]>([]);
  const model = React.useMemo(
    () => (sides ? buildMergeModel(sides) : null),
    [sides],
  );
  const [currentId, setCurrentId] = React.useState<number | null>(null);
  // First unresolved conflict is current whenever a new file/model loads.
  React.useEffect(() => {
    setCurrentId(model && model.conflicts.length > 0 ? 0 : null);
    setRegionStates([]);
  }, [model]);
```

plus imports `buildMergeModel`, `MergeBody`, `MergeBodyHandle`, `RegionState`. The memo (not an IIFE in JSX) is required — rebuilding the model every render would remount the editor. The `chooser` conditional stays BEFORE the `model` branch (chooser cases are exactly the `buildMergeModel → null` cases).

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run src/features/merge/ && pnpm test && pnpm tsc --noEmit`
Expected: all merge suites + full suite PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/merge/SidePane.tsx src/features/merge/MergeBody.tsx \
  src/features/merge/MergeWindow.tsx src/features/merge/MergeBody.test.tsx
git commit -m "feat(merge): three-pane body — side panes, accept chevrons, scroll sync

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Keyboard chords, footer, Apply + auto-advance

**Files:**
- Modify: `src/features/merge/MergeWindow.tsx`
- Test: `src/features/merge/MergeWindow.test.tsx` (extend)

**Interfaces:**
- Consumes: `eventToChord`, `formatChord` from `@/features/keymap/chord` (pure module — safe outside the main window; do NOT import the keymap store); `saveResolution` (Task 1); `MergeBodyHandle`, `RegionState` (Tasks 4–5); `emit` + `getCurrentWindow` already imported.
- Produces: fixed chord table (window-level `keydown`, capture phase):

| Chord (canonical) | Action |
| --- | --- |
| `F7` | next conflict (wrap-around) |
| `Shift+F7` | previous conflict |
| `Mod+1` | accept ours for current conflict |
| `Mod+2` | accept theirs |
| `Mod+3` | accept both |
| `Mod+Enter` | Apply (only when all regions resolved) |
| `Mod+W`, `Escape` | close window (confirm when any region touched) |

DOM hooks: `data-testid="merge-apply"`, `data-testid="merge-close"`, `data-testid="merge-conflict-counter"`.

Behavior to implement:
- Selection: `currentId` state already lives in MergeWindow (Task 5) and flows into MergeBody's `currentConflict` prop. Moving it calls `setCurrentId(id)` + `bodyRef.current.reveal(id)` together.
- Next/prev: order = region ids ascending; F7 from `currentId` → first UNRESOLVED region after it, wrapping; if all resolved, plain next id wrap. `⇧F7` mirrored backwards. On change call `reveal`.
- Accept chords no-op when `currentId == null` or region already resolved? Accepting an already-resolved region is allowed (re-accept overwrites the region text with the newly chosen side) — matches Rider's re-click behavior. After an accept, auto-advance `currentId` to the next unresolved region (if any).
- Apply: enabled iff `regionStates.length > 0 && regionStates.every(r => r.resolution !== null)` (a file whose model has zero conflicts — pure auto-merge — is also applyable: `regionStates.length === 0` allowed; gate is `regionStates.every(…)`). On click/chord: `let text = bodyRef.current.resultText(); if (model.trailingNewline && text !== "" && !text.endsWith("\n")) text += "\n";` → `await saveResolution(repoId, path, text)` → `await advance()` (Task 3's advance already emits + loads next/closes). Errors: `console.error` + a red inline banner `<div role="alert">` at the footer with the message; do not close.
- Dirty tracking: `touched` = any region non-null OR editor doc differs from `model.initialResult`. Esc/⌘W with `touched` → `window.confirm("Discard this file's merge progress?")`; on confirm (or not touched) `getCurrentWindow().close()`.
- Footer: left side shortcut hints rendered with `formatChord` (`formatChord("Mod+1")` etc.), right side `Close` (PGButton variant ghost) + `Apply` (variant primary, icon "check", disabled per gate). Also a counter `resolved/total conflicts` (`data-testid="merge-conflict-counter"`, text like `2/3 resolved`).
- Chord dispatch: one `window.addEventListener("keydown", handler, true)` in a `useEffect`; `handler` builds `eventToChord(e)`, looks up a `Record<string, () => void>` built fresh each render via ref pattern (store latest closure in a ref; listener reads ref) — avoids stale state. On hit: `e.preventDefault(); e.stopPropagation()`. `Escape` only handled when the chooser/editor exists (always, effectively). CM has its own keymap — capture phase wins for our table; F7/⌘1-3/⌘↵ are not CM defaults anyway.

- [ ] **Step 1: Extend `MergeWindow.test.tsx` with failing tests:**

```tsx
function textSides(): ConflictSides {
  return {
    path: "conflict.txt",
    base: "base\n",
    ours: "ours change\n",
    theirs: "theirs change\n",
    binary: false,
  };
}

function chord(key: string, opts: KeyboardEventInit = {}) {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts }),
  );
}

describe("MergeWindow resolution flow", () => {
  async function setup(paths = ["conflict.txt"]) {
    setSearch("window=merge&repoId=r1&path=conflict.txt");
    mockInvoke("get_status", () => conflictedStatus(paths));
    mockInvoke("conflict_sides", () => textSides());
    mockInvoke("save_resolution", () => undefined);
    render(<MergeWindow />);
    await screen.findByTestId("merge-result");
  }

  it("Mod+2 accepts theirs and enables Apply", async () => {
    await setup();
    expect(screen.getByTestId("merge-apply")).toBeDisabled();
    chord("2", { metaKey: true, code: "Digit2" });
    await waitFor(() =>
      expect(screen.getByTestId("merge-conflict-counter")).toHaveTextContent("1/1"),
    );
    expect(screen.getByTestId("merge-apply")).toBeEnabled();
  });

  it("Apply saves resolution with trailing newline and closes on last file", async () => {
    await setup();
    chord("1", { metaKey: true, code: "Digit1" });
    await waitFor(() => expect(screen.getByTestId("merge-apply")).toBeEnabled());
    // Post-apply status: nothing conflicted anymore.
    mockInvoke("get_status", () => []);
    await userEvent.click(screen.getByTestId("merge-apply"));
    await waitFor(() => {
      const call = getInvokeCalls().find((c) => c.cmd === "save_resolution");
      expect(call).toBeDefined();
      expect(call!.args.content).toBe("ours change\n");
    });
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await waitFor(() =>
      expect(getCurrentWindow().close).toHaveBeenCalled(),
    );
  });

  it("auto-advances to the next conflicted file after Apply", async () => {
    await setup(["conflict.txt", "second.txt"]);
    chord("2", { metaKey: true, code: "Digit2" });
    await waitFor(() => expect(screen.getByTestId("merge-apply")).toBeEnabled());
    mockInvoke("get_status", () => conflictedStatus(["second.txt"]));
    mockInvoke("conflict_sides", () => ({ ...textSides(), path: "second.txt" }));
    await userEvent.click(screen.getByTestId("merge-apply"));
    await waitFor(() =>
      expect(screen.getByTestId("merge-file-path")).toHaveTextContent("second.txt"),
    );
  });

  it("Escape with progress asks for confirmation", async () => {
    await setup();
    chord("1", { metaKey: true, code: "Digit1" });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    chord("Escape");
    expect(confirmSpy).toHaveBeenCalled();
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    expect(getCurrentWindow().close).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
```

Add missing imports at the top of the test file (`vi`, `waitFor`, already-present helpers). Note the invoke-mock has no per-test window mock reset beyond `vi.clearAllMocks()` in setup — the `close` assertions rely on that per-test clearing.

Run: `pnpm vitest run src/features/merge/MergeWindow.test.tsx` — Expected: new tests FAIL.

- [ ] **Step 2: Implement** in `MergeWindow.tsx`: chord table + footer + apply/advance/close per the behavior block. Keyboard effect pattern:

```tsx
  const actions = React.useRef<Record<string, () => void>>({});
  actions.current = {
    F7: () => moveConflict(1),
    "Shift+F7": () => moveConflict(-1),
    "Mod+1": () => acceptCurrent("ours"),
    "Mod+2": () => acceptCurrent("theirs"),
    "Mod+3": () => acceptCurrent("both"),
    "Mod+Enter": () => void applyFile(),
    "Mod+W": () => void requestClose(),
    Escape: () => void requestClose(),
  };
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const chord = eventToChord(e);
      const fn = chord ? actions.current[chord] : undefined;
      if (fn) {
        e.preventDefault();
        e.stopPropagation();
        fn();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
```

- [ ] **Step 3: Run all merge tests + suite**

Run: `pnpm vitest run src/features/merge/ && pnpm test && pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/merge/MergeWindow.tsx src/features/merge/MergeWindow.test.tsx \
  src/features/merge/MergeBody.tsx
git commit -m "feat(merge): resolver chords, apply gating, auto-advance, dirty-close confirm

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Launch points + main-window refresh

**Files:**
- Modify: `src/screens/Conflict.tsx`
- Modify: `src/design/git-components.tsx` (`PGConflictRow`: add `onDoubleClick`)
- Modify: `src/design/context-menu.tsx` (`conflictMenuItems`: add "Open merge editor")
- Modify: `src/AppShell.tsx` (listen `merge://resolved` → `refreshAll`)
- Test: `src/screens/Conflict.launcher.test.tsx` (new)

**Interfaces:**
- Consumes: `openMergeWindow(repoId, path)` (Task 3).
- Produces: DOM hooks `data-testid="open-merge-editor"` (detail action-bar button). Row double-click and list-pane Enter (`usePaneList onActivate`) both open the window.

- [ ] **Step 1: Failing test** — `src/screens/Conflict.launcher.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConflictScreen } from "./Conflict";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { mockInvoke } from "@/test/invokeMock";

vi.mock("@/features/merge/openMergeWindow", () => ({
  openMergeWindow: vi.fn().mockResolvedValue(undefined),
}));
import { openMergeWindow } from "@/features/merge/openMergeWindow";

describe("Conflict screen merge-window launchers", () => {
  beforeEach(() => {
    mockInvoke("conflict_sides", () => ({
      path: "conflict.txt", base: "b\n", ours: "o\n", theirs: "t\n", binary: false,
    }));
    useRepoStore.setState({
      current: { id: "r1", path: "/tmp/r1", name: "r1" } as never,
      repoState: "Merge",
      status: [
        {
          path: "conflict.txt",
          index: { kind: "Conflicted" },
          worktree: { kind: "Conflicted" },
        },
      ] as never,
    });
  });

  it("action-bar button opens the merge window", async () => {
    render(<ConflictScreen />);
    await userEvent.click(await screen.findByTestId("open-merge-editor"));
    expect(openMergeWindow).toHaveBeenCalledWith("r1", "conflict.txt");
  });

  it("double-clicking a conflict row opens the merge window", async () => {
    render(<ConflictScreen />);
    await userEvent.dblClick(await screen.findByTestId("conflict-row"));
    await waitFor(() => expect(openMergeWindow).toHaveBeenCalledWith("r1", "conflict.txt"));
  });
});
```

Match `useRepoStore.setState` field names to the real store (`current`, `status`, `repoState` — check `useRepoStore.ts` initial-state block; also seed whatever else ConflictScreen selects, e.g. `branches: []`). Run to verify FAIL (no testid / no double-click handling).

- [ ] **Step 2: Implement.**

`src/design/git-components.tsx` — `PGConflictRowProps` gains `onDoubleClick?: () => void;`; destructure and spread onto the root `<div>` (`onDoubleClick={onDoubleClick}` next to `onClick`).

`src/screens/Conflict.tsx`:
- `import { openMergeWindow } from "@/features/merge/openMergeWindow";`
- In `ConflictScreen`, add to `usePaneList({ … })`: `onActivate: (i) => { const c = conflicts[i]; const repoId = useRepoStore.getState().current?.id; if (c && repoId) void openMergeWindow(repoId, c.path); },`
- On each `PGConflictRow`: `onDoubleClick={() => { const repoId = useRepoStore.getState().current?.id; if (repoId) void openMergeWindow(repoId, c.path); }}`
- In `ConflictDetail`'s action bar, insert as FIRST button (primary position, before "Accept ours"):

```tsx
            <PGButton
              size="sm"
              variant="primary"
              icon="merge"
              data-testid="open-merge-editor"
              onClick={() => {
                if (repoId) void openMergeWindow(repoId, path);
              }}
            >
              Open merge editor
            </PGButton>
```

and demote the existing "Mark worktree as resolved" button to `variant="outline"` (one primary per bar).

`src/design/context-menu.tsx` — in `conflictMenuItems`, after the "Accept theirs" item insert:

```ts
    {
      icon: "merge",
      label: "Open merge editor",
      onClick: () => {
        const repoId = useRepoStore.getState().current?.id;
        if (repoId && conflict?.path) void openMergeWindow(repoId, conflict.path);
      },
    },
```

with `import { openMergeWindow } from "@/features/merge/openMergeWindow";` at the top.

`src/AppShell.tsx` — after the keymap listener effect (line ~138):

```tsx
  // The merge resolver window stages resolutions out-of-band; reflect them.
  React.useEffect(() => {
    const un = listen("merge://resolved", () => {
      void useRepoStore.getState().refreshAll();
    });
    return () => {
      un.then((f) => f());
    };
  }, []);
```

with `import { listen } from "@tauri-apps/api/event";`.

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run src/screens/Conflict.launcher.test.tsx && pnpm test && pnpm tsc --noEmit`
Expected: PASS all.

- [ ] **Step 4: Commit**

```bash
git add src/screens/Conflict.tsx src/design/git-components.tsx src/design/context-menu.tsx \
  src/AppShell.tsx src/screens/Conflict.launcher.test.tsx
git commit -m "feat(conflict): launch merge resolver window from screen, rows, context menu

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: e2e — resolver window flow

**Files:**
- Modify: `e2e/support/tempRepo.ts` (add `conflictRepoTwoFiles`)
- Create: `e2e/specs/merge-window.e2e.ts`

**Interfaces:**
- Consumes: `browser.tauri.switchWindow(label)` (used in `wdio.conf.ts:48`), `armDriverBridge`, `ensureMacAppFocus`, `jsChord`, `openRepo`, `resetApp` from `e2e/support/app.ts`; `conflictRepo` fixture; helpers `mergeBranchViaPicker`/`startConflictedMerge` patterns from `e2e/specs/merge-conflict.e2e.ts` (copy locally, don't import across spec files).
- Produces: e2e coverage: window opens, chevron + chord resolution, apply, auto-advance, finalize, porcelain truth.

- [ ] **Step 0: MANDATORY — read `.claude/skills/e2e-testing/SKILL.md` in full before writing any spec code.** Selector conventions, driver-bridge re-arm rules, dialog stubbing, rebuild discipline all live there.

- [ ] **Step 1: Fixture** — append to `e2e/support/tempRepo.ts` next to `conflictRepo`:

```ts
export function conflictRepoTwoFiles(): TempRepo {
  const r = new TempRepo();
  r.commitFile("alpha.txt", "base a\n", "feat: base alpha");
  r.commitFile("beta.txt", "base b\n", "feat: base beta");
  r.git("checkout", "-b", "clash");
  r.commitFile("alpha.txt", "theirs a\n", "feat: clash alpha");
  r.commitFile("beta.txt", "theirs b\n", "feat: clash beta");
  r.git("checkout", "main");
  r.commitFile("alpha.txt", "ours a\n", "feat: main alpha");
  r.commitFile("beta.txt", "ours b\n", "feat: main beta");
  return r; // merging clash into main conflicts on both files
}
```

- [ ] **Step 2: Spec** — `e2e/specs/merge-window.e2e.ts`. Flow per test (helpers copied from `merge-conflict.e2e.ts` — keep their confirm-stub and waitRepoLoaded usage identical):

```ts
// Merge resolver window (docs/superpowers/specs/2026-07-07-merge-resolver-window-design.md):
// second Tauri window, per-conflict accepts, apply + auto-advance, finalize.

import { browser, $, expect } from "@wdio/globals";
import { conflictRepo, conflictRepoTwoFiles, type TempRepo } from "../support/tempRepo";
import { armDriverBridge, ensureMacAppFocus, jsChord, openRepo, resetApp } from "../support/app";

// …copy mergeBranchViaPicker + startConflictedMerge helpers from merge-conflict.e2e.ts…

async function switchToMergeWindow(): Promise<void> {
  await browser.waitUntil(
    async () => {
      try {
        await browser.tauri.switchWindow("merge");
        return true;
      } catch {
        return false;
      }
    },
    { timeout: 15_000, timeoutMsg: "merge window never became switchable" },
  );
  await armDriverBridge();          // new document — re-arm the driver bridge
  await ensureMacAppFocus();
  await $('[data-testid="merge-window"]').waitForDisplayed({ timeout: 10_000 });
}

async function switchToMainWindow(): Promise<void> {
  await browser.tauri.switchWindow("main");
  await armDriverBridge();
}

describe("merge resolver window", () => {
  let repo: TempRepo | null = null;

  afterEach(async () => {
    // If a merge window is still open, close it so resetApp sees main.
    // window.close() does NOT close a Tauri window — go through the Tauri API
    // (withGlobalTauri is on in the e2e build).
    try {
      await browser.tauri.switchWindow("merge");
      await browser.execute(() => {
        const w = window as unknown as Record<string, any>;
        void w.__TAURI__?.window?.getCurrentWindow?.().close();
      });
    } catch {
      /* no merge window — fine */
    }
    await switchToMainWindow();
    await resetApp();
    repo?.dispose();
    repo = null;
  });

  it("resolves a single-file conflict via the window and finalizes", async () => {
    repo = conflictRepo();
    await startConflictedMerge(repo);                       // copied helper
    await $('[data-testid="conflict-row"]').click();
    await $('[data-testid="open-merge-editor"]').click();

    await switchToMergeWindow();
    await expect($('[data-testid="merge-file-path"]')).toHaveText(
      expect.stringContaining("conflict.txt"),
    );
    // Keyboard accept: ⌘2/Ctrl+2 = take theirs.
    await jsChord("Mod+2");
    await browser.waitUntil(
      async () => (await $('[data-testid="merge-apply"]').isEnabled()),
      { timeout: 10_000, timeoutMsg: "Apply never enabled after accept chord" },
    );
    await $('[data-testid="merge-apply"]').click();
    // Last conflicted file → the window closes itself.

    await switchToMainWindow();
    await browser.waitUntil(
      async () => (await $('[data-testid="conflict-finalize"]').isEnabled()),
      { timeout: 10_000, timeoutMsg: "Finalize never enabled after window apply" },
    );
    await $('[data-testid="conflict-finalize"]').click();
    await $("h3*=No conflicts").waitForDisplayed({ timeout: 10_000 });
    expect(repo.readFile("conflict.txt")).toBe("theirs change\n");
    expect(repo.porcelain()).toBe("");
  });

  it("auto-advances to the second conflicted file after Apply", async () => {
    repo = conflictRepoTwoFiles();
    await startConflictedMerge(repo);
    await $('[data-testid="conflict-row"]').click();
    await $('[data-testid="open-merge-editor"]').click();

    await switchToMergeWindow();
    const firstPath = await $('[data-testid="merge-file-path"]').getText();
    // Chevron path this time (mouse parity with the chord path).
    await $('[data-testid="accept-chevron-ours-0"]').click();
    await $('[data-testid="merge-apply"]').click();
    await browser.waitUntil(
      async () =>
        (await $('[data-testid="merge-file-path"]').getText()) !== firstPath,
      { timeout: 10_000, timeoutMsg: "window never advanced to the next file" },
    );
    // Resolve the second file too; window closes.
    await jsChord("Mod+1");
    await browser.waitUntil(
      async () => (await $('[data-testid="merge-apply"]').isEnabled()),
      { timeout: 10_000 },
    );
    await $('[data-testid="merge-apply"]').click();

    await switchToMainWindow();
    await browser.waitUntil(
      async () => (await $('[data-testid="conflict-finalize"]').isEnabled()),
      { timeout: 10_000 },
    );
    expect(repo.readFile("alpha.txt")).toBe("ours a\n");
    expect(repo.readFile("beta.txt")).toBe("ours b\n");
  });
});
```

Adapt helper names to what `merge-conflict.e2e.ts` actually exposes (`repo.readFile`/`repo.porcelain` — confirm exact TempRepo method names in `e2e/support/tempRepo.ts` and mirror the porcelain/read assertions used there, e.g. their `git("status", "--porcelain")` calls). If `switchWindow("merge")` proves unsupported by the embedded driver (spike = the first `switchToMergeWindow` call), FALLBACK per spec: keep the launch assertions in the main window only (`open-merge-editor` click → poll `WebviewWindow.getByLabel("merge")` via `browser.execute` on the main window's `__TAURI__` global returning non-null), skip the in-window steps with a `console.warn`, and note the limitation in the spec file header comment. Component tests already cover the resolution flow.

- [ ] **Step 3: Typecheck + full e2e build & run** (src/ and src-tauri/ changed since the last snapshot — full rebuild is REQUIRED; also make sure no `pnpm tauri dev` instance is running):

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm exec tsc -p e2e/tsconfig.json --noEmit && pnpm test:e2e`
Expected: e2e tsc clean; all 14+1 spec files pass (52 tests: 50 existing + 2 new). Budget: build ~2–4 min + suite run. Debug flaky window-switch timing with the e2e-testing skill's debugging flow before touching product code.

- [ ] **Step 4: Commit**

```bash
git add e2e/support/tempRepo.ts e2e/specs/merge-window.e2e.ts
git commit -m "test(e2e): merge resolver window — chord/chevron resolve, auto-advance, finalize

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Docs + full verification

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-07-07-merge-resolver-window-design.md` (only if reality diverged further — record actual deviations)

- [ ] **Step 1: Update `CLAUDE.md`:**
- Architecture → backend `commands/` listing: add `save_resolution` to the `conflict.rs` line.
- Architecture → frontend tree: add under `features/`:
  ```
  ├── merge/           Merge resolver window (second Tauri window, label "merge"):
  │                    mergeModel (diff3 chunking), resultEditor (CM6),
  │                    MergeWindow/MergeBody/SidePane, openMergeWindow.
  │                    Routed via ?window=merge in main.tsx.
  ```
- Permissions section: update the "Current set" list to include `core:window:allow-set-title`, `core:webview:allow-create-webview-window` and note `windows: ["main", "merge"]`.
- Testing → e2e bullet: bump spec-file/test counts (15 files, 52 tests — use real numbers from the Task 8 run).
- Recent specs list: add `2026-07-07-merge-resolver-window-*` line at the top.

- [ ] **Step 2: Full verification gates, in order:**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit
pnpm exec tsc -p e2e/tsconfig.json --noEmit
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
pnpm vite build
# e2e already green from Task 8; re-run only if any code changed since:
# pnpm test:e2e
```
Expected: everything green. Fix regressions before committing.

- [ ] **Step 3: Manual verification (real app):** `pnpm tauri dev`, create a throwaway conflicted repo (`conflictRepo` recipe by hand or reuse an existing one), merge, open resolver: verify window opens on the right file, F7/⇧F7 hop conflicts, ⌘1/⌘2/⌘3 accept, hand-edit marks manual, Apply advances and finally closes, main window Finalize lights up without manual refresh, Esc mid-progress confirms. Close the dev instance afterwards.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-07-07-merge-resolver-window-design.md
git commit -m "docs: merge resolver window — CLAUDE.md architecture + counts

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Then follow superpowers:finishing-a-development-branch (rebase onto latest `origin/main`, squash locally per repo convention, PR, squash-merge).
