# Centralized Branch UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the persistent branch sidebar, absorb its ref contents (branches + tags + stashes) into the Branches screen, and add a click-triggered branch picker popover anchored to the titlebar branch chip.

**Architecture:** The shell loses `AppSidebar` and its resize handle. `AppTitlebar` renders a new `BranchChip` component in the existing `branch` slot (widened to `ReactNode`). The chip opens a new `BranchPicker` popover that reads `branches` from `useRepoStore` and calls `checkoutBranch` / `createBranch`. The `BranchesScreen` gains a `Stashes` view toggle and a kind-discriminated selection + inspector.

**Tech Stack:** React 19, TypeScript, Zustand, Tauri 2. Styling via CSS variables (`var(--…)`) and inline styles (existing convention). No new dependencies.

**Related docs:**
- Spec: `docs/superpowers/specs/2026-04-24-centralized-branch-ui-design.md`
- Project conventions: `CLAUDE.md`

**Verification:** No automated UI tests exist in this project. Each task ends with a typecheck (`pnpm tsc --noEmit`) and a manual verification step in `pnpm tauri dev`. Do not skip manual verification.

**Commands (prepend to shell calls):**
```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
```

---

## Task 1: Widen `PGTitlebar.branch` prop to `ReactNode`

**Rationale:** Current prop is `string`; `BranchChip` is a custom node. Widen the prop so the shell can pass JSX through the existing slot without forking the primitive.

**Files:**
- Modify: `src/design/chrome.tsx` (lines 42–110)

- [ ] **Step 1: Update `PGTitlebarProps` type and rendering site**

In `src/design/chrome.tsx`, change `branch?: string;` to `branch?: React.ReactNode;`. Update the render site to accept a node — if a string is passed, wrap it in the existing styled `<span>`; if it's a non-string node, render it directly.

Replace the existing `branch` render block (the section between `<PGIcon name="branch" size={12} />` and the dirty badge) with:

```tsx
        <PGIcon name="branch" size={12} />
        {typeof branch === "string" ? (
          <span style={{ color: "var(--accent)" }}>{branch}</span>
        ) : (
          branch
        )}
```

Keep the default value `branch = "main"` as-is (still a valid `ReactNode`).

- [ ] **Step 2: Typecheck**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/design/chrome.tsx
git commit -m "$(cat <<'EOF'
chore(design): widen PGTitlebar branch prop to ReactNode

Why: upcoming BranchChip component needs to render JSX through the
branch slot. Preserve string path for callers passing a plain name.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add `stash-diff` nav intent variant

**Files:**
- Modify: `src/features/nav/useNavStore.ts`
- Modify: `src/AppShell.tsx` (the `intent` effect, around line 149–170)

- [ ] **Step 1: Add the variant**

In `src/features/nav/useNavStore.ts`, extend the `NavIntent` union:

```ts
export type NavIntent =
  | { kind: "diff-file"; path: string }
  | { kind: "commit-vs-wt"; oid: string }
  | { kind: "commit-vs-commit"; from: string; to: string }
  | { kind: "file-history"; path: string }
  | { kind: "blame"; path: string }
  | { kind: "rebase-plan"; plan: RebaseStep[] }
  | { kind: "stash-diff"; oid: string };
```

- [ ] **Step 2: Route the variant in `AppShell`**

In `src/AppShell.tsx`, inside the `React.useEffect(() => { if (!intent) return; switch (intent.kind) { … } })` block, add a case that reuses the commit-vs-wt route (the stash oid behaves like a commit oid for diff purposes):

```tsx
      case "stash-diff":
        setScreen("commitDiff");
        break;
```

- [ ] **Step 3: Make `CommitDiff` screen understand the intent**

Open `src/screens/CommitDiff.tsx`. Find the existing intent handling (it already reads `commit-vs-wt` and `commit-vs-commit`). Add a branch that treats `stash-diff` like `commit-vs-wt`:

Locate the effect reading `intent` and add a case alongside the existing ones. If the existing code uses an `if/else` chain on `intent.kind`, add:

```tsx
    } else if (intent?.kind === "stash-diff") {
      // Treat stash commit as a one-sided diff vs worktree.
      setFrom(intent.oid);
      setTo(null);
      clearIntent();
    }
```

(Adapt variable names to match what `CommitDiff.tsx` already uses. If `CommitDiff` uses different state shape, mirror the `commit-vs-wt` case verbatim but substitute the stash oid.)

- [ ] **Step 4: Typecheck**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/features/nav/useNavStore.ts src/AppShell.tsx src/screens/CommitDiff.tsx
git commit -m "$(cat <<'EOF'
feat(nav): add stash-diff intent, route to commit diff screen

Why: Branches screen's upcoming stash inspector needs a way to show a
stash's diff. Reuse the existing commit-diff viewer with the stash oid
on the "from" side.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Create `BranchChip` component

**Files:**
- Create: `src/features/branches/BranchChip.tsx`

- [ ] **Step 1: Write the component**

Create `src/features/branches/BranchChip.tsx`:

```tsx
import React from "react";
import { PGIcon, useContextMenu, branchMenuItems } from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { currentBranch, totalAheadBehind } from "@/lib/git-helpers";
import type { BranchInfo } from "@/lib/types";

interface BranchChipProps {
  onClick: (anchor: HTMLElement) => void;
}

export function BranchChip({ onClick }: BranchChipProps) {
  const branches = useRepoStore((s) => s.branches);
  const repo = useRepoStore((s) => s.current);
  const head = currentBranch(branches);
  const { ahead, behind } = totalAheadBehind(branches);
  const [hover, setHover] = React.useState(false);
  const ref = React.useRef<HTMLButtonElement | null>(null);

  const { onContextMenu, menu } = useContextMenu<BranchInfo | null>((b) =>
    branchMenuItems({
      name: b?.name,
      current: true,
      upstream: b?.upstream,
    }),
  );

  if (!repo) return null;

  const label = head ? head.name : "(detached)";
  const detail = head ? null : repo.head?.slice(0, 7) ?? null;

  return (
    <>
      <button
        ref={ref}
        onClick={() => ref.current && onClick(ref.current)}
        onContextMenu={(e) => onContextMenu(e.nativeEvent, head ?? null)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          background: hover ? "var(--bg-2)" : "transparent",
          border: "1px solid transparent",
          borderColor: hover ? "var(--border-0)" : "transparent",
          borderRadius: "var(--r-2)",
          padding: "2px 6px",
          cursor: "pointer",
          color: "var(--accent)",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-12)",
          maxWidth: 280,
        }}
        title={label}
      >
        <PGIcon name="branch" size={12} />
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
        {detail && (
          <span style={{ color: "var(--fg-3)", fontSize: "var(--fs-11)" }}>
            {detail}
          </span>
        )}
        {ahead > 0 && (
          <span style={{ color: "var(--git-added)", fontSize: "var(--fs-10)" }}>
            ↑{ahead}
          </span>
        )}
        {behind > 0 && (
          <span
            style={{ color: "var(--git-modified)", fontSize: "var(--fs-10)" }}
          >
            ↓{behind}
          </span>
        )}
        <PGIcon
          name="chevronDown"
          size={10}
          style={{
            color: "var(--fg-3)",
            opacity: hover ? 1 : 0,
            transition: "opacity 80ms",
          }}
        />
      </button>
      {menu}
    </>
  );
}
```

**Note on helpers:** `currentBranch` and `totalAheadBehind` already live in `src/lib/git-helpers.ts` — they're imported by `AppShell.tsx` already. If the module path differs (check with `grep -n "currentBranch\|totalAheadBehind" src/AppShell.tsx`), update the import line here to match.

- [ ] **Step 2: Typecheck**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm tsc --noEmit
```

Expected: no errors. If `currentBranch` / `totalAheadBehind` come from a different module, the typecheck will complain — fix the import and retypecheck.

- [ ] **Step 3: Commit**

```bash
git add src/features/branches/BranchChip.tsx
git commit -m "$(cat <<'EOF'
feat(branches): BranchChip component for titlebar

Why: replaces the static branch-name text with a clickable chip that
will open the branch picker. Shows ahead/behind badges, hover caret,
and right-click context menu for the current branch.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Create `BranchPicker` popover component

**Files:**
- Create: `src/features/branches/BranchPicker.tsx`

- [ ] **Step 1: Write the component**

Create `src/features/branches/BranchPicker.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom";
import {
  PGIcon,
  PGSearchInput,
  PGIconButton,
  useContextMenu,
  branchMenuItems,
  remoteBranchMenuItems,
} from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import type { BranchInfo } from "@/lib/types";

interface BranchPickerProps {
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
}

type Row = BranchInfo & { kind: "local" | "remote" };

const WIDTH = 400;
const MAX_HEIGHT = 480;

export function BranchPicker({ anchor, open, onClose }: BranchPickerProps) {
  const branches = useRepoStore((s) => s.branches);
  const checkoutBranch = useRepoStore((s) => s.checkoutBranch);
  const createBranch = useRepoStore((s) => s.createBranch);
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const { onContextMenu: onLocalCtx, menu: localMenu } =
    useContextMenu<BranchInfo>((b) =>
      branchMenuItems({
        name: b?.name,
        current: b?.isHead,
        upstream: b?.upstream,
      }),
    );
  const { onContextMenu: onRemoteCtx, menu: remoteMenu } =
    useContextMenu<BranchInfo>((b) =>
      remoteBranchMenuItems({ name: b?.name }),
    );

  const local: Row[] = React.useMemo(
    () =>
      branches
        .filter((b) => !b.isRemote && b.name.includes(query))
        .map((b) => ({ ...b, kind: "local" as const })),
    [branches, query],
  );
  const remote: Row[] = React.useMemo(
    () =>
      branches
        .filter((b) => b.isRemote && b.name.includes(query))
        .map((b) => ({ ...b, kind: "remote" as const })),
    [branches, query],
  );

  const flat = React.useMemo(() => [...local, ...remote], [local, remote]);

  React.useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  React.useEffect(() => {
    if (activeIndex >= flat.length) setActiveIndex(Math.max(0, flat.length - 1));
  }, [flat.length, activeIndex]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      const popover = document.getElementById("pg-branch-picker");
      if (popover && t && popover.contains(t)) return;
      if (anchor && t && anchor.contains(t)) return;
      onClose();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open, onClose, anchor]);

  if (!open || !anchor) return null;

  const rect = anchor.getBoundingClientRect();
  const left = Math.max(
    8,
    Math.min(rect.left, window.innerWidth - WIDTH - 8),
  );
  const top = rect.bottom + 4;

  const checkout = (r: Row) => {
    if (r.kind === "local" && r.isHead) return;
    void checkoutBranch(r.name);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(flat.length - 1, i + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (flat.length === 0 && query.trim()) {
        void createBranch(query.trim()).then(() =>
          useRepoStore.getState().checkoutBranch(query.trim()),
        );
        onClose();
        return;
      }
      const row = flat[activeIndex];
      if (row) checkout(row);
      return;
    }
    if (e.key === "ArrowRight") {
      const row = flat[activeIndex];
      if (!row) return;
      e.preventDefault();
      const fakeEvent = new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: rect.left + 200,
        clientY: top + 40,
      });
      if (row.kind === "local") onLocalCtx(fakeEvent, row);
      else onRemoteCtx(fakeEvent, row);
    }
  };

  let rowIndex = -1;
  const renderRow = (r: Row) => {
    rowIndex += 1;
    const idx = rowIndex;
    const active = idx === activeIndex;
    const handler = r.kind === "local" ? onLocalCtx : onRemoteCtx;
    return (
      <div
        key={`${r.kind}:${r.name}`}
        onClick={() => checkout(r)}
        onContextMenu={(e) => handler(e.nativeEvent, r)}
        onMouseEnter={() => setActiveIndex(idx)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          height: 26,
          padding: "0 10px",
          background: active ? "var(--bg-selection)" : "transparent",
          cursor: r.kind === "local" && r.isHead ? "default" : "pointer",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-12)",
          position: "relative",
        }}
      >
        <PGIcon
          name="branch"
          size={12}
          style={{ color: r.isHead ? "var(--accent)" : "var(--fg-2)" }}
        />
        <span
          title={r.name}
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: r.isHead ? "var(--accent)" : "var(--fg-0)",
          }}
        >
          {r.name}
        </span>
        {r.isHead && (
          <span
            style={{
              fontSize: "var(--fs-10)",
              color: "var(--accent)",
              padding: "0 4px",
              border: "1px solid var(--accent)",
              borderRadius: "var(--r-2)",
            }}
          >
            HEAD
          </span>
        )}
        {r.kind === "local" && r.upstream && !r.isHead && (
          <span
            style={{
              color: "var(--fg-3)",
              fontSize: "var(--fs-10)",
              maxWidth: 120,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {r.upstream}
          </span>
        )}
        {r.ahead > 0 && (
          <span style={{ color: "var(--git-added)", fontSize: "var(--fs-10)" }}>
            ↑{r.ahead}
          </span>
        )}
        {r.behind > 0 && (
          <span
            style={{ color: "var(--git-modified)", fontSize: "var(--fs-10)" }}
          >
            ↓{r.behind}
          </span>
        )}
        <PGIconButton
          icon="more"
          size="sm"
          title="Actions"
          onClick={(e) => {
            e.stopPropagation();
            handler(e.nativeEvent, r);
          }}
        />
      </div>
    );
  };

  const sectionHeader = (label: string, count: number) => (
    <div
      style={{
        padding: "6px 10px 2px",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-10)",
        color: "var(--fg-2)",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
      }}
    >
      {label} <span style={{ color: "var(--fg-3)" }}>({count})</span>
    </div>
  );

  const content = (
    <>
      <div
        id="pg-branch-picker"
        onKeyDown={onKeyDown}
        style={{
          position: "fixed",
          left,
          top,
          width: WIDTH,
          maxHeight: MAX_HEIGHT,
          background: "var(--bg-1)",
          border: "1px solid var(--border-1)",
          borderRadius: "var(--r-3)",
          boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
          zIndex: 100,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: 8, borderBottom: "1px solid var(--border-0)" }}>
          <PGSearchInput
            value={query}
            onChange={setQuery}
            placeholder="Switch to branch…"
            inputRef={inputRef}
          />
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>
          {local.length === 0 && remote.length === 0 ? (
            <div
              style={{
                padding: 12,
                fontSize: "var(--fs-12)",
                color: "var(--fg-3)",
                fontFamily: "var(--font-mono)",
              }}
            >
              {query
                ? `No branches match “${query}”.`
                : "No branches in this repo."}
              {query && (
                <div style={{ marginTop: 8 }}>
                  <span
                    onClick={() => {
                      void createBranch(query.trim()).then(() =>
                        useRepoStore.getState().checkoutBranch(query.trim()),
                      );
                      onClose();
                    }}
                    style={{
                      color: "var(--accent)",
                      cursor: "pointer",
                      textDecoration: "underline",
                    }}
                  >
                    Create branch “{query.trim()}” from HEAD
                  </span>
                </div>
              )}
            </div>
          ) : (
            <>
              {local.length > 0 && (
                <>
                  {sectionHeader("Local", local.length)}
                  {local.map(renderRow)}
                </>
              )}
              {remote.length > 0 && (
                <>
                  {sectionHeader("Remote", remote.length)}
                  {remote.map(renderRow)}
                </>
              )}
            </>
          )}
        </div>
      </div>
      {localMenu}
      {remoteMenu}
    </>
  );

  return ReactDOM.createPortal(content, document.body);
}
```

**Note on `PGSearchInput.inputRef`:** if that prop doesn't exist, check `src/design/primitives.tsx` around line 328 for the actual ref forwarding mechanism. If it uses `React.forwardRef`, wrap the `PGSearchInput` with a ref; if it accepts no ref, add `inputRef` as an optional prop in the primitive (small change — a `React.RefObject<HTMLInputElement>` that the primitive assigns to its internal `<input>`).

- [ ] **Step 2: Typecheck**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm tsc --noEmit
```

If `PGSearchInput` doesn't accept `inputRef`, add the prop in `src/design/primitives.tsx`:

```tsx
// inside PGSearchInputProps:
inputRef?: React.Ref<HTMLInputElement>;
// inside PGSearchInput render:
<input ref={inputRef} … />
```

- [ ] **Step 3: Commit**

```bash
git add src/features/branches/BranchPicker.tsx src/design/primitives.tsx
git commit -m "$(cat <<'EOF'
feat(branches): BranchPicker popover anchored under titlebar chip

Why: fast branch switch without leaving current screen. Search + local/
remote sections, keyboard nav, per-row context menu reusing existing
branchMenuItems/remoteBranchMenuItems. Enter checks out; empty search
offers "Create branch from HEAD".

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Wire `BranchChip` + `BranchPicker` into `AppTitlebar`

**Files:**
- Modify: `src/AppShell.tsx` (AppTitlebar function, ~lines 300–431)

- [ ] **Step 1: Import new components**

At the top of `src/AppShell.tsx`, add:

```tsx
import { BranchChip } from "@/features/branches/BranchChip";
import { BranchPicker } from "@/features/branches/BranchPicker";
```

- [ ] **Step 2: Replace branch string with `BranchChip` + picker state**

In `AppTitlebar`, remove the `branch={head?.name ?? "(detached)"}` prop from `PGTitlebar` and replace it with a node. Add picker open/anchor state inside `AppTitlebar`:

```tsx
  const [pickerAnchor, setPickerAnchor] = React.useState<HTMLElement | null>(
    null,
  );

  // existing head/upstream/etc. lines stay
```

Change the `<PGTitlebar …>` invocation to:

```tsx
    <>
      <PGTitlebar
        repoName={repoName}
        branch={repo ? <BranchChip onClick={setPickerAnchor} /> : "—"}
        dirty={dirty}
        showTrafficLights={false}
        rightSlot={/* unchanged */}
      />
      <BranchPicker
        anchor={pickerAnchor}
        open={!!pickerAnchor}
        onClose={() => setPickerAnchor(null)}
      />
    </>
```

Wrap the existing single-expression return in a fragment. The existing `rightSlot` block stays identical.

- [ ] **Step 3: Typecheck**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm tsc --noEmit
```

- [ ] **Step 4: Manually verify**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm tauri dev
```

- Titlebar shows branch chip in accent color, hover reveals the chevron.
- Click the chip: picker opens below.
- Type a query: local + remote lists filter live.
- `↑` / `↓` navigate; `Enter` checks out; `Esc` closes.
- Right-click a row: context menu opens (checkout / merge / rebase / delete for local; checkout / delete / pull for remote).
- Right-click the chip: current-branch menu opens.
- Empty query + no branches: "Create branch … from HEAD" offer.

- [ ] **Step 5: Commit**

```bash
git add src/AppShell.tsx
git commit -m "$(cat <<'EOF'
feat(titlebar): wire branch chip and picker popover

Why: branch name becomes an interactive chip. Click opens the picker;
right-click opens the current-branch context menu. Replaces the plain
text branch display.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Remove the persistent `AppSidebar`

**Files:**
- Modify: `src/AppShell.tsx`

- [ ] **Step 1: Delete the sidebar and its mount**

In `src/AppShell.tsx`:

1. Delete the `AppSidebar` function (roughly lines 433–643 — the entire definition including `localMenu`/`remoteBranchMenu`/`tagMenu`/`remoteMenu` internals).
2. In the `AppShell` component:
   - Delete the `sidebar = usePaneWidth(260, { …, storageKey: "pg-sidebar-w" })` hook call.
   - Delete the `showSidebar = hasRepo && screen !== "settings";` line.
   - In JSX, remove the two children guarded by `showSidebar`:
     ```tsx
     {showSidebar && <AppSidebar width={sidebar.width} />}
     {showSidebar && <PGResizeHandle onDrag={sidebar.resize} />}
     ```
3. Remove now-unused imports. Likely candidates:
   - `PGPrimarySidebar`, `PGSidebarGroup`, `PGSidebarRow` from `@/design`
   - `branchMenuItems`, `remoteBranchMenuItems`, `tagMenuItems`, `stashMenuItems`, `remoteMenuItems`, `useContextMenu` — keep any still used by `AppTitlebar`/`AppShell`/`AppStatusBar`. Run typecheck and let the compiler flag unused imports (or rely on your IDE).
   - `BranchInfo`, `RemoteInfo`, `TagInfo` types — keep only those still referenced.
   - `PGSearchInput` — keep only if still used in shell.
   - `PGIconButton` — keep only if still used in shell.

- [ ] **Step 2: Clean up orphaned localStorage key (cosmetic)**

No migration needed — `pg-sidebar-w` simply becomes dead data on users' machines. Don't add cleanup code (YAGNI).

- [ ] **Step 3: Typecheck**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm tsc --noEmit
```

Fix any unused-import complaints by deleting the relevant imports.

- [ ] **Step 4: Manually verify**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm tauri dev
```

- Sidebar is gone. Activity bar sits flush against the main content.
- All screens (Files / Commit / History / Branches / Conflict / Rebase / Remotes / Diff / Reflog) render without layout breakage.
- Branch chip + picker still work (from Task 5).

- [ ] **Step 5: Commit**

```bash
git add src/AppShell.tsx
git commit -m "$(cat <<'EOF'
feat(shell): remove persistent branch sidebar

Why: duplicates the Branches screen and consumes full-time real
estate. Ref browsing lives on the Branches screen (⌘4); fast switching
lives in the titlebar branch picker.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Extend `BranchesScreen` view toggle with `Stashes`

**Files:**
- Modify: `src/screens/Branches.tsx`

- [ ] **Step 1: Widen the `view` union and toolbar options**

In `src/screens/Branches.tsx`:

Change the `view` state type from:
```tsx
  const [view, setView] = React.useState<"all" | "local" | "remote" | "tags">(
    "all",
  );
```
to:
```tsx
  const [view, setView] = React.useState<
    "all" | "local" | "remote" | "tags" | "stashes"
  >("all");
```

Update `BranchesToolbar` props accordingly, and add a stashes option to the `PGButtonGroup`:

```tsx
            options={[
              { value: "all", label: "All" },
              { value: "local", label: "Local" },
              { value: "remote", label: "Remote" },
              { value: "tags", label: "Tags" },
              { value: "stashes", label: "Stashes" },
            ]}
```

- [ ] **Step 2: Read stashes from the store**

At the top of `BranchesScreen`, add:

```tsx
  const stashes = useRepoStore((s) => s.stashes);
```

- [ ] **Step 3: Filter visible stashes**

Add alongside `visibleTags`:

```tsx
  const visibleStashes = React.useMemo(() => {
    if (view === "stashes" || view === "all")
      return stashes.filter(
        (s) =>
          s.message.includes(filter) || `stash@{${s.index}}`.includes(filter),
      );
    return [];
  }, [stashes, filter, view]);
```

Also restrict `rows` (branches) and `visibleTags` to their view modes. Update the existing filter so the rows array returns `[]` when view is `stashes`:

Replace the existing `rows` memo with:

```tsx
  const rows = React.useMemo(() => {
    if (view === "tags" || view === "stashes") return [];
    const list = branches.map((b) => ({
      ...b,
      kind: b.isRemote ? ("remote" as const) : ("local" as const),
    }));
    const filtered = list.filter((b) => b.name.includes(filter));
    if (view === "local") return filtered.filter((b) => b.kind === "local");
    if (view === "remote") return filtered.filter((b) => b.kind === "remote");
    return filtered;
  }, [branches, filter, view]);
```

And the existing `visibleTags`:

```tsx
  const visibleTags = React.useMemo(() => {
    if (view === "stashes") return [];
    if (view === "tags" || view === "all")
      return tags.filter((t) => t.name.includes(filter));
    return [];
  }, [tags, filter, view]);
```

- [ ] **Step 4: Update empty-state check**

Replace:
```tsx
  if (branches.length === 0 && tags.length === 0) {
```
with:
```tsx
  if (branches.length === 0 && tags.length === 0 && stashes.length === 0) {
```

And update the empty message to read "No branches, tags, or stashes".

- [ ] **Step 5: Typecheck**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/screens/Branches.tsx
git commit -m "$(cat <<'EOF'
feat(branches): add Stashes view to branches screen

Why: branches screen becomes the single ref hub now that the persistent
sidebar is gone. Stashes join branches and tags under one filterable
grid.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Render stash rows in the Branches grid

**Files:**
- Modify: `src/screens/Branches.tsx`

- [ ] **Step 1: Add stash context menu hook**

Near the other `useContextMenu` hooks in `BranchesScreen`, add:

```tsx
  const { onContextMenu: onStashCtx, menu: stashMenu } = useContextMenu<{
    index: number;
    name: string;
  }>((s) => stashMenuItems(s));
```

Ensure `stashMenuItems` is imported from `@/design` at the top of the file.

- [ ] **Step 2: Render stash rows**

Inside the grid, after the tags rendering block, add a stashes block mirroring the tag rendering. Place this immediately after the `visibleTags.map(...)` block:

```tsx
            {visibleStashes.length > 0 && (
              <div
                style={{
                  padding: "16px 12px 6px",
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--fs-10)",
                  color: "var(--fg-2)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                STASHES
              </div>
            )}
            {visibleStashes.map((s) => (
              <div
                key={`stash:${s.index}`}
                onContextMenu={(e) =>
                  onStashCtx(e, { index: s.index, name: `stash@{${s.index}}` })
                }
                style={{
                  display: "grid",
                  gridTemplateColumns: gridTemplate,
                  alignItems: "center",
                  height: 28,
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--fs-12)",
                  borderBottom: "1px solid oklch(0.22 0.008 260 / 0.3)",
                }}
              >
                <div
                  style={{ ...cellStyle, justifyContent: "center", padding: 0 }}
                >
                  <PGIcon
                    name="stash"
                    size={12}
                    style={{ color: "var(--fg-2)" }}
                  />
                </div>
                <div style={cellStyle} title={`stash@{${s.index}}`}>
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    stash@{`{${s.index}}`}
                  </span>
                </div>
                <div style={{ ...cellStyle, color: "var(--accent)" }}>
                  {s.shortOid}
                </div>
                <div
                  style={{
                    ...cellStyle,
                    color: "var(--fg-2)",
                    fontSize: "var(--fs-11)",
                  }}
                  title={s.message}
                >
                  {s.message}
                </div>
                <div style={{ ...cellStyle, color: "var(--fg-3)" }}>stash</div>
                <div
                  style={{ ...cellStyle, justifyContent: "center", padding: 0 }}
                >
                  <PGIconButton
                    icon="more"
                    size="sm"
                    title="Actions"
                    onClick={(e) => {
                      e.stopPropagation();
                      onStashCtx(e, {
                        index: s.index,
                        name: `stash@{${s.index}}`,
                      });
                    }}
                  />
                </div>
              </div>
            ))}
```

Also render `{stashMenu}` at the bottom of the component, adjacent to `{branchMenu}` / `{tagMenu}`:

```tsx
      {branchMenu}
      {tagMenu}
      {stashMenu}
```

- [ ] **Step 3: Typecheck**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm tsc --noEmit
```

- [ ] **Step 4: Manually verify**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm tauri dev
```

- Open a repo with at least one stash (`git stash push -m test` in a repo with uncommitted changes).
- Navigate to ⌘4 Branches.
- Toggle view to Stashes; only stashes render.
- Toggle to All; branches, tags, then stashes render in that order.
- Filter by stash message; stashes filter live.
- Right-click a stash row: context menu appears with apply/pop/drop.

- [ ] **Step 5: Commit**

```bash
git add src/screens/Branches.tsx
git commit -m "$(cat <<'EOF'
feat(branches): render stash rows in the Branches grid

Why: stashes belong on the refs hub now that the sidebar is gone.
Reuses the existing grid layout and stashMenuItems context menu.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Kind-discriminated selection + tag/stash inspector

**Files:**
- Modify: `src/screens/Branches.tsx`

- [ ] **Step 1: Swap `selected: string | null` for `selection: Selection | null`**

Define a local type at the top of the file:

```tsx
type Selection =
  | { kind: "branch"; name: string }
  | { kind: "tag"; name: string }
  | { kind: "stash"; index: number };
```

Replace:
```tsx
  const [selected, setSelected] = React.useState<string | null>(null);
```
with:
```tsx
  const [selection, setSelection] = React.useState<Selection | null>(null);
```

Replace all reads of `selected` and assignments via `setSelected`:

- Branch row `onClick={() => setSelected(b.name)}` → `onClick={() => setSelection({ kind: "branch", name: b.name })}`
- Branch row background check `selected === b.name` → `selection?.kind === "branch" && selection.name === b.name`
- Tag row: add `onClick={() => setSelection({ kind: "tag", name: t.name })}` and `background: selection?.kind === "tag" && selection.name === t.name ? "var(--bg-selection)" : "transparent"`.
- Stash row: add `onClick={() => setSelection({ kind: "stash", index: s.index })}` and highlight similarly.

Replace the `selectedBranch` derivation with three resolvers:

```tsx
  const selectedBranch =
    selection?.kind === "branch"
      ? branches.find((b) => b.name === selection.name) ?? null
      : null;
  const selectedTag =
    selection?.kind === "tag"
      ? tags.find((t) => t.name === selection.name) ?? null
      : null;
  const selectedStash =
    selection?.kind === "stash"
      ? stashes.find((s) => s.index === selection.index) ?? null
      : null;
```

- [ ] **Step 2: Replace inspector content with per-kind subsections**

Replace the inspector body (the large block starting with `<div style={{ padding: 12, borderBottom: … }}>` that renders "BRANCH" header + KV fields) with conditional rendering:

```tsx
          <div style={{ padding: 12, borderBottom: "1px solid var(--border-0)" }}>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--fs-10)",
                color: "var(--fg-2)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                marginBottom: 6,
              }}
            >
              {selection?.kind?.toUpperCase() ?? "REF"}
            </div>
            {selectedBranch && <BranchInspector branch={selectedBranch} />}
            {selectedTag && <TagInspector tag={selectedTag} />}
            {selectedStash && <StashInspector stash={selectedStash} />}
            {!selection && (
              <span style={{ color: "var(--fg-3)", fontSize: "var(--fs-12)" }}>
                Select a branch, tag, or stash to inspect.
              </span>
            )}
          </div>
          <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
            {selectedBranch && <BranchActions branch={selectedBranch} />}
            {selectedTag && <TagActions tag={selectedTag} />}
            {selectedStash && <StashActions stash={selectedStash} />}
          </div>
```

- [ ] **Step 3: Add inspector + action subcomponents**

Add the following functions at the bottom of the file (below `BranchesToolbar`):

```tsx
function BranchInspector({ branch }: { branch: BranchInfo }) {
  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 8,
          minWidth: 0,
        }}
      >
        <PGIcon
          name="branch"
          size={14}
          style={{ color: "var(--accent)", flexShrink: 0 }}
        />
        <span
          title={branch.name}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-14)",
            color: "var(--accent)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {branch.name}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <KV k="Kind" v={branch.isRemote ? "remote" : "local"} />
        <KV k="Tip" v={<span className="mono">{branch.tip ?? "—"}</span>} />
        {!branch.isRemote && (
          <>
            <KV k="Tracks" v={branch.upstream ?? "— (no upstream)"} />
            <KV
              k="Ahead"
              v={
                <span style={{ color: "var(--git-added)" }}>
                  {branch.ahead} commits
                </span>
              }
            />
            <KV
              k="Behind"
              v={
                <span style={{ color: "var(--git-modified)" }}>
                  {branch.behind} commits
                </span>
              }
            />
          </>
        )}
      </div>
    </>
  );
}

function BranchActions({ branch }: { branch: BranchInfo }) {
  return (
    <>
      <PGButton
        variant="primary"
        icon="check"
        disabled={branch.isHead}
        onClick={() => useRepoStore.getState().checkoutBranch(branch.name)}
      >
        Check out
      </PGButton>
      <PGButton variant="outline" icon="merge" disabled={branch.isHead} title="merge will land in Plan C">
        Merge into current
      </PGButton>
      <PGButton variant="outline" icon="rebase" disabled={branch.isHead} title="rebase will land in Plan E">
        Rebase current onto this
      </PGButton>
      <PGButton
        variant="ghost"
        tone="danger"
        icon="trash"
        disabled={branch.isHead}
        onClick={() => {
          if (window.confirm(`Delete ${branch.name}?`))
            useRepoStore.getState().deleteBranch(branch.name);
        }}
      >
        Delete branch
      </PGButton>
    </>
  );
}

function TagInspector({ tag }: { tag: TagInfo }) {
  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 8,
          minWidth: 0,
        }}
      >
        <PGIcon name="tag" size={14} style={{ color: "var(--git-modified)", flexShrink: 0 }} />
        <span
          title={tag.name}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-14)",
            color: "var(--fg-0)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {tag.name}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <KV k="Oid" v={<span className="mono">{tag.shortOid}</span>} />
      </div>
    </>
  );
}

function TagActions({ tag }: { tag: TagInfo }) {
  const remotes = useRepoStore((s) => s.remotes);
  const defaultRemote = remotes[0]?.name ?? null;
  return (
    <>
      <PGButton
        variant="primary"
        icon="check"
        onClick={() => useRepoStore.getState().checkoutRef(tag.name)}
      >
        Check out (detached)
      </PGButton>
      <PGButton
        variant="outline"
        icon="push"
        disabled={!defaultRemote}
        title={defaultRemote ? `push to ${defaultRemote}` : "no remote configured"}
        onClick={() => {
          if (defaultRemote)
            useRepoStore.getState().pushTag(defaultRemote, tag.name);
        }}
      >
        Push tag{defaultRemote ? ` to ${defaultRemote}` : ""}
      </PGButton>
      <PGButton
        variant="ghost"
        tone="danger"
        icon="trash"
        onClick={() => {
          if (window.confirm(`Delete tag ${tag.name}?`))
            useRepoStore.getState().deleteTag(tag.name);
        }}
      >
        Delete tag
      </PGButton>
    </>
  );
}

function StashInspector({ stash }: { stash: StashInfo }) {
  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 8,
          minWidth: 0,
        }}
      >
        <PGIcon name="stash" size={14} style={{ color: "var(--fg-2)", flexShrink: 0 }} />
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-14)",
            color: "var(--fg-0)",
          }}
        >
          stash@{`{${stash.index}}`}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <KV k="Oid" v={<span className="mono">{stash.shortOid}</span>} />
        <KV k="Message" v={stash.message} />
      </div>
    </>
  );
}

function StashActions({ stash }: { stash: StashInfo }) {
  const setIntent = useNavStore((s) => s.setIntent);
  return (
    <>
      <PGButton
        variant="primary"
        icon="check"
        onClick={() => useRepoStore.getState().stashApply(stash.index)}
      >
        Apply
      </PGButton>
      <PGButton
        variant="outline"
        icon="pop"
        onClick={() => useRepoStore.getState().stashPop(stash.index)}
      >
        Pop
      </PGButton>
      <PGButton
        variant="outline"
        icon="fileCode"
        onClick={() => setIntent({ kind: "stash-diff", oid: stash.shortOid })}
      >
        Show diff
      </PGButton>
      <PGButton
        variant="ghost"
        tone="danger"
        icon="trash"
        onClick={() => {
          if (window.confirm(`Drop stash@{${stash.index}}?`))
            useRepoStore.getState().stashDrop(stash.index);
        }}
      >
        Drop
      </PGButton>
    </>
  );
}
```

Add imports at the top of `src/screens/Branches.tsx` if missing:

```tsx
import { useNavStore } from "@/features/nav/useNavStore";
import type { BranchInfo, StashInfo, TagInfo } from "@/lib/types";
```

**Icon note:** If `pop` isn't a registered icon in `src/design/icons.tsx`, substitute `"stash"` or `"check"`. Check the available names with `grep -n "'pop'\\|\"pop\"" src/design/icons.tsx` and adjust.

**Button `tone` note:** `tone="danger"` and `variant="ghost"` are already used elsewhere (see Branches.tsx line ~533). No change needed if already supported.

- [ ] **Step 3: Typecheck**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm tsc --noEmit
```

- [ ] **Step 4: Manually verify**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm tauri dev
```

- Select a branch row: inspector shows branch info + checkout / merge / rebase / delete.
- Select a tag row: inspector shows tag info + checkout (detached) / push tag / delete tag. Checkout puts you in detached HEAD (verify via chip).
- Select a stash row: inspector shows stash info + apply / pop / show diff / drop. Apply restores changes. Drop removes the stash.
- "Show diff" on stash: routes to commit diff screen with the stash's oid.
- Rows with colliding names across kinds (rare but possible): selecting one doesn't highlight the other.

- [ ] **Step 5: Commit**

```bash
git add src/screens/Branches.tsx
git commit -m "$(cat <<'EOF'
feat(branches): kind-discriminated selection + tag/stash inspector

Why: with stashes on the branches screen and tags already here, the
inspector needs to adapt per-kind. Selection keys include the kind
so a tag v1 doesn't collide with a branch v1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Final verification pass

- [ ] **Step 1: Full typecheck**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm tsc --noEmit
```

- [ ] **Step 2: Rust sanity**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: no errors (no backend changes in this plan).

- [ ] **Step 3: Manual run-through (spec § Testing)**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm tauri dev
```

Walk through every bullet in the spec's "Testing › Manual verification" section:
- Chip click opens picker; hover shows caret.
- Typing filters both sections; Enter checks out.
- Right-click row opens `branchMenuItems` / `remoteBranchMenuItems`.
- Right-click chip opens current-branch menu.
- ⌘4 Branches → Stashes view → apply/pop/drop work.
- Tag selection → detached checkout; push tag; delete tag.
- Sidebar gone; main content wider.
- Detached HEAD: chip shows `(detached) <shortOid>`; picker opens.
- Empty repo: chip hidden if no repo; if repo has zero branches, picker shows only "Create branch from HEAD".

- [ ] **Step 4: No commit needed unless fixups emerged.**

If any fixups were required during verification, commit them with a message describing the fix (not as a fresh feature commit).

---

## Out of scope (explicitly)

- Keyboard shortcut (⌘B) to open picker.
- Command-palette-style SHA/ref jumping.
- Folding the Remote screen into Branches.
- Automated UI tests.
