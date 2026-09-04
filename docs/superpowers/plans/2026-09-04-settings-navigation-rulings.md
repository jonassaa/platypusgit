# Settings Navigation — decisions taken during implementation

Companion to `2026-09-04-settings-navigation.md` (the plan) and
`../specs/2026-09-04-settings-navigation-spec.md` (the spec).

The plan was written before any of its code ran, and twenty-six decisions had to
be made while executing it — mostly because a plan-supplied code block was
defective, or because a later task exposed something an earlier one had assumed.
This file records each one so a reviewer can tell a deliberate departure from a
mistake. They are in the order they were made.

Where a ruling corrects the plan, the plan text is left as it was: it is a
historical document, and rewriting it would hide the fact that the correction
was needed. The spec, by contrast, **was** amended where it stated something
false about the shipped code (see Rulings M and W).

## The rulings

**A — highlight terms travel in their own context.** The plan had the filter
context grow a `highlight?: string[]` field, but that context is a bare
`ReadonlySet<string> | null` consumed in three places; reshaping it bought
nothing. A separate `SettingsHighlightContext` instead. *Cost if wrong: one
extra small module.*

**B — `PGSidebarRow` gains `testId`, not `id`.** A DOM `id` of `git.diff` needs
CSS dot-escaping, and `PGToggle`/`PGSearchInput` already establish a `testId`
prop rendering `data-testid`. E2E selects `[data-testid="settings-nav-<pageId>"]`.
*Cost if wrong: one editable selector string.*

**C — the plan's `highlightLabel` was buggy and was not copied.** It called
`.test()` on a `/g` regex, which advances `lastIndex`, so a label containing the
term twice highlighted wrongly. Reimplemented by splitting on a capturing regex
and testing membership in a lowercased `Set`. *Cost if wrong: none — strictly
more correct.*

**D — `ForgeSettings` keeps a private `ForgeRow`.** The plan said to delete both
copies of the duplicated layout pair, having compared them only by name. The
forge copy carries `testId` and `badge` props `SettingsRow` cannot take, because
`SettingsRow.label` must stay a plain `string` for the guard test's
label-equality assertion. `Section` is deleted outright and every *settings* row
goes through `SettingsRow`; what remains is a per-account list row that was never
a settings row. *Cost if wrong: ~55 lines of duplicated row markup survive.*

**E — the guard test could not run as written.** Three of its four cases walked
all ten `PAGE_ORDER` ids and dereferenced `PAGES[pageId]`, which is `undefined`
for nine of them until the registry is complete. A `REGISTERED` filter carried
the intermediate tasks, reverted once all ten pages existed. *Cost if wrong:
none — without it Task 3 could not go green at all.*

**F — the label-equality assertion the docstring already promised.**
`SettingRowMeta.label` claimed "the guard test enforces it", but nothing compared
them. Added rather than softening the comment: search matches on `meta.label`, so
a drifted label makes search match text the user cannot see. *Cost if wrong: the
check reads `SettingsRow`'s DOM shape, so markup changes break the test rather
than the feature.*

**G — gated rows belong in the guard test's declared set.** The plan filtered
`when`-gated rows out of `declaredRowIds`, but the test mounts pages under the
default update capability — `null`, which `updatesManagedExternally` answers
`false` — so the ordinary Updates branch renders and those rows *do* appear.
Excluding them made `rendered` a superset of `declared`. *Cost if wrong: none —
it strictly widens coverage.*

**H — conditional rows get render states, not `dynamic: true`.** Appearance's
light/dark pair and its single theme picker are mutually exclusive, so its eight
declared rows can never all render at once. Marking the card `dynamic` would have
passed the guard test while silently changing how search renders that card (a
dynamic card renders in full when any row matches) and dropping drift protection
on the largest card. `PAGE_RENDER_STATES` instead: per-state subset check plus
cross-state union check. *Cost if wrong: more test machinery than a one-word
flag.*

**I — `Mono`/`PathNote` go to a shared `layout/text.tsx`.** The plan had them
exported from `pages/cli.tsx` for `pages/backup.tsx` to import — one page
importing a helper from a sibling page, and it would have left three copies to
reconcile after an earlier task was forced to duplicate `Mono`. *Cost if wrong:
one extra small module.*

**J — the guard test's unmocked IPC.** Three commands were firing unmocked and
being swallowed by empty `catch` blocks; only one had been fixed. All three
mocked, in the one remaining task that touched that file. *Cost if wrong: two
lines in a `beforeEach`.*

**K — the ordered page-id list is pinned in both places.** Breaking an import
cycle put a private ordered list in `nav/types.ts` alongside the `GROUPS`-derived
`PAGE_ORDER` in `nav/pages.ts`. The existing mapped-type check catches a missing
union member but not the two lists drifting in *order*, which would leave
`FIRST_PAGE` disagreeing with the side menu's first row. *Cost if wrong: one
assertion.*

**L — the palette entries carry no keymap actions.** The plan registered ten
`nav.settings.<page>` actions, but `presets.test.ts` requires every catalog action
to be bound in both built-in presets and the number chords are full — so those ten
would either fail that test or force an exemption weakening a real guard, for
entries nobody wants a chord for. `PaletteItem.actionId` is optional and its `run`
is documented as "may fire a nav intent". *Cost if wrong: the rows show no
shortcut chip, which is correct because they have no shortcut.*

**M — the nav rows are density-aware; the spec's reason for skipping it was
false.** The spec excused them from CLAUDE.md's "new list-row surfaces opt into UI
density" rule on the grounds that changing `PGSidebarRow` would break Branches and
RepoBrowser geometry tests. Those components have no other consumers, so the
change was free — and a side menu ignoring the density setting offered on the
Appearance page in this same branch would be inconsistent with every other list
surface. The spec was amended. *Cost if wrong: nav row height tracks the density
setting, which is the documented intent.*

**N — one Docker e2e run, at the end.** The e2e code changes and the e2e run were
split across two tasks, because CLAUDE.md says run e2e only when done developing
and a cold container build is serialized across every worktree on the machine.
*Cost if wrong: an e2e breakage surfaces one task later than it could have.*

**O — `SettingsNav` owns its group open-state.** Collapsing a group from the
keyboard was first done by synthesising a `.click()` on `PGSidebarGroup`'s header
found via `closest('[role="group"]')`, coupling the nav to another component's
markup. Full control instead, with `open` computed as *searching ? has-hits :
local state*. *Cost if wrong: one small state object; `PGSidebarGroup`'s
uncontrolled path ends up with no in-app consumer, which is fine.*

**P — `visible` filters on group-open state only, never on match counts.** The
plan filtered zero-hit pages out of the keyboard-navigable list while still
rendering them dimmed — so arrow keys would skip a row the user can click, and
`visible.indexOf(id)` would return `-1` for a focusable row. *Cost if wrong:
arrows traverse dimmed pages during a search.*

**Q — `useSettingsIndex` in its own module.** The plan appended it to
`nav/pages.ts`, which `match.ts` imports — the exact cycle the plan itself flagged
as a risk, and cycles here manifest as a module-level constant silently reading
`undefined` rather than as an error. *Cost if wrong: one extra small file.*

**R — the "spans pages" test needed a query that spans pages.** The plan asserted
`"dark"` matches more than one page; it occurs only on `general.appearance`.
Replaced with `"version"`, verified against the real metas. *Cost if wrong: none —
the test then asserts the property it claims to.*

**S — group header clicks during a search do not write local state.** The
displayed state ignores local state while searching, so letting a click write it
would corrupt what groups spring back to when the query clears. *(Its open-state
formula was superseded by T.)* *Cost if wrong: a header click during a search
appears inert.*

**T — during a search, all groups are forced open.** S said "open iff the group
has hits", but force-closing a zero-hit group *unmounts* its pages, hiding them —
contradicting P and the approved design, where no-hit pages stay listed but
dimmed. The inconsistency was in the plan's own nav snippet, which both
force-closed no-hit groups and filtered no-hit pages out of `visible` — two
different ways of hiding what the spec said to dim. *Cost if wrong: a fully
expanded tree during a search; the alternative hides the settings being searched
for.*

**U — two throwaway checks became committed tests.** The repeated-occurrence
highlight check and the "a results-pane control really mutates the store" check
were framed alongside the plant-a-violation pattern, so they were correctly
discarded after being observed. Unlike a plant — which proves a test *can* fail —
these assert desired behaviour and belong in the suite. *Cost if wrong: three
more test cases.*

**V — this branch is not rebased.** `origin/main` advanced during the work and
touched files this branch also edits, but force-pushing was unavailable and
CLAUDE.md forbids merge commits on a feature branch. Doc edits were kept additive
instead, and any conflict is resolved when the PR branches are cut from current
`main`. Verified there is no *semantic* conflict: `CustomActionsSettings()` still
takes no props. *Cost if wrong: a text-level doc conflict at PR creation; the
branch stays behind `main`, which this repo's workflow explicitly tolerates.*

**W — the Store gate had a mount-order window that per-page mounting
introduced.** `loadCapability()` is called from exactly one place — the Updates
page's mount effect — so the old single-scroll screen primed the capability
whenever Settings opened. Per-page mounting broke that, leaving `capability` at
`null` on a Store install, which `updatesManagedExternally` answers `false`: "Check
for updates" and "Release channel" were searchable with live controls for ~2s
after launch on any Store install, and **permanently** when `updateCheckMode` is
`manual`/`never` until someone visited that page. The spec's claim that the index's
exposure window matched the Updates card's was true only while everything mounted
together. Fixed by priming from the shell **and** having the index alone treat
`null` as gated out. *Cost if wrong: see Z.*

**X — Appearance's mutually-exclusive rows are gated.** Declared ungated, they let
a search report a hit and render an empty card: on a fresh install, "light theme"
reported one result and rendered none. `SettingRowGate` gained theme-mode members,
and `buildIndex` now takes `Record<SettingRowGate, boolean>` so a forgotten gate is
a compile error rather than a silent no-op. *Cost if wrong: two more gate members
and a wider signature.*

**Y — the drift guard now covers cards, not just rows.** `cardHasVisibleRow`
returns `false` for an unregistered card, so a rendered card id disagreeing with
its declared one would silently remove every matching row from search with no test
failing — and card titles, duplicated across `meta` and JSX in fifteen pairs, feed
the search haystack. *Cost if wrong: three more assertions.*

**Z — accepting the cost of W's asymmetry.** If `get_update_capability` fails,
`capability` stays `null` and search can never surface those two update rows on an
ordinary install. Acceptable: the shell now primes on mount so IPC failure is the
only path there, the Updates page still shows both rows so they remain reachable by
navigation, and the opposite direction risks naming an update check on a Store
build — a certification failure rather than a discoverability nuisance. *Cost if
wrong: on an install where that IPC is broken, two update settings are
browse-only.*

## What the review loop caught

Worth recording, because it argues for the shape of the process rather than for
any one decision: of the twenty-six rulings, **eleven** (C, E, F, G, H, K, P, R, T,
W, Y) exist because a plan-supplied code block or assertion was wrong — nine of
them in test scaffolding, which is where a plan written without running anything is
weakest. Two more (D, M) exist because the plan asserted something false about the
existing codebase.

Three defects were found by implementers pushing back rather than complying: the
`dynamic: true` diagnosis (H), the S/P contradiction (T), and — after the fix wave
— the observation that the controller's own prescribed Store-gate test would have
passed for the wrong reason, since a *known* store-managed capability makes the
Updates page self-gate and the DOM-absence assertion vacuous. The badge-count
assertion is the load-bearing one there, and the test says so.
