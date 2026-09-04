# Settings: a navigable, searchable side menu

Status: approved, ready for an implementation plan.
Date: 2026-09-04.

## The problem

`src/screens/Settings.tsx` is 2,063 lines rendering thirteen flat cards —
thirty-seven fixed rows plus a dynamic forge host list — into one 820px-wide
scroll. Finding a setting means scrolling and reading. There is no search, no
structure above the card, and no way to link to a setting.

Three concrete symptoms:

- **Two rows are misfiled.** "Watch the working copy" and "Terminal shell" sit
  under *Pull & fetch*, which describes neither.
- **The layout helpers are duplicated.** `Section` and `Row` exist twice — once
  in `screens/Settings.tsx` and again in `features/forge/ForgeSettings.tsx`
  (lines 397 and 452). Two copies of the same layout drift.
- **Everything mounts at once.** All thirteen cards render whenever anyone opens
  Settings, so `cliShimStatus()`, `diagnosticsReport()` and the forge host reads
  all fire even for someone who came to change a theme.

Roughly 750 of those 2,063 lines are theme editing (`AppearanceSection`'s editor
half, `ThemeEditorDialog`, `ColorEditor`, `ColorField`).

## What we are building

A Rider/Chrome-shaped Settings screen: a grouped side menu on the left, one page
at a time on the right, and a search box that returns matching settings from
every page at once with their real working controls inline.

Three decisions were made up front and are not open in the plan:

1. **A grouped tree, three groups** — General, Git, Advanced — over ten pages.
2. **Chrome-style flat search results with live controls.** Typing replaces the
   right pane with every matching row, grouped under a `Group › Page` breadcrumb,
   each row rendering the control that actually changes the setting. The side menu
   dims pages with no match and badges the ones with hits.
3. **The last visited page is remembered** across restarts, stored per machine
   and never exported.

## Page taxonomy

Ten pages. Every one of today's rows lands on exactly one of them. Today's cards
survive *inside* pages, so a page may hold two or three cards.

| Group | Page | `id` | icon | Cards → rows |
|---|---|---|---|---|
| **General** | Appearance | `general.appearance` | `eye` | *Appearance*: Appearance (follow-OS mode), Light theme, Dark theme, Theme, UI density, Date format, Current position (HEAD), Zoom |
| | Keyboard & actions | `general.keyboard` | `kbd` | *Keyboard*: Keymap · *Custom actions*: Actions |
| | Updates | `general.updates` | `download` | *Updates*: Current version, Check for updates, Release channel |
| **Git** | Commit | `git.commit` | `commit` | *Identity*: Commit author, Saved identities · *Commit*: Append Signed-off-by, Ticket pattern, Sign commits |
| | Diff | `git.diff` | `diff` | *Diff*: Layout, Show, Context lines, Ignore whitespace, External diff tool |
| | Remote & sync | `git.remote` | `sync` | *Pull & fetch*: Default pull mode, Auto-stash before pull, Auto-fetch, Auto-fetch interval, Prune on fetch · *Push safety*: Confirm force-push · *Rebase*: Move dependent branches |
| | Integrations | `git.integrations` | `link` | *Integrations*: the forge host list (dynamic — see "Dynamic cards") |
| **Advanced** | Command line | `advanced.cli` | `terminal` | *Command line*: pgit command |
| | Workspace | `advanced.workspace` | `repo` | *Workspace*: Watch the working copy, Terminal shell |
| | Backup & diagnostics | `advanced.backup` | `info` | *Settings file*: Export settings, Import settings · *Diagnostics*: Environment, Log file |

Two placements were judgment calls, resolved and recorded so the plan does not
reopen them:

- **"Move dependent branches"** (`rebase --update-refs`) stays on *Remote & sync*,
  in its own *Rebase* card rather than mixed into *Pull & fetch*. `pull --rebase`
  is the common path that triggers it. It also fires from the Rebase screen, which
  is what makes *Commit* arguable — but *Remote & sync* is where it lives today and
  moving it would surprise people for no gain.
- **Command line stays a one-row page.** A one-row page usually smells, but
  `CliSection` is 114 lines of install button, path state and hint prose: a
  substantial page with one control, not a stub.

The two misfiled rows are corrected here — *Watch the working copy* and *Terminal
shell* leave *Pull & fetch* for *Workspace*.

## Architecture

### Declarative page meta, one component per page

Each page module exports pure data alongside its component:

```ts
export const meta: SettingsPageMeta = {
  id: "git.diff",
  group: "git",
  title: "Diff",
  icon: "diff",
  cards: [
    {
      id: "diff",
      title: "Diff",
      subtitle: "How diffs are rendered across the app.",
      rows: [
        { id: "diff.layout", label: "Layout", keywords: "split unified side by side" },
        { id: "diff.whitespace", label: "Ignore whitespace" },
        { id: "diff.tool", label: "External diff tool", keywords: "difftool meld kdiff3 vimdiff" },
      ],
    },
  ],
};
```

`nav/pages.ts` imports all ten `meta`s at module load and flattens them into the
search index. Search therefore never has to render anything to know what matches.
(The one exception is gate resolution, which needs the update capability at
runtime — see "Conditional rows and the Store gate".)

The alternative — letting each `Row` test the query itself and report its result
upward — was rejected: a card cannot know whether any of its children survived
until after they render, so header-hiding and the side-menu badge counts would
need counts reported back through state, a two-pass render with effect-ordering
fragility. `:has()` is not an escape hatch worth trusting on WebKitGTK, which
still has no `ResizeObserver`.

### Types

```ts
// features/settings/nav/types.ts
export type SettingsGroupId = "general" | "git" | "advanced";

export type SettingsPageId =
  | "general.appearance" | "general.keyboard" | "general.updates"
  | "git.commit" | "git.diff" | "git.remote" | "git.integrations"
  | "advanced.cli" | "advanced.workspace" | "advanced.backup";

/** The only conditional today. See "Conditional rows and the Store gate". */
export type SettingRowGate = "updatable";

export interface SettingRowMeta {
  /** Unique app-wide. Rendered as `data-setting-id`. */
  id: string;
  /** Must equal the rendered `SettingsRow`'s `label`. The guard test enforces it. */
  label: string;
  /** Synonyms the label does not contain. See "What search reads". */
  keywords?: string;
  /** Absent from the index and the DOM unless the gate is satisfied. */
  when?: SettingRowGate;
}

export interface SettingCardMeta {
  id: string;
  title: string;
  subtitle?: string;
  rows: SettingRowMeta[];
  /** Renders content search cannot index per-row. See "Dynamic cards". */
  dynamic?: boolean;
}

export interface SettingsPageMeta {
  id: SettingsPageId;
  group: SettingsGroupId;
  title: string;
  icon: IconName;
  cards: SettingCardMeta[];
}

export interface SettingsPageModule {
  meta: SettingsPageMeta;
  Page: React.ComponentType;
}
```

### What search reads

The query is trimmed, lowercased and split on whitespace into terms. **Every term
must be a substring** of the row's haystack (AND across terms), where the haystack
is `label + keywords + card.title + page.title`, lowercased.

Rolling the card and page titles into the haystack is deliberate: "diff" then
matches every row on the Diff page, which is the behaviour people expect, and it
removes any need for a "the page title matched but no rows did" special case.

**Hints are not indexed.** `Row`'s `hint` is a `React.ReactNode` and cannot be
flattened to text reliably. Any word that lives only in a hint but matters for
discovery — "GPG", "SSH", "fish", "pwsh", "difftool" — belongs in that row's
`keywords`. This is the one convention a contributor can quietly get wrong and the
guard test cannot catch, so it is documented at the top of `nav/types.ts`.

### How filtering renders

Because the matching set is computed from data before anything renders, there is
no counting pass. `SettingsResults` knows which pages have hits and how many (the
side-menu badge), then renders each hitting page with `visibleRowIds` in context:

- `SettingsRow` returns `null` when its id is not in the set.
- `SettingsCard` looks up its own declared row ids and returns `null` when the
  intersection with the set is empty.
- A `null` `visibleRowIds` means no search is active: render everything.

The shared pair is named `SettingsCard` / `SettingsRow`, renaming today's
`Section` / `Row`. The old names are too generic for a component that now reads a
filter context, and two files currently define both.

No state, no second render, no `:has()`.

Matched terms are highlighted in the label while a query is active — an
accent-tinted span, no layout shift.

### Dynamic cards

The Integrations card renders a data-driven forge host list — a host can hold
several accounts — so there are no fixed rows to index. It is marked
`dynamic: true`: it declares synthetic index rows ("Forge token", "GitHub",
"GitLab", "Personal access token", "Account") and renders **in full** whenever any
of them match, rather than filtering per-row. The guard test exempts dynamic cards
from its both-directions DOM check.

### Conditional rows and the Store gate

Two Updates rows do not always exist. `UpdatesSection`
(`src/screens/Settings.tsx:827`) branches on `updatesManagedExternally`: on a
Microsoft Store install it renders **only** a "Current version" row, dropping
"Check for updates" and "Release channel" entirely.

This is not a cosmetic detail, and getting it wrong would be a shipping
regression. CLAUDE.md is explicit: a Store install has no update surface — no
check, no chip, no panel, no release link, no Settings control — because
`StoreManaged` gates the CHECK, not just the install. Store policy 10.2.5 makes
*notifying* the violation, and v0.4.0 failed certification on exactly that.

**A search index is a new surface that reads `UpdateCapability`**, so it gates
like every other one. Two consequences:

- `SettingRowMeta.when` marks a gated row. `"Check for updates"` and
  `"Release channel"` carry `when: "updatable"`.
- The index is therefore **not** a module-load constant. `nav/pages.ts` exposes a
  `useSettingsIndex()` hook that resolves gates against `useUpdateStore`'s
  capability via `updatesManagedExternally`, so a gated-out row is absent from
  search results, absent from the side-menu badge count, and absent from the
  palette. A search for "update" on a Store build finds the version row and
  nothing that names a check.

Everything else stays a pure module-load computation; only the gate resolution
needs the hook. The page component keeps its existing `storeManaged` branch
unchanged — this adds no second place where that decision is made.

## File layout

`src/screens/Settings.tsx` drops from 2,063 lines to a roughly 150-line shell:
side menu, search box, page host.

```
src/features/settings/
  useSettingsStore.ts          + the settingsPage key
  layout/
    SettingsCard.tsx           Section + Row — ONE copy, filter-aware
  nav/
    types.ts                   SettingsPageId, SettingsGroupId, *Meta
    pages.ts                   the registry: groups → page modules → flat row index
    SettingsNav.tsx            side menu: search box + 3 groups + 10 rows
    SettingsResults.tsx        the flat search-results pane
  pages/
    appearance.tsx  keyboard.tsx  updates.tsx
    commit.tsx      diff.tsx     remote.tsx    integrations.tsx
    cli.tsx         workspace.tsx backup.tsx
  theme/
    ThemeEditorDialog.tsx  ColorEditor.tsx
```

Three consolidations are part of this change, not follow-ups:

- **`ForgeSettings.tsx`'s duplicated `Section`/`Row` are deleted** (lines 397 and
  452); it imports the shared pair and becomes the `git.integrations` page. That
  duplication is the reason the shared pair goes in
  `features/settings/layout/` and **not** in `src/design/`: it reads the settings
  filter context, and a feature context has no business inside the design system.
- `Mono`, `PathNote` and `ImportReport` move to the pages that use them.
- The theme-editing half of `AppearanceSection` (~750 lines with
  `ThemeEditorDialog`, `ColorEditor`, `ColorField`, `normalizeHex`) becomes
  `settings/theme/`, leaving the Appearance page as row markup.

No new top-level `src/features/` directory, so `test/docs.test.ts`'s
feature-directory invariant stays quiet — but `docs/dev/architecture.md` and
`docs/dev/frontend.md` are updated in the same commit regardless.

## Navigation, deep links and persistence

**A new nav intent.** `NavIntent` gains
`{ kind: "open-settings"; page?: SettingsPageId }`. `AppShell`'s `assertNever`
forces it to be routed and `AppShell.navroutes.test.tsx`'s mapped type over
`NavIntent["kind"]` forces a test entry — the pattern CLAUDE.md names. With no
`page`, it lands on the remembered one.

`{ kind: "switch-screen"; screen: "settings" }` keeps working (its `screen` is a
bare `string`) and also lands on the remembered page.

**One existing deep link is fixed.** `screens/Pulls.tsx` sends people to Settings
to add a forge token; it switches to `open-settings` with
`page: "git.integrations"` so it stops dumping them on an unrelated page.

**Persistence.** `settingsPage: SettingsPageId` joins `PersistedState` and
`DEFAULTS` (defaulting to `"general.appearance"`), and joins `NON_PORTABLE_KEYS`
with a comment in the house style: it is per-machine UI memory, exactly like
`lastCreateDir`, and has no business travelling in a file people share.
`useSettingsStore.export.test.ts`'s key snapshot is updated in the same commit.

`coerceSettings`' scalar type-guard compares against `typeof DEFAULTS[key]` and so
accepts any string. The **shell** therefore resolves an unrecognised id to the
first page at read time — the same defensive shape as
`normalizeThemePreference`'s "an unknown mode reads as fixed".

Throughout this spec, **"the first page"** means `general.appearance`: the first
page of the first group, and the `DEFAULTS` value.

The search query is transient `useState` and is never persisted.

**Command palette.** Ten "Settings: <page>" entries generated from the registry,
so `Mod+K` → "diff settings" jumps straight there.

## Chrome and layout

`PGPrimarySidebar` at 232px holds `PGSearchInput`, the three `PGSidebarGroup`s,
and a footer carrying the "Reset to defaults" button that lives in today's header.
The right pane keeps its `maxWidth: 820` and scrolls.

Two **additive** changes to `src/design/chrome.tsx`, both backward-compatible so
that no existing caller changes:

1. `PGSidebarGroup` gains optional controlled `open` + `onOpenChange`. A search
   must force groups with hits open. Uncontrolled when omitted, as today.
2. `PGSidebarRow` gains optional `role`, `tabIndex`, `onKeyDown`, `id` and
   `dimmed` passthrough — for the tree ARIA, roving focus, and the greyed
   "no matches here" state.

Extending these beats hand-rolling a settings side menu: hand-rolling is precisely
the `ForgeSettings` duplication this change deletes.

**Keyboard.** The side menu is `role="tree"` with `role="group"` /
`role="treeitem"` and `aria-selected`. Up/Down move between visible pages,
Left/Right collapse and expand a group, Enter and Space select. The search box is
the first focusable element in the screen.

**Deliberately not density-aware.** `PGSidebarRow` is a fixed `height: 22` and
does not read `--row-step`. Making it density-aware would move geometry in
Branches and RepoBrowser and break their density tests, so the settings side menu
inherits the same fixed height as every other sidebar in the app.

## Edge cases

- An unrecognised persisted page id resolves to the first page.
- A deep link naming a page that no longer exists resolves to the first page, no
  crash.
- A query matching nothing shows an empty state in the right pane with a "Clear
  search" button.
- An unrouted nav intent is caught at compile time by `assertNever`.
- The theme editor is a modal on the Appearance page; the side menu sits behind
  its overlay, so a page switch cannot happen underneath it.

**One intended behaviour change.** Today all thirteen cards mount together, so
`cliShimStatus()`, `diagnosticsReport()` and the forge host reads all fire
whenever anyone opens Settings. Per-page mounting means Diagnostics only runs its
report when someone looks at it — opening Settings gets cheaper. During a search
only pages with hits mount, so the worst case is bounded by today's behaviour.

## Testing

New:

1. **`settings.index.test.tsx` — the guard test.** Mounts every page, collects
   `[data-setting-id]` from the DOM, and asserts it equals that page's declared
   meta ids **in both directions** (dynamic cards exempt); ids unique app-wide;
   every page in exactly one group; every group non-empty; every `SettingsPageId`
   present in the registry via a mapped type, the way `AppShell.navroutes.test.tsx`
   does it. This is what makes the index unable to drift from what renders. The
   global `invoke` mock in `src/test/setup.ts` makes mounting all ten pages viable
   — today's tests already mount all thirteen cards at once.

   The both-directions check runs **under both update capabilities**, since gated
   rows legitimately render in one and not the other. Plus one absence assertion
   in the shape `test/privacy.test.ts` uses: with a store-managed capability, the
   resolved index contains no row gated `"updatable"` — so no search, badge or
   palette entry can name an update check on a Store build. That is the assertion
   standing between this feature and a repeat of the v0.4.0 certification
   failure, and it must fail the build if someone drops the gate.
2. **`settings.nav.test.tsx`** — the group tree renders; clicking switches page;
   only that page's rows are in the DOM; selection round-trips through
   `settingsPage`; an unrecognised id falls back.
3. **`settings.search.test.tsx`** — results span pages; breadcrumbs; badge counts;
   AND across terms; a `keywords`-only hit; the empty state; clearing; pages with
   no hits stay listed but dimmed rather than disappearing.

Reworked:

4. The ten `src/screens/Settings.*.test.tsx` files render their page component
   directly instead of the whole screen — smaller and faster, assertions preserved.
5. `AppShell.navroutes.test.tsx` gains `open-settings` (compile-forced).
6. `useSettingsStore.export.test.ts` — updated key snapshot, plus `settingsPage`
   denied on export **and** ignored on import.

E2E — one spec, one new case:

7. `openSettings(page?)` in `e2e/support/app.ts` navigates instead of waiting on
   `div*=Default pull mode`, which will only exist on *Remote & sync*; every call
   site is touched. The `settings-updates` testid moves onto the Updates page.
   Rows gain `data-setting-id`, which retires the fragile `clickSettingsToggleRow`
   DOM-walking helper in favour of a stable selector. One new case: click
   *Git › Diff*, then search "dark" and assert the results span two pages. Rebuild
   the snapshot, then run only `settings.e2e.ts` in Docker.

   **The new attributes inherit a known trap.** `test/e2eSelectors.test.ts`
   documents why `[data-testid="row"]*=text` silently matches nothing when a
   descendant's testid contains `row` as a substring. `data-setting-id` values are
   dotted and naturally prefix one another (`diff.context` sits inside
   `diff.contextLines`), so specs use **exact** `[data-setting-id="…"]` selectors
   and never the `*=` form. If a spec ever needs `*=` on one of these, extend
   `test/e2eSelectors.test.ts` to cover the attribute rather than relying on care.

Docs: `docs/dev/architecture.md` and `docs/dev/frontend.md` in the same commit.

## Suggested staging

This is a large change — a 2,063-line screen taken apart, plus a new navigation
model and a new search surface. It wants to be more than one PR, and the
implementation plan should split it roughly this way:

1. **Extract the layout pair and the theme editor.** `SettingsCard`/`SettingsRow`
   in one place, `ForgeSettings`' duplicates deleted, `settings/theme/` split out.
   Pure refactor, no behaviour change, existing tests stay green as-is.
2. **Split the screen into ten pages behind the registry**, still rendered as one
   scroll. Adds `meta`, the guard test, and the page components; reworks the ten
   `Settings.*.test.tsx` files.
3. **Add the side menu and per-page rendering** — the nav intent, the persisted
   `settingsPage`, the palette entries, the two `chrome.tsx` prop additions, and
   the e2e helper change.
4. **Add search** — the index hook, the gate, `SettingsResults`, highlighting.

Stage 1 landing on its own is worth it regardless: it deletes the duplication and
is independently reviewable.

## Out of scope

Deliberately excluded, with reasons:

- **Per-setting palette entries.** Thirty-eight rows would swamp the palette;
  page-level entries are enough.
- **Fuzzy or typo-tolerant matching.** Substring AND is plenty at this size.
- **Indexing hint prose.** `keywords` covers what matters; see "What search reads".
- **Nesting beyond the three groups.** Ten pages do not need a deeper tree.
- **Per-repo settings scope.** That is #233's own concern.
- **Density on `PGSidebarRow`.** It would move geometry in other sidebars.
- **A keyboard shortcut for the search box.** `Mod+F` is `diff.find` and
  `Mod+Shift+F` is `tree.find`, both pane-scoped. A pane-scoped `settings.search`
  on `Mod+F` would not break `presets.test.ts` — there is no exact reverse-map
  assertion on that chord — but two pane-scoped actions sharing a chord needs a
  dispatcher-precedence decision, and that deserves its own change.
