# Centralized Branch UI — Design

Status: approved 2026-04-24

## Problem

The app currently has two places that present branches:

1. A persistent left sidebar (`AppSidebar` in `src/AppShell.tsx`) with five sections — Local, Remote, Tags, Stashes, Remotes — always visible when a repo is open.
2. A dedicated Branches screen (`⌘4`, `src/screens/Branches.tsx`) with a filterable table, view toggle (All/Local/Remote/Tags), and an inspector.

The sidebar duplicates functionality already on the Branches screen and consumes ~260px of horizontal real estate full-time. There is no fast way to switch branches without leaving whatever screen you're on. The titlebar shows the current branch as plain text, not an interactive affordance.

## Goals

- Make the Branches screen the single destination for ref browsing and management.
- Recover horizontal space by removing the persistent branch panel.
- Provide a fast, click-driven branch switcher in the titlebar that does not require navigating away from the current screen.

## Non-goals

- Keyboard shortcut to open the picker. V1 is click-only.
- Command-palette-style jumping to arbitrary refs or SHAs.
- Folding the Remote screen (`⌘7`) into the Branches screen. Remotes are admin/config, not a ref you check out; they stay where they are.
- Automated UI tests (the project currently has none).

## User-facing behavior

### Shell layout

- The persistent left sidebar is removed. The activity bar sits flush against the main screen area.
- Main content gets ~260px more width by default.

### Titlebar branch chip

- The existing branch-name display in the titlebar becomes a clickable button (the "branch chip").
- On hover, a caret/chevron appears to signal interactivity.
- Left-click opens the branch picker popover (see below).
- Right-click opens the existing `branchMenuItems` context menu for the current branch (so users can push/pull/rename/delete-with-upstream/etc. against HEAD without opening the picker).
- Detached HEAD: chip renders `(detached) <shortOid>`; click still opens the picker.

### Branch picker (popover)

- Anchored under the branch chip, ~400px wide, up to ~480px tall.
- Closes on outside click, Esc, or after a checkout action completes.
- Search input at the top, autofocused, filters both sections live.
- Two sections, in order:
  - **Local** — local branches.
  - **Remote** — remote-tracking branches.
- Each row shows: branch icon, name, upstream dim-text (local only), ahead/behind chips, right-side `⋯` icon.
- The current branch row carries the `HEAD` badge and is not selectable for checkout (Enter no-ops with a subtle cue).
- Keyboard:
  - `↑` / `↓` move the highlight across both sections.
  - `Enter` checks out the highlighted row.
  - `→` or right-click opens the per-row context menu (reuses `branchMenuItems` / `remoteBranchMenuItems`).
  - `Esc` closes.
- When the query returns no matches, the picker shows "No branches match `foo`" and a "Create branch `foo` from HEAD" action.
- When the repo has zero branches, only the "Create branch… from HEAD" action is shown.

### Branches screen (⌘4) — the ref hub

- Toolbar view toggle grows from `All / Local / Remote / Tags` to `All / Local / Remote / Tags / Stashes`.
- The existing grid renders stashes in `All` and `Stashes` views using the same columns:
  - icon: `stash`
  - NAME: `stash@{n}`
  - TIP: short oid of the stash commit
  - UPSTREAM: stash message (truncated)
  - STATUS: blank (the current `StashInfo` type carries `index`, `name`, `message` only; no author/date to surface).
- The inspector panel adapts to the selected row's kind:
  - **Branch** (existing): Check out / Merge into current / Rebase current onto this / Delete branch.
  - **Tag** (new): Check out (detached) / Delete tag / Push tag (push button disabled if no upstream remote).
  - **Stash** (new): Apply / Pop / Drop / Show diff (opens the diff viewer against the stash's parent).
- Selection state becomes `{ kind: "branch" | "tag" | "stash"; key: string } | null` so branches and tags with identical names are distinguishable.
- The `BranchesToolbar` "New branch" button keeps existing behavior. "Fetch all" remains disabled pending a later feature.

### Remotes screen (⌘7)

- Unchanged. Continues to handle remote URLs, add/remove remote, prune.

## Code changes

### `src/AppShell.tsx`
- Delete `AppSidebar` and all references: `sidebar` pane width, `<PGResizeHandle>` between sidebar and main, `showSidebar` variable, `pg-sidebar-w` localStorage key, and the `⌘P` shortcut hint previously shown on the sidebar's filter input.
- Context-menu hooks for stashes / tags / remote-branches / remotes previously created in `AppSidebar` can be dropped at this layer — they're either already used inside `BranchesScreen` or will be added there as part of this change. The `Remote` screen's menus are untouched.
- In `AppTitlebar`, replace the `branch={head?.name ?? "(detached)"}` string with a `<BranchChip />` node passed through the titlebar's branch slot.

### `src/design/chrome.tsx`
- If `PGTitlebar`'s `branch` prop is typed `string`, widen it to `React.ReactNode`. Otherwise no change.

### New: `src/features/branches/BranchChip.tsx`
- Button presenting the current branch (or `(detached) <shortOid>`) plus ahead/behind badges.
- Renders caret on hover.
- `onClick` toggles the picker.
- `onContextMenu` opens `branchMenuItems({ name: head, current: true, upstream })` via the existing `useContextMenu` hook.
- Only renders when a repo is open.

### New: `src/features/branches/BranchPicker.tsx`
- Popover anchored to a supplied `anchorRef`.
- Props: `anchorRef: React.RefObject<HTMLElement>`, `open: boolean`, `onClose: () => void`.
- Internal state: `query`, `activeIndex` (spans flattened list of visible rows across both sections).
- Reads from `useRepoStore`: `branches`, `checkoutBranch`, `createBranch`.
- Reuses `branchMenuItems` / `remoteBranchMenuItems` for per-row context menus via `useContextMenu`.
- Closes on: outside click, Esc, successful checkout.
- Focus trap: input on open; ArrowUp/Down shift focus within the list.

### `src/screens/Branches.tsx`
- Add `"stashes"` to the view-toggle union and toolbar `PGButtonGroup` options.
- Render stashes as additional rows in the grid under `All` and `Stashes` views. Stash rows bind to the existing `stashMenuItems` context menu. Use `useRepoStore((s) => s.stashes)`.
- Change selection from `selected: string | null` to `selection: { kind: "branch" | "tag" | "stash"; key: string } | null`. Update all selection reads/writes accordingly.
- Extend the right-side inspector with per-kind subsections. Tag and stash inspectors are new; branch inspector stays.
- When the selection is a stash and the user clicks "Show diff", push a new `stash-diff` nav intent via `useNavStore` and route it to the diff viewer.

### `src/features/nav/useNavStore.ts`
- Add a `stash-diff` intent variant: `{ kind: "stash-diff"; index: number }`. `AppShell` routes it to the `diff` screen (or a dedicated stash-diff route if the diff viewer needs distinguishing context — the diff viewer already renders arbitrary kinds, so preferred approach is to feed the stash's diff through the same path).

### `src/features/repo/useRepoStore.ts`
- No API changes expected. All required data (`branches`, `tags`, `stashes`, `checkoutBranch`, `createBranch`, `deleteBranch`, stash apply/pop/drop) is already exposed or already used by the existing screens.

## Data flow

- Titlebar chip → `useRepoStore` for `head`, `branches` (ahead/behind).
- Picker → `useRepoStore` for `branches`, `checkoutBranch`, `createBranch`.
- Branches screen inspector actions → `useRepoStore` methods for branch/tag/stash operations.

No new backend commands are required.

## Edge cases

- **No repo open.** `BranchChip` does not render; titlebar shows only "Open…" (unchanged).
- **Detached HEAD.** Chip shows `(detached) <shortOid>`. Picker opens normally; the detached state is represented as the HEAD badge on a synthetic row (or no HEAD badge anywhere — the picker is still usable for checkout).
- **No branches.** Picker renders only the "Create branch… from HEAD" action.
- **Long names.** Chip truncates with middle ellipsis; picker rows truncate on the right with `title` attr for full name.
- **Picker open while store refreshes.** List re-renders; `activeIndex` clamps to new length.
- **Row names collide across kinds on Branches screen** (branch `v1` and tag `v1`): selection key includes `kind`, so inspector resolves correctly.

## Testing

Manual verification:
- Open the picker by clicking the chip; verify caret appears on hover.
- Type a substring; both sections filter; Enter checks out the highlighted branch.
- Right-click a row; verify `branchMenuItems` menu appears and actions fire.
- Right-click the chip; verify current-branch menu appears.
- Switch to ⌘4 Branches; switch view to Stashes; select a stash; verify apply/pop/drop work.
- Select a tag; verify detached checkout works; verify delete-tag works.
- Verify the sidebar is gone and the main content has extra horizontal room.
- Detached HEAD: check out a commit via history context menu, verify chip updates and picker still opens.
- Empty repo: open a freshly `git init`'d directory; verify chip behavior and picker empty state.

Automated:
- `pnpm tsc --noEmit` passes.
- `cargo check --manifest-path src-tauri/Cargo.toml` passes (no backend changes expected).
- Existing `cargo test` suite passes.
