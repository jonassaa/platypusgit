# UX Polish Batch 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five usability fixes: chunked diff rendering, recent-repos persistence on landing, scoped right-click (no browser menu fallthrough), expandable folders + arrow-key nav in file tree, and app-wide unselectable text.

**Architecture:** All changes are frontend-only (TS/React). Zustand for recents persistence via localStorage. A module-level global `contextmenu` listener mounted from `AppShell` prevents the native browser menu unless a custom menu stops propagation. The file tree gets keyboard/focus support inside the existing `PGFileTree` component (re-used by `RepoBrowserScreen`). The diff renderer in `PGHunk` is replaced with a chunking pass that groups consecutive same-kind lines before rendering.

**Tech Stack:** React 18, TypeScript, Zustand, Tauri 2 (no backend changes needed).

---

## File Structure

**New files**
- `src/lib/recents.ts` — pure helpers: load/save/push a list of recent repo paths into localStorage, de-duplicated and bounded.
- `src/features/repo/useRecentsStore.ts` — Zustand store wrapping the helpers, exposing `recents`, `addRecent`, `removeRecent`, `clearRecents`.
- `src/design/use-prevent-browser-context-menu.ts` — React hook that attaches a document-level `contextmenu` listener which calls `preventDefault()` during the bubble phase; any custom handler that runs `stopPropagation()` first will pre-empt it.

**Modified files**
- `src/design/git-components.tsx` — (a) add chunking pass inside `PGHunk` so consecutive same-kind diff lines render as a single visual block; (b) make `PGFileTree` a focus-receiving widget that supports Up/Down/Left/Right/Enter keyboard navigation and returns the active key via a new callback; (c) make a folder-row click toggle expansion (folder click no longer only selects).
- `src/design/context-menu.tsx` — export a no-op `{}` fallback for `useContextMenu` is unchanged; already stops propagation. No edits needed unless chunking reveals bugs.
- `src/screens/Welcome.tsx` — render the recents list below the "Open repository…" button when non-empty; click a row to re-open; include a per-row "remove" affordance.
- `src/screens/RepoBrowser.tsx` — pass `onActivate` to `PGFileTree` so `Enter` on a file triggers the selection (which already drives the diff preview). Keep current click semantics for files.
- `src/AppShell.tsx` — mount the prevent-browser-context-menu hook once; on app mount, push the opened repo path into the recents store via a `useEffect` watching `useRepoStore`.
- `src/features/repo/useRepoStore.ts` — after a successful `openRepo`, also call `useRecentsStore.getState().addRecent(path)` so recents update automatically.
- `src/index.css` — add global `user-select: none` on `body` plus explicit override for `input`, `textarea`, and elements marked `.pg-selectable` (for e.g. SHA/copy surfaces we want selectable later; not used yet but defined now to keep the option cheap).

---

### Task 1: Recents store — pure helpers

**Files:**
- Create: `src/lib/recents.ts`

- [ ] **Step 1: Implement the helpers**

Write the full file `src/lib/recents.ts`:

```ts
const KEY = "pg-recent-repos";
const LIMIT = 10;

export interface RecentRepo {
  path: string;
  /** unix ms */
  openedAt: number;
}

export function loadRecents(): RecentRepo[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (r): r is RecentRepo =>
          r && typeof r.path === "string" && typeof r.openedAt === "number",
      )
      .slice(0, LIMIT);
  } catch {
    return [];
  }
}

export function saveRecents(list: RecentRepo[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, LIMIT)));
  } catch {
    // quota errors are non-fatal
  }
}

export function pushRecent(list: RecentRepo[], path: string): RecentRepo[] {
  const now = Date.now();
  const filtered = list.filter((r) => r.path !== path);
  return [{ path, openedAt: now }, ...filtered].slice(0, LIMIT);
}

export function removeRecent(list: RecentRepo[], path: string): RecentRepo[] {
  return list.filter((r) => r.path !== path);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/recents.ts
git commit -m "feat(recents): storage helpers for recent repos"
```

---

### Task 2: Recents Zustand store

**Files:**
- Create: `src/features/repo/useRecentsStore.ts`

- [ ] **Step 1: Implement the store**

Write the full file `src/features/repo/useRecentsStore.ts`:

```ts
import { create } from "zustand";
import {
  loadRecents,
  pushRecent,
  removeRecent,
  saveRecents,
  type RecentRepo,
} from "@/lib/recents";

interface RecentsState {
  recents: RecentRepo[];
  addRecent: (path: string) => void;
  removeRecent: (path: string) => void;
  clearRecents: () => void;
}

export const useRecentsStore = create<RecentsState>((set, get) => ({
  recents: loadRecents(),
  addRecent(path) {
    const next = pushRecent(get().recents, path);
    saveRecents(next);
    set({ recents: next });
  },
  removeRecent(path) {
    const next = removeRecent(get().recents, path);
    saveRecents(next);
    set({ recents: next });
  },
  clearRecents() {
    saveRecents([]);
    set({ recents: [] });
  },
}));
```

- [ ] **Step 2: Commit**

```bash
git add src/features/repo/useRecentsStore.ts
git commit -m "feat(recents): zustand store for recent repos"
```

---

### Task 3: Hook repo open → recents

**Files:**
- Modify: `src/features/repo/useRepoStore.ts`

- [ ] **Step 1: Import the recents store**

In `src/features/repo/useRepoStore.ts`, add this import near the other `@/` imports (keep imports grouped):

```ts
import { useRecentsStore } from "./useRecentsStore";
```

- [ ] **Step 2: Call `addRecent` on successful open**

Inside `openRepo`, after `const handle = await openRepo(path);` and before the `set({ current: handle, ... })` block, add:

```ts
useRecentsStore.getState().addRecent(handle.path);
```

Use `handle.path` (not the raw `path` arg) so we store the canonical backend-resolved path.

- [ ] **Step 3: Type-check**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/features/repo/useRepoStore.ts
git commit -m "feat(recents): record opened repos in recents store"
```

---

### Task 4: Welcome screen — render recents list

**Files:**
- Modify: `src/screens/Welcome.tsx`

- [ ] **Step 1: Replace the file**

Overwrite `src/screens/Welcome.tsx` with the following. The existing layout/card is preserved; a recents list renders underneath when `recents.length > 0`:

```tsx
import { open } from "@tauri-apps/plugin-dialog";
import { PGButton, PGIcon, PGIconButton, PGSpinner } from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useRecentsStore } from "@/features/repo/useRecentsStore";

export function WelcomeScreen() {
  const openRepo = useRepoStore((s) => s.openRepo);
  const loading = useRepoStore((s) => s.loading);
  const recents = useRecentsStore((s) => s.recents);
  const removeRecent = useRecentsStore((s) => s.removeRecent);

  async function handleOpen() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Open repository",
    });
    if (typeof selected === "string") {
      await openRepo(selected);
    }
  }

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 40,
        background: "var(--bg-0)",
      }}
    >
      <div
        style={{
          maxWidth: 520,
          width: "100%",
          padding: 32,
          background: "var(--bg-1)",
          border: "1px solid var(--border-0)",
          borderRadius: "var(--r-5)",
          boxShadow: "var(--shadow-2)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: "var(--r-4)",
            background: "oklch(0.72 0.15 235 / 0.12)",
            border: "1px solid oklch(0.72 0.15 235 / 0.35)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--accent)",
          }}
        >
          <PGIcon name="repo" size={28} />
        </div>
        <div>
          <div
            style={{
              fontSize: "var(--fs-17)",
              fontWeight: 600,
              color: "var(--fg-0)",
              marginBottom: 4,
            }}
          >
            Welcome to PlatypusGit
          </div>
          <div style={{ fontSize: "var(--fs-13)", color: "var(--fg-2)" }}>
            Open a local repository to get started.
          </div>
        </div>
        <PGButton
          variant="primary"
          icon="folder"
          onClick={handleOpen}
          disabled={loading}
        >
          {loading ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <PGSpinner size={12} /> Opening…
            </span>
          ) : (
            "Open repository…"
          )}
        </PGButton>
        <div
          style={{
            fontSize: "var(--fs-11)",
            color: "var(--fg-3)",
            fontFamily: "var(--font-mono)",
            marginTop: 4,
          }}
        >
          Pick any directory containing a{" "}
          <span style={{ color: "var(--fg-1)" }}>.git</span> folder.
        </div>

        {recents.length > 0 && (
          <div
            style={{
              width: "100%",
              marginTop: 18,
              paddingTop: 14,
              borderTop: "1px solid var(--border-0)",
              textAlign: "left",
            }}
          >
            <div
              style={{
                fontSize: "var(--fs-10)",
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--fg-3)",
                marginBottom: 8,
                paddingLeft: 4,
              }}
            >
              Recent
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {recents.map((r) => {
                const name = r.path.split("/").filter(Boolean).pop() ?? r.path;
                return (
                  <div
                    key={r.path}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 8px",
                      borderRadius: "var(--r-3)",
                      cursor: loading ? "default" : "pointer",
                      fontSize: "var(--fs-12)",
                      color: "var(--fg-0)",
                    }}
                    onClick={() => {
                      if (!loading) openRepo(r.path);
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "var(--bg-2)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    <PGIcon
                      name="repo"
                      size={12}
                      style={{ color: "var(--accent)" }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {name}
                      </div>
                      <div
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: "var(--fs-10)",
                          color: "var(--fg-3)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          direction: "rtl",
                          textAlign: "left",
                        }}
                        title={r.path}
                      >
                        {r.path}
                      </div>
                    </div>
                    <PGIconButton
                      icon="x"
                      size="sm"
                      title="Remove from recents"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeRecent(r.path);
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify `PGIconButton` accepts an onClick that receives an event**

Check `src/design/primitives.tsx` to confirm `PGIconButton` forwards `onClick`. If it types the handler as `() => void`, cast: `onClick={(e) => { (e as unknown as React.MouseEvent).stopPropagation(); removeRecent(r.path); }}`. Otherwise leave as written.

Run:

```bash
grep -n "PGIconButton" src/design/primitives.tsx | head -5
```

Look at the matched line for the type of `onClick`. If it is `() => void`, adjust the welcome screen handler:

```tsx
onClick={() => removeRecent(r.path)}
```

…and wrap the row click to skip when the target is inside the icon button by checking `(e.target as HTMLElement).closest("button")`:

```tsx
onClick={(e) => {
  if ((e.target as HTMLElement).closest("button")) return;
  if (!loading) openRepo(r.path);
}}
```

- [ ] **Step 3: Type-check**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/screens/Welcome.tsx
git commit -m "feat(welcome): surface recent repos on landing screen"
```

---

### Task 5: Global — suppress browser context menu

**Files:**
- Create: `src/design/use-prevent-browser-context-menu.ts`
- Modify: `src/design/index.ts`
- Modify: `src/AppShell.tsx`

- [ ] **Step 1: Write the hook**

Create `src/design/use-prevent-browser-context-menu.ts`:

```ts
import { useEffect } from "react";

/**
 * Attach a document-level contextmenu listener that swallows the native
 * browser menu. Custom menu handlers mounted on specific elements must call
 * `e.stopPropagation()` (as `useContextMenu` already does) — bubble-phase
 * ordering means those run first and this handler never sees the event.
 */
export function usePreventBrowserContextMenu() {
  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      e.preventDefault();
    };
    document.addEventListener("contextmenu", onCtx);
    return () => document.removeEventListener("contextmenu", onCtx);
  }, []);
}
```

- [ ] **Step 2: Export from design index**

Append to `src/design/index.ts`:

```ts
export * from "./use-prevent-browser-context-menu";
```

- [ ] **Step 3: Mount the hook in `AppShell`**

In `src/AppShell.tsx`, add to the import from `@/design`:

```ts
  usePreventBrowserContextMenu,
```

…and inside `export function AppShell()` as the first line of the body, call:

```ts
  usePreventBrowserContextMenu();
```

- [ ] **Step 4: Manual smoke (headless confirmation only)**

Type-check:

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit
```

Expected: no errors.

Visual verification (note in commit message this was not runtime-verified if `pnpm tauri dev` is not started):

- Right-click anywhere outside a registered menu target → nothing appears (native menu suppressed).
- Right-click on a commit row in History → custom menu appears.

- [ ] **Step 5: Commit**

```bash
git add src/design/use-prevent-browser-context-menu.ts src/design/index.ts src/AppShell.tsx
git commit -m "feat(ui): suppress native browser context menu globally"
```

---

### Task 6: File tree — folder click toggles, keyboard nav, activation callback

**Files:**
- Modify: `src/design/git-components.tsx`
- Modify: `src/screens/RepoBrowser.tsx`

The `PGFileTree` component currently only supports click-to-select plus chevron-to-toggle. We need:
1. Clicking a folder row toggles its expansion (and still selects it).
2. The tree can take focus and support Up/Down/Left/Right/Enter keyboard navigation.
3. A new `onActivate(key, node)` callback fires on Enter or double-click; on a folder it toggles expansion, on a file it calls the callback.

**Design:**
- Add a `tabIndex={0}` wrapper around the tree and attach `onKeyDown`.
- Flatten the visible node list (respecting current expansion) to resolve Up/Down/Left/Right.
- Track the "active" key as the `selected` prop (controlled) — we already have that.
- On folder row click, call both `onSelect` and `onToggle` (caller decides).
  - Simpler: fire `onSelect` always; fire `onToggle` only when `kind === "folder"`. Handled inside `PGFileTree`, not `PGFileTreeRow`.

- [ ] **Step 1: Replace `PGFileTree` with keyboard + folder-click behavior**

In `src/design/git-components.tsx`, replace the current `PGFileTree` definition (starting at `export interface PGFileTreeProps` and including the component body through the end of its return) with:

```tsx
export interface PGFileTreeProps {
  nodes: PGFileTreeNode[];
  expanded?: Record<string, boolean>;
  onToggle?: (key: string) => void;
  selected?: string;
  onSelect?: (key: string, node: PGFileTreeNode) => void;
  /** Fired on Enter or double-click. For folders, toggles; for files, caller decides. */
  onActivate?: (key: string, node: PGFileTreeNode) => void;
  showStatus?: boolean;
}

interface FlatNode {
  key: string;
  node: PGFileTreeNode;
  indent: number;
  hasChildren: boolean;
  isExpanded: boolean;
}

function flattenTree(
  nodes: PGFileTreeNode[],
  expanded: Record<string, boolean>,
): FlatNode[] {
  const out: FlatNode[] = [];
  const walk = (list: PGFileTreeNode[], indent: number, parentKey: string) => {
    for (const node of list) {
      const key = parentKey + "/" + node.name;
      const hasChildren = !!node.children && node.children.length > 0;
      const isExpanded =
        expanded[key] !== undefined ? expanded[key] : !!node.defaultExpanded;
      out.push({ key, node, indent, hasChildren, isExpanded });
      if (hasChildren && isExpanded) walk(node.children!, indent + 1, key);
    }
  };
  walk(nodes, 0, "");
  return out;
}

export function PGFileTree({
  nodes,
  expanded = {},
  onToggle,
  selected,
  onSelect,
  onActivate,
  showStatus = true,
}: PGFileTreeProps) {
  const flat = flattenTree(nodes, expanded);
  const selectedIdx = selected
    ? flat.findIndex((f) => f.key === selected)
    : -1;

  const focus = (idx: number) => {
    const n = flat[idx];
    if (!n) return;
    onSelect?.(n.key, n.node);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (flat.length === 0) return;
    const cur = selectedIdx >= 0 ? selectedIdx : 0;
    const node = flat[cur];
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focus(Math.min(cur + 1, flat.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        focus(Math.max(cur - 1, 0));
        break;
      case "ArrowRight":
        e.preventDefault();
        if (node?.hasChildren) {
          if (!node.isExpanded) onToggle?.(node.key);
          else focus(Math.min(cur + 1, flat.length - 1));
        }
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (node?.hasChildren && node.isExpanded) {
          onToggle?.(node.key);
        } else {
          // move to parent if any
          const parentKey = node?.key
            .split("/")
            .slice(0, -1)
            .join("/");
          const parentIdx = flat.findIndex((f) => f.key === parentKey);
          if (parentIdx >= 0) focus(parentIdx);
        }
        break;
      case "Enter":
        e.preventDefault();
        if (node) {
          if (node.hasChildren) {
            onToggle?.(node.key);
          } else {
            onActivate?.(node.key, node.node);
          }
        }
        break;
    }
  };

  return (
    <div
      tabIndex={0}
      onKeyDown={handleKey}
      style={{ outline: "none" }}
      className="focusable"
    >
      {flat.map((f) => (
        <PGFileTreeRow
          key={f.key}
          name={f.node.name}
          indent={f.indent}
          kind={f.hasChildren ? "folder" : "file"}
          status={f.node.status}
          hideStatus={!showStatus}
          expanded={f.isExpanded}
          hasChildren={f.hasChildren}
          selected={selected === f.key}
          onClick={() => {
            onSelect?.(f.key, f.node);
            if (f.hasChildren) onToggle?.(f.key);
          }}
          onToggle={() => onToggle?.(f.key)}
          extra={f.node.extra}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Remove the chevron's duplicate toggle when folder click also toggles**

In `PGFileTreeRow`, the chevron span already calls `onToggle` with `stopPropagation`. Keep it — chevron keeps working, row-click additionally toggles folders (because the wrapping row click handler runs when the chevron wasn't the click target). No edit needed.

Verify by reading `PGFileTreeRow`:

```bash
grep -n "stopPropagation" src/design/git-components.tsx | head
```

Expected: line inside the chevron onClick — confirmed.

- [ ] **Step 3: Wire `onActivate` in `RepoBrowserScreen`**

In `src/screens/RepoBrowser.tsx`, modify the `<PGFileTree>` usage to pass `onActivate` that, for files, is a no-op (selection already triggers the diff). Replace the current `<PGFileTree … />` JSX with:

```tsx
<PGFileTree
  nodes={tree}
  expanded={expanded}
  onToggle={(k) =>
    setExpanded((e) => ({ ...e, [k]: !e[k] }))
  }
  selected={selected ?? undefined}
  onSelect={(k) => setSelected(k)}
  onActivate={(k) => setSelected(k)}
/>
```

(Selection already drives the diff-preview effect — Enter therefore "opens" the file in the preview.)

- [ ] **Step 4: Type-check**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/design/git-components.tsx src/screens/RepoBrowser.tsx
git commit -m "feat(filetree): folder-click expand, keyboard nav, activate"
```

---

### Task 7: Diff hunks — chunked rendering

**Files:**
- Modify: `src/design/git-components.tsx`

Goal: inside a `PGHunk`, group consecutive same-kind `DiffLineData` rows into a single visual block: one background for the whole additions run, one for the whole deletions run. Context blocks render the same as today but also as one block.

- [ ] **Step 1: Add a chunking helper above `PGHunk`**

In `src/design/git-components.tsx`, immediately before `export interface PGHunkProps`, insert:

```tsx
interface DiffChunk {
  kind: DiffLineKind;
  lines: DiffLineData[];
}

function chunkDiffLines(lines: DiffLineData[]): DiffChunk[] {
  const chunks: DiffChunk[] = [];
  for (const ln of lines) {
    const last = chunks[chunks.length - 1];
    if (last && last.kind === ln.kind) {
      last.lines.push(ln);
    } else {
      chunks.push({ kind: ln.kind, lines: [ln] });
    }
  }
  return chunks;
}

function PGDiffChunk({ chunk }: { chunk: DiffChunk }) {
  const { kind, lines } = chunk;
  const bg: Partial<Record<DiffLineKind, string>> = {
    add: "var(--git-added-bg)",
    rem: "var(--git-removed-bg)",
    hunk: "oklch(0.72 0.15 235 / 0.1)",
    info: "var(--bg-2)",
  };
  const borderColor: Partial<Record<DiffLineKind, string>> = {
    add: "var(--git-added-gutter)",
    rem: "var(--git-removed-gutter)",
  };
  const marker: Record<DiffLineKind, string> = {
    add: "+",
    rem: "−",
    ctx: " ",
    hunk: "@",
    info: "i",
    empty: "",
  };
  const textColor: Record<DiffLineKind, string> = {
    ctx: "var(--fg-0)",
    add: "var(--git-added)",
    rem: "var(--git-removed)",
    hunk: "var(--accent)",
    info: "var(--fg-2)",
    empty: "var(--fg-3)",
  };

  if (kind === "hunk" || kind === "info") {
    return (
      <>
        {lines.map((ln, i) => (
          <PGDiffLine key={i} {...ln} />
        ))}
      </>
    );
  }

  return (
    <div
      style={{
        background: bg[kind] ?? "transparent",
        borderLeft:
          borderColor[kind] !== undefined
            ? `2px solid ${borderColor[kind]}`
            : "2px solid transparent",
      }}
    >
      {lines.map((ln, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-12)",
            lineHeight: "var(--lh-code)",
            minHeight: 18,
          }}
        >
          <span
            style={{
              width: 40,
              flexShrink: 0,
              textAlign: "right",
              paddingRight: 6,
              color: "var(--fg-3)",
              userSelect: "none",
              borderRight: "1px solid var(--border-0)",
              background: "var(--bg-1)",
            }}
          >
            {ln.lnL ?? ""}
          </span>
          <span
            style={{
              width: 40,
              flexShrink: 0,
              textAlign: "right",
              paddingRight: 6,
              color: "var(--fg-3)",
              userSelect: "none",
              borderRight: "1px solid var(--border-0)",
              background: "var(--bg-1)",
            }}
          >
            {ln.lnR ?? ""}
          </span>
          <span
            style={{
              width: 20,
              flexShrink: 0,
              textAlign: "center",
              color: textColor[kind],
              userSelect: "none",
            }}
          >
            {marker[kind]}
          </span>
          <span
            style={{
              flex: 1,
              whiteSpace: "pre-wrap",
              color: kind === "ctx" ? "var(--fg-0)" : textColor[kind],
              paddingRight: 10,
            }}
          >
            {ln.text}
          </span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Use `chunkDiffLines` inside `PGHunk`**

Locate the `PGHunk` component body. Replace the current lines-render block:

```tsx
      {expanded && (
        <div>
          {lines.map((ln, i) => (
            <PGDiffLine key={i} {...ln} />
          ))}
        </div>
      )}
```

…with:

```tsx
      {expanded && (
        <div>
          {chunkDiffLines(lines).map((c, i) => (
            <PGDiffChunk key={i} chunk={c} />
          ))}
        </div>
      )}
```

- [ ] **Step 3: Type-check**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/design/git-components.tsx
git commit -m "feat(diff): render consecutive same-kind lines as chunks"
```

---

### Task 8: Global — disable text selection

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1: Add the rules**

Open `src/index.css` and replace the `body { … }` rule (currently starting at `body {` near `margin: 0;`) with:

```css
body {
  margin: 0;
  padding: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-13);
  line-height: var(--lh-body);
  color: var(--fg-0);
  background: var(--bg-0);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  font-feature-settings: "cv11", "ss01", "ss03";
  user-select: none;
  -webkit-user-select: none;
  cursor: default;
}

input,
textarea,
[contenteditable="true"],
.pg-selectable {
  user-select: text;
  -webkit-user-select: text;
}
```

- [ ] **Step 2: Type-check**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "feat(ui): disable text selection globally (except inputs)"
```

---

### Task 9: Final verification

- [ ] **Step 1: Type-check clean**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit
```

Expected: exit 0, no diagnostics.

- [ ] **Step 2: Rust build still compiles (no backend changes, sanity)**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: exit 0.

- [ ] **Step 3: Report status**

Summarize to the user:
- Chunked diff: consecutive same-kind lines now share a single background block.
- Recents: last-opened repo paths appear on the Welcome screen and are clickable.
- Context menu: native browser menu is suppressed; existing custom menus still work.
- File tree: clicking a folder expands/collapses it; Up/Down/Left/Right/Enter navigate; Enter on a file activates it.
- Selection: UI is globally unselectable; inputs still accept text selection.

Note that interactive browser verification was not performed by the agent — user should run `pnpm tauri dev` to confirm behavior live.
