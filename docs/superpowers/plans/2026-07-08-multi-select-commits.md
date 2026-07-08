# Multi-Select Commits — Implementation Plan

Spec: `docs/superpowers/specs/2026-07-08-multi-select-commits-design.md`

TDD: pure logic and store behavior get tests first. UI gets a component test.

## 1. Pure logic (tests first)

`src/features/commits/planCommitSelection.ts` (new) + `.test.ts`:

- `CommitSelectionPlan` interface + `planCommitSelection(commits, selectedOids)`
  per spec. Map each selected oid to its index in `commits` (newest-first),
  drop unknowns, sort ascending. `newestOid = commits[min]`,
  `oldestOid = commits[max]`, `baseOid = commits[max+1]?.oid ?? null`,
  `contiguous = max - min + 1 === indices.length`,
  `oids = indices desc → commits[i].oid` (oldest→newest),
  `hasMerge = any commits[i].parents.length > 1`. Empty → `null`.

`src/features/commits/buildRebasePlan.ts` + `.test.ts`:

- Add `| { kind: "squash-range"; oids: string[]; message: string }` to the
  `mode` union. In the map, compute `oldestSelected` = first entry of
  `oldestFirst` whose oid ∈ `oids`; a commit in `oids` other than
  `oldestSelected` → `action = "Squash"`, `message = mode.message`. Everything
  else stays `Pick`.

## 2. Keymap: shift+arrow extend

`src/features/keymap/actions.ts`: add `"list.extendUp"` / `"list.extendDown"`
to the `ActionId` union and the catalog (`category: "Lists & trees"`,
`scope: "pane"`, `suppressInInput: true`, titles "Extend selection up/down").

`src/features/keymap/presets.ts`: bind `"list.extendUp": ["Shift+ArrowUp"]`,
`"list.extendDown": ["Shift+ArrowDown"]` (shared map; check `presets.test.ts`
for any "every action bound" assertion and satisfy it).

`src/features/keymap/usePaneList.ts`: add optional `onExtendUp?: () => void`
and `onExtendDown?: () => void`; register `list.extendUp`/`list.extendDown`
guarded like the others (decline when the callback is absent so the chord
falls through).

## 3. Store: cherryPickMany

`src/features/repo/useRepoStore.ts`: add `cherryPickMany: (oids: string[]) =>
Promise<void>` to the interface and impl. Import the raw `cherryPick` wrapper
(already imported). Loop `for (const oid of oids) await cherryPick(repo.id,
oid)`, then one `refreshAll()`. Catch: `await refreshAll(); set({ error })`
(refresh-first convention). `oids` arrive oldest→newest from the caller.

Test in `useRepoStore` (or a focused `*.test.ts`): `mockInvoke("cherry_pick")`
records oids; assert order + that a throwing pick stops the loop.

## 4. Context menu: commitMultiMenuItems

`src/design/context-menu.tsx`: export `commitMultiMenuItems(oids: string[]):
ContextMenuItem[]`. Compute `planCommitSelection(useRepoStore.getState()
.commits, oids)` inside. Items:

- title `N commits`.
- **View combined diff** → `useNavStore.setIntent({ kind: "commit-vs-commit",
  from: plan.baseOid ?? plan.oldestOid, to: plan.newestOid })`.
- **Cherry-pick N onto current** → `confirm` → `cherryPickMany(plan.oids)`.
- **Squash N into one…** → disabled (grey, no-op) with a reason when
  `!contiguous || hasMerge || !baseOid`; else `prompt` message →
  `buildRebasePlan(commits, baseOid, { kind: "squash-range", oids, message })`
  → `setIntent({ kind: "rebase-plan", plan })`.
- divider, **Copy N SHAs** → clipboard join `\n`.

(Menu-item disabling: reuse whatever `ContextMenuItem` supports — a `disabled`
flag if present, else omit the item and add a titled note. Verify the type.)

## 5. History screen

`src/screens/History.tsx`:

- State: `const [sel, setSel] = React.useState<Selection>(emptySelection)`
  replacing `selected: number`.
- `order = React.useMemo(() => visible.map(c => c.oid), [visible])`.
- Prune effect: `setSel(prev => pruneSelection(prev, new Set(order)))` on
  `order`; also reset (`emptySelection`) on `repo?.id` change. Remove the old
  `setSelected(0)` shape-reset effect (pruning subsumes it) — but keep top
  selection sane: when pruning empties the selection, seed to `order[0]`.
- `primaryOid = primarySelectedKey(sel) ?? order[0] ?? null`;
  `current = visible.find(c => c.oid === primaryOid) ?? visible[0]`.
- `selectedIndex` for `usePaneList` = `visible.findIndex(primaryOid)`.
  `onSelect(i)` → `setSel(clickSelection(order, sel, order[i], {}))` (plain,
  collapses to one). `onActivate(i)`: if `sel.keys.length > 1` fire
  `commit-vs-commit` (from base of the selection, to newest) else the existing
  `commit-vs-wt`. `onExtendUp`/`onExtendDown`:
  `setSel(clickSelection(order, sel, order[clamp(idx∓1)], { range: true }))`.
- Row: `selected={sel.keys.includes(c.oid)}`,
  `onClick={(e) => setSel(clickSelection(order, sel, c.oid, { toggle:
  e.metaKey||e.ctrlKey, range: e.shiftKey }))}`,
  `onContextMenu`: if `c.oid ∈ sel.keys && sel.keys.length > 1` open
  `commitMultiMenuItems(sel.keys)`; else collapse to the row + existing single
  menu.
- Detail pane: when `sel.keys.length > 1`, render a multi summary + multi
  action buttons (see below) above the existing single detail; when 1, today's
  `PGCommitDetail` + `CommitActionRow`.
- `CommitActionRow`: extend to accept the selection. Single → unchanged. Multi
  → buttons wired to the same handlers as the menu (combined diff, cherry-pick
  N, squash…, copy N). Disable squash with a titled reason via
  `planCommitSelection`.

`src/design/git-components.tsx`: `PGCommitRow` — `onClick?: (e:
React.MouseEvent) => void` (thread the event; `data-selected`/`data-pg-row`
already present).

## 6. E2E

`e2e/specs/history-ops.e2e.ts` + `multiCherryRepo` fixture. Build the
selection with a plain row click (focuses the pane) then
`jsChord("Shift+ArrowDown")` — the embedded driver can't synthesize modifiers,
so the chord goes through the real keymap window listener. Two cases:

- *combined diff*: select two commits on `main`, click "View combined diff",
  assert the introduced file (`b.txt`) is listed on the CommitDiff screen.
- *multi cherry-pick*: scope the log to `feature` (ref selector), select its
  two commits, click "Cherry-pick 2", assert both files land on `main`.

## 7. Gates

`pnpm tsc --noEmit` · `pnpm test` · `pnpm vite build` · `pnpm exec tsc -p
e2e/tsconfig.json --noEmit` · `pnpm test:e2e:run --spec
e2e/specs/history-ops.e2e.ts`. Then squash to one Conventional Commit and open
the PR.
