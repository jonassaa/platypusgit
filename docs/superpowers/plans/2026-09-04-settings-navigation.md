# Settings Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the 2,063-line single-scroll Settings screen into a Rider/Chrome-shaped screen — a three-group side menu over ten pages, with a search box that returns matching settings from every page at once with their real working controls.

**Architecture:** Each page module exports pure `meta` data alongside its React component, so `nav/pages.ts` can flatten a search index at module load without rendering anything. A guard test mounts every page and asserts the DOM's `data-setting-id` set equals the declared ids in both directions, which is what stops the index drifting. Filtering is a precomputed set of visible row ids handed down a context; `SettingsRow` and `SettingsCard` self-hide against it, so there is no counting pass and no second render.

**Tech Stack:** React 19 + TypeScript, Zustand, Vitest + `@testing-library/react` (jsdom), WebdriverIO for e2e, the in-house `@/design` system.

**Spec:** `docs/superpowers/specs/2026-09-04-settings-navigation-spec.md`

## Global Constraints

Copied verbatim from the spec and CLAUDE.md. Every task's requirements implicitly include these.

- **The three groups are `general`, `git`, `advanced`.** Ten page ids, exactly: `general.appearance`, `general.keyboard`, `general.updates`, `git.commit`, `git.diff`, `git.remote`, `git.integrations`, `advanced.cli`, `advanced.workspace`, `advanced.backup`.
- **"The first page" always means `general.appearance`** — first page of the first group, and the `DEFAULTS` value for `settingsPage`.
- **A Microsoft Store install has NO update surface.** `StoreManaged` gates the CHECK, not just the install: Store policy 10.2.5 makes *notifying* the violation, and v0.4.0 failed certification on it. The search index reads `UpdateCapability`, so it gates on `updatesManagedExternally` — the *same* predicate the Updates card already uses. Never re-spell the condition as `=== "store-managed"`.
- **Never `window.confirm` / `window.prompt`** — use `pgConfirm` / `pgPrompt` / `pgChoose` from `@/design`.
- **No native `<select>` / `<option>` in shipped `src/`** — `PGSelect`. A guard test enforces it.
- **Never hardcode the accent hue.** CSS vars / theme tokens only.
- **One error banner** — `PGErrorBanner` from `@/design`.
- **Design system lives in `src/design/`**, imported from `@/design`. Do NOT add `src/components/ui/`.
- **`useRepoStore` holds exactly ONE repository's state.** A new per-repo field must join `RepoSlice`/`emptySlice`. This plan adds none.
- **A new `NavIntent` kind must be routed in `AppShell`** — compile-enforced via `assertNever` plus `AppShell.navroutes.test.tsx`.
- **E2E always runs in Docker**, never natively. Rebuild the snapshot after any `src/` change: `~/Library/pnpm/pnpm test:e2e:docker build`, then run only the relevant spec.
- **Commit style:** `feat(scope): …` / `fix(scope): …` / `refactor(scope): …` / `test: …` / `docs: …`, imperative subject under 72 chars, `Co-Authored-By: Claude <noreply@anthropic.com>` trailer.
- **Toolchain paths:** this worktree is an isolated session where CLAUDE.md's `export PATH="$HOME/..."` is refused by the sandbox guard. Invoke tools by absolute path: `~/Library/pnpm/pnpm`, `~/.cargo/bin/cargo`. Avoid compound heredocs and `sed` with command-substituted arguments — the guard refuses both.
- **`node_modules` is absent in a fresh worktree.** Run `~/Library/pnpm/pnpm install` once before Task 1.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `src/features/settings/layout/SettingsCard.tsx` | The ONE `SettingsCard` + `SettingsRow` pair, filter-aware. Replaces two duplicated copies. |
| `src/features/settings/layout/filterContext.tsx` | `SettingsFilterContext` — carries `visibleRowIds` down to cards and rows. |
| `src/features/settings/theme/ThemeEditorDialog.tsx` | The theme editor modal, lifted out of the screen. |
| `src/features/settings/theme/ColorEditor.tsx` | `ColorEditor`, `ColorField`, `normalizeHex`. |
| `src/features/settings/nav/types.ts` | `SettingsGroupId`, `SettingsPageId`, `SettingRowGate`, `SettingRowMeta`, `SettingCardMeta`, `SettingsPageMeta`, `SettingsPageModule`. |
| `src/features/settings/nav/pages.ts` | The registry: `GROUPS`, `PAGES`, `ROW_INDEX`, `CARD_ROW_IDS`, `useSettingsIndex()`. |
| `src/features/settings/nav/match.ts` | Pure matching: `matchRows(query, index)`. |
| `src/features/settings/nav/SettingsNav.tsx` | The side menu — search box, three groups, ten rows. |
| `src/features/settings/nav/SettingsResults.tsx` | The flat search-results pane. |
| `src/features/settings/pages/appearance.tsx` | `general.appearance` |
| `src/features/settings/pages/keyboard.tsx` | `general.keyboard` |
| `src/features/settings/pages/updates.tsx` | `general.updates` |
| `src/features/settings/pages/commit.tsx` | `git.commit` |
| `src/features/settings/pages/diff.tsx` | `git.diff` |
| `src/features/settings/pages/remote.tsx` | `git.remote` |
| `src/features/settings/pages/integrations.tsx` | `git.integrations` — absorbs `ForgeSettings`. |
| `src/features/settings/pages/cli.tsx` | `advanced.cli` |
| `src/features/settings/pages/workspace.tsx` | `advanced.workspace` |
| `src/features/settings/pages/backup.tsx` | `advanced.backup` |
| `src/screens/settings.index.test.tsx` | The guard test. |
| `src/screens/settings.nav.test.tsx` | Side-menu behaviour. |
| `src/screens/settings.search.test.tsx` | Search behaviour. |

**Modified:**

| Path | Change |
|---|---|
| `src/screens/Settings.tsx` | 2,063 lines → ~150-line shell (side menu + page host). |
| `src/features/forge/ForgeSettings.tsx` | Duplicated `Section` (397–451) and `Row` (452–507) deleted; becomes the integrations page. |
| `src/features/settings/useSettingsStore.ts` | `settingsPage` joins `PersistedState`, `DEFAULTS`, `NON_PORTABLE_KEYS`. |
| `src/features/nav/useNavStore.ts:48` | `NavIntent` gains `open-settings`. |
| `src/AppShell.tsx:407` | Routes `open-settings`. |
| `src/screens/Pulls.tsx:226` | Deep-links to `git.integrations`. |
| `src/features/keymap/actions.ts` | Ten `nav.settings.*` actions. |
| `src/features/palette/commands.ts` | Ten "Settings: <page>" entries. |
| `src/design/chrome.tsx` | `PGSidebarGroup` controlled `open`; `PGSidebarRow` a11y + `dimmed` passthrough. |
| `e2e/support/app.ts:637` | `openSettings(page?)` navigates. |
| `e2e/specs/settings.e2e.ts` | 7 call sites get a page; one new nav+search case. |
| The ten `src/screens/Settings.*.test.tsx` | Render their page component; `mockRestOfSettings()` deleted. |
| `docs/dev/architecture.md`, `docs/dev/frontend.md` | Document the new structure. |

**Stage → PR mapping.** Tasks 1–2 = PR 1 (extraction, no behaviour change). Tasks 3–7 = PR 2 (pages behind the registry, still one scroll). Tasks 8–11 = PR 3 (side menu, per-page rendering). Tasks 12–14 = PR 4 (search).

---

## Task 1: Extract the one `SettingsCard` / `SettingsRow` pair

Today `Section` and `Row` are defined twice — `src/screens/Settings.tsx:1952-2064` and `src/features/forge/ForgeSettings.tsx:397-507`. This deletes one copy, renames the pair, and adds the `id` attribute every later task depends on.

**Files:**
- Create: `src/features/settings/layout/SettingsCard.tsx`
- Create: `src/features/settings/layout/filterContext.tsx`
- Create: `src/features/settings/layout/SettingsCard.test.tsx`
- Modify: `src/screens/Settings.tsx` (delete 1950–2064; import instead)
- Modify: `src/features/forge/ForgeSettings.tsx` (delete 397–507; import instead)

**Interfaces:**
- Consumes: nothing.
- Produces: `SettingsCard({ id, title, subtitle?, children })`, `SettingsRow({ id, label, hint?, control, stacked? })`, `SettingsFilterProvider({ visibleRowIds, children })`, `useSettingsFilter(): ReadonlySet<string> | null`. `SettingsCard` renders `data-settings-card={id}`; `SettingsRow` renders `data-setting-id={id}`.

- [ ] **Step 1: Write the failing test**

Create `src/features/settings/layout/SettingsCard.test.tsx`:

```tsx
// The ONE card/row layout pair (was duplicated in Settings.tsx and
// ForgeSettings.tsx). The `data-setting-id` attribute is load-bearing: the
// guard test in settings.index.test.tsx reads it, and e2e selects rows by it.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SettingsCard, SettingsRow } from "./SettingsCard";
import { SettingsFilterProvider } from "./filterContext";

describe("SettingsCard / SettingsRow", () => {
  it("stamps the card and row ids onto the DOM", () => {
    render(
      <SettingsCard id="diff" title="Diff">
        <SettingsRow id="diff.layout" label="Layout" control={<span>ctl</span>} />
      </SettingsCard>,
    );
    expect(document.querySelector('[data-settings-card="diff"]')).toBeTruthy();
    expect(document.querySelector('[data-setting-id="diff.layout"]')).toBeTruthy();
    expect(screen.getByText("Layout")).toBeTruthy();
  });

  it("renders everything when no filter is active", () => {
    render(
      <SettingsFilterProvider visibleRowIds={null}>
        <SettingsCard id="diff" title="Diff">
          <SettingsRow id="diff.layout" label="Layout" control={<span>a</span>} />
          <SettingsRow id="diff.context" label="Context lines" control={<span>b</span>} />
        </SettingsCard>
      </SettingsFilterProvider>,
    );
    expect(screen.getByText("Layout")).toBeTruthy();
    expect(screen.getByText("Context lines")).toBeTruthy();
  });

  it("hides a row whose id is not in the visible set", () => {
    render(
      <SettingsFilterProvider visibleRowIds={new Set(["diff.layout"])}>
        <SettingsCard id="diff" title="Diff">
          <SettingsRow id="diff.layout" label="Layout" control={<span>a</span>} />
          <SettingsRow id="diff.context" label="Context lines" control={<span>b</span>} />
        </SettingsCard>
      </SettingsFilterProvider>,
    );
    expect(screen.getByText("Layout")).toBeTruthy();
    expect(screen.queryByText("Context lines")).toBeNull();
    // The card survives because one of its rows did.
    expect(screen.getByText("Diff")).toBeTruthy();
  });

  it("hides the whole card when none of its rows survive", () => {
    render(
      <SettingsFilterProvider visibleRowIds={new Set(["other.row"])}>
        <SettingsCard id="diff" title="Diff">
          <SettingsRow id="diff.layout" label="Layout" control={<span>a</span>} />
        </SettingsCard>
      </SettingsFilterProvider>,
    );
    expect(screen.queryByText("Diff")).toBeNull();
    expect(document.querySelector('[data-settings-card="diff"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `~/Library/pnpm/pnpm vitest run --project unit src/features/settings/layout/SettingsCard.test.tsx`

Expected: FAIL — `Failed to resolve import "./SettingsCard"`.

- [ ] **Step 3: Create the filter context**

Create `src/features/settings/layout/filterContext.tsx`:

```tsx
import React from "react";

/**
 * The set of row ids a search left visible, or `null` for "no search active —
 * render everything".
 *
 * A SET rather than the query string: matching happens once, up front, against
 * the declared index (`nav/pages.ts`), so a card can decide whether to render
 * its header BEFORE its children render. Letting each row test the query itself
 * would mean a card only learns whether it is empty after the fact, which costs
 * a second render pass and an effect-ordering hazard for no benefit.
 */
const SettingsFilterContext = React.createContext<ReadonlySet<string> | null>(null);

export function SettingsFilterProvider({
  visibleRowIds,
  children,
}: {
  visibleRowIds: ReadonlySet<string> | null;
  children: React.ReactNode;
}) {
  return (
    <SettingsFilterContext.Provider value={visibleRowIds}>
      {children}
    </SettingsFilterContext.Provider>
  );
}

export function useSettingsFilter(): ReadonlySet<string> | null {
  return React.useContext(SettingsFilterContext);
}
```

- [ ] **Step 4: Create the card/row pair**

Create `src/features/settings/layout/SettingsCard.tsx`. Move the bodies of `Section` (`src/screens/Settings.tsx:1952-2013`) and `Row` (`2014-2064`) **verbatim** — every inline style unchanged, so the rendered geometry is byte-identical and the density e2e case keeps measuring the same thing — then add the id attributes and the filter checks:

```tsx
import React from "react";

import { useSettingsFilter } from "./filterContext";

/**
 * The one card/row layout pair for the Settings screen.
 *
 * Was defined twice — `screens/Settings.tsx` and `features/forge/
 * ForgeSettings.tsx` — which is exactly how the two drifted. It lives under
 * `features/settings/` and NOT in `src/design/` on purpose: it reads the
 * settings filter context, and a feature context has no business inside the
 * design system.
 */
export function SettingsCard({
  id,
  title,
  subtitle,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const visible = useSettingsFilter();
  // A card whose declared rows all filtered out renders nothing — header
  // included. `CARD_ROW_IDS` is the declared truth, so this decision is made
  // before the children render.
  if (visible && !cardHasVisibleRow(id, visible)) return null;
  return (
    <section
      data-settings-card={id}
      style={{
        marginTop: 20,
        background: "var(--bg-1)",
        border: "1px solid var(--border-0)",
        borderRadius: "var(--r-4)",
        overflow: "hidden",
      }}
    >
      <header
        style={{
          padding: "12px 16px 10px",
          borderBottom: "1px solid var(--border-0)",
          background: "var(--bg-2)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-11)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: "var(--fg-1)",
            fontWeight: 600,
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div
            style={{ marginTop: 4, fontSize: "var(--fs-12)", color: "var(--fg-3)" }}
          >
            {subtitle}
          </div>
        )}
      </header>
      <div>{children}</div>
    </section>
  );
}

/**
 * `stacked` puts the control on its own full-width line under the label. The
 * inline layout gives the control whatever width it asks for (`flexShrink: 0`),
 * which is right for a button group or a select but crushes the label column to
 * a word per line once the control is intrinsically wide — a live preview of a
 * real History row, say.
 */
export function SettingsRow({
  id,
  label,
  hint,
  control,
  stacked,
}: {
  id: string;
  label: string;
  hint?: React.ReactNode;
  control: React.ReactNode;
  stacked?: boolean;
}) {
  const visible = useSettingsFilter();
  if (visible && !visible.has(id)) return null;
  return (
    <div
      data-setting-id={id}
      style={{
        display: "flex",
        flexDirection: stacked ? "column" : "row",
        alignItems: stacked ? "stretch" : "flex-start",
        gap: stacked ? 10 : 16,
        padding: "12px 16px",
        borderBottom: "1px solid var(--border-0)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{ fontSize: "var(--fs-13)", color: "var(--fg-0)", fontWeight: 500 }}
        >
          {label}
        </div>
        {hint && (
          <div
            style={{
              marginTop: 3,
              fontSize: "var(--fs-11)",
              color: "var(--fg-3)",
              lineHeight: 1.5,
            }}
          >
            {hint}
          </div>
        )}
      </div>
      <div style={stacked ? { minWidth: 0 } : { flexShrink: 0, paddingTop: 2 }}>
        {control}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Add the temporary card-membership helper**

`CARD_ROW_IDS` does not exist until Task 3, and Task 1 must not import from a module it precedes. Add this to the bottom of `SettingsCard.tsx`:

```tsx
/**
 * Declared row ids per card, registered by `nav/pages.ts` at module load.
 *
 * A registry rather than a static import because the dependency runs the other
 * way: the pages import this layout pair, so this file cannot import them
 * without a cycle.
 */
const CARD_ROWS = new Map<string, readonly string[]>();

export function registerCardRows(cardId: string, rowIds: readonly string[]): void {
  CARD_ROWS.set(cardId, rowIds);
}

function cardHasVisibleRow(cardId: string, visible: ReadonlySet<string>): boolean {
  const declared = CARD_ROWS.get(cardId);
  // An unregistered card is one nothing declared — during a search it has no
  // matching rows by definition, so hiding it is right. Before Task 3 wires the
  // registry no search exists, and `visible` is always null.
  if (!declared) return false;
  return declared.some((id) => visible.has(id));
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `~/Library/pnpm/pnpm vitest run --project unit src/features/settings/layout/SettingsCard.test.tsx`

Expected: PASS — the four cases above.

The "hides the whole card" case needs the card registered. Add to that test, before `render`:

```tsx
import { registerCardRows } from "./SettingsCard";
// …inside the describe, above the two filtering cases:
registerCardRows("diff", ["diff.layout", "diff.context"]);
```

- [ ] **Step 7: Point `Settings.tsx` at the shared pair**

In `src/screens/Settings.tsx`:
1. Delete lines 1950–2064 (the `// ─── Shared layout helpers ───` comment, `Section`, `Row`).
2. Add the import:

```tsx
import {
  SettingsCard,
  SettingsRow,
} from "@/features/settings/layout/SettingsCard";
```

3. Rename every usage in the file: `<Section` → `<SettingsCard`, `</Section>` → `</SettingsCard>`, `<Row` → `<SettingsRow`.
4. Give every card and row its id. Use exactly these — later tasks and the guard test depend on the spelling:

| Card `id` | Row ids, in render order |
|---|---|
| `pull` | `pull.mode`, `pull.autostash`, `workspace.watch`, `workspace.shell`, `fetch.auto`, `fetch.interval`, `rebase.updateRefs`, `fetch.prune` |
| `push` | `push.confirmForce` |
| `commit` | `commit.signoff`, `commit.ticket`, `commit.sign` |
| `diff` | `diff.layout`, `diff.show`, `diff.context`, `diff.whitespace`, `diff.tool` |
| `actions` | `actions.list` |
| `identity` | `identity.author`, `identity.saved` |
| `keyboard` | `keyboard.keymap` |
| `cli` | `cli.pgit` |
| `diagnostics` | `diagnostics.environment`, `diagnostics.log` |
| `updates` | `updates.version`, `updates.check`, `updates.channel` |
| `backup` | `backup.export`, `backup.import` |
| `appearance` | `appearance.follow`, `appearance.light`, `appearance.dark`, `appearance.theme`, `appearance.density`, `appearance.dateFormat`, `appearance.headMarks`, `appearance.zoom` |

`workspace.watch` and `workspace.shell` keep those ids while still rendering inside the `pull` card — Task 6 moves them to the Workspace page, and an id that already names its destination avoids a rename then.

The store-managed branch of `UpdatesSection` (`759-957`) renders its own card; give it card id `updates` and row id `updates.version` too, so both branches agree.

- [ ] **Step 8: Point `ForgeSettings.tsx` at the shared pair**

In `src/features/forge/ForgeSettings.tsx`:
1. Delete lines 397–507 (its private `Section` and `Row`).
2. Add the same import.
3. Rename usages as above. The card gets `id="integrations"`; the two rows get `integrations.none` (`label="No forge detected"`) and `integrations.error` (`label="Last error"`).
4. Leave `data-testid="settings-forge"` on line 80 exactly where it is — `e2e/specs/pulls.e2e.ts:94` waits on it.

- [ ] **Step 9: Verify nothing changed behaviourally**

Run: `~/Library/pnpm/pnpm tsc --noEmit`
Expected: no errors.

Run: `~/Library/pnpm/pnpm vitest run --project unit src/screens src/features/forge src/features/settings`
Expected: PASS. These tests assert rendered text and geometry, both untouched — a failure here means a style line was altered during the move, not that a test needs updating.

- [ ] **Step 10: Commit**

```bash
git add src/features/settings/layout src/screens/Settings.tsx src/features/forge/ForgeSettings.tsx
git commit -m "refactor(settings): one card/row layout pair, not two" -m "Why: Section and Row were defined twice — screens/Settings.tsx and
features/forge/ForgeSettings.tsx — which is how the two drifted. The
shared pair also carries the data-setting-id attribute the search index
and e2e selectors are about to depend on.

Styles moved verbatim: rendered geometry is unchanged, which is what the
density e2e case measures." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: Lift the theme editor out of the screen

~750 of `Settings.tsx`'s lines are theme editing. This is a pure move.

**Files:**
- Create: `src/features/settings/theme/ThemeEditorDialog.tsx`
- Create: `src/features/settings/theme/ColorEditor.tsx`
- Modify: `src/screens/Settings.tsx` (delete 1480–1949; import instead)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `ThemeEditorDialog` (props unchanged from today's local component), `ColorEditor`, `ColorField`, `normalizeHex`.

- [ ] **Step 1: Move `ColorEditor`, `ColorField` and `normalizeHex`**

Create `src/features/settings/theme/ColorEditor.tsx`. Move `src/screens/Settings.tsx:1772-1831` (`ColorEditor`), `1832-1937` (`ColorField`) and `1938-1949` (`normalizeHex`) verbatim. Export all three (`normalizeHex` is used by `ColorField` in the same file, but exporting it lets a test pin the `#abc` → `#aabbcc` expansion directly). Carry over whichever of these imports the moved code needs:

```tsx
import React from "react";
import { PGButton, PGIconButton, PGInput } from "@/design";
import { THEME_COLOR_FIELDS, type ThemeColors } from "@/features/settings/useSettingsStore";
```

- [ ] **Step 2: Move `ThemeEditorDialog`**

Create `src/features/settings/theme/ThemeEditorDialog.tsx`. Move `src/screens/Settings.tsx:1480-1771` verbatim, importing `ColorEditor` from `./ColorEditor`.

- [ ] **Step 3: Point the screen at both**

In `src/screens/Settings.tsx`, delete 1480–1949 and add:

```tsx
import { ThemeEditorDialog } from "@/features/settings/theme/ThemeEditorDialog";
```

Then let `tsc` name any now-unused import (`THEME_COLOR_FIELDS` and `ThemeColors` are likely to become unused in the screen) and delete exactly those.

- [ ] **Step 4: Verify**

Run: `~/Library/pnpm/pnpm tsc --noEmit`
Expected: no errors.

Run: `~/Library/pnpm/pnpm vitest run --project unit src/screens/Settings.appearance.test.tsx src/features/settings`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/theme src/screens/Settings.tsx
git commit -m "refactor(settings): lift the theme editor out of the screen" -m "Why: ~750 of Settings.tsx's 2,063 lines were theme editing, which is a
feature of its own and not part of the screen's composition. Pure move —
no behaviour change." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: The registry, the guard test, and the Diff page

The vertical slice: types, registry, guard test, and one real page extracted end-to-end. Diff first because it is five plain rows with no IPC and no conditional rendering.

**Files:**
- Create: `src/features/settings/nav/types.ts`
- Create: `src/features/settings/nav/pages.ts`
- Create: `src/features/settings/pages/diff.tsx`
- Create: `src/screens/settings.index.test.tsx`
- Modify: `src/screens/Settings.tsx` (replace the inline Diff card at 319–405 with `<DiffPage />`)
- Modify: `src/screens/Settings.difftool.test.tsx`

**Interfaces:**
- Consumes: `SettingsCard`, `SettingsRow`, `registerCardRows` from Task 1.
- Produces: `SettingsGroupId`, `SettingsPageId`, `SettingRowGate`, `SettingRowMeta`, `SettingCardMeta`, `SettingsPageMeta`, `SettingsPageModule` from `nav/types.ts`; `GROUPS: readonly SettingsGroup[]`, `PAGES: Record<SettingsPageId, SettingsPageModule>`, `PAGE_ORDER: readonly SettingsPageId[]`, `FIRST_PAGE: SettingsPageId`, `resolvePageId(raw: unknown): SettingsPageId` from `nav/pages.ts`.

- [ ] **Step 1: Write the types**

Create `src/features/settings/nav/types.ts`:

```tsx
import type React from "react";
import type { IconName } from "@/design";

export type SettingsGroupId = "general" | "git" | "advanced";

export type SettingsPageId =
  | "general.appearance"
  | "general.keyboard"
  | "general.updates"
  | "git.commit"
  | "git.diff"
  | "git.remote"
  | "git.integrations"
  | "advanced.cli"
  | "advanced.workspace"
  | "advanced.backup";

/**
 * A condition under which a row exists at all.
 *
 * `"updatable"` is the only one, and it is not cosmetic: on a Microsoft Store
 * install `UpdatesSection` renders no check and no channel, because
 * `StoreManaged` gates the CHECK and not just the install — Store policy 10.2.5
 * makes *notifying* the violation, and v0.4.0 failed certification on it. The
 * search index is a new surface that reads `UpdateCapability`, so it gates on
 * the same `updatesManagedExternally` predicate the card already uses.
 */
export type SettingRowGate = "updatable";

export interface SettingRowMeta {
  /** Unique app-wide. Rendered as `data-setting-id`. */
  id: string;
  /** Must equal the rendered `SettingsRow`'s `label` — the guard test enforces it. */
  label: string;
  /**
   * Synonyms the label does not contain.
   *
   * `SettingsRow`'s `hint` is a `React.ReactNode` and cannot be flattened to
   * text reliably, so hints are NOT indexed. Any word that lives only in a hint
   * but matters for discovery — "GPG", "SSH", "fish", "pwsh", "difftool" —
   * belongs here. This is the one convention the guard test cannot check.
   */
  keywords?: string;
  /** Absent from the index and the DOM unless the gate is satisfied. */
  when?: SettingRowGate;
}

export interface SettingCardMeta {
  id: string;
  title: string;
  subtitle?: string;
  rows: SettingRowMeta[];
  /**
   * The card renders content search cannot index per-row — a data-driven list.
   * It renders IN FULL whenever any of its declared rows match, and the guard
   * test exempts it from the both-directions DOM check.
   */
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

- [ ] **Step 2: Write the failing guard test**

Create `src/screens/settings.index.test.tsx`:

```tsx
// THE guard test for the settings registry.
//
// Every page declares its rows as data (`meta`) so search can match without
// rendering. That only stays true if the data cannot drift from what renders,
// which is what this file enforces: mount each page, read `data-setting-id`
// out of the DOM, and compare the two sets BOTH ways. A row that renders but
// is not declared is invisible to search; a row declared but never rendered is
// a dead search result.
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { WithDialogs, resetDialogs } from "@/test/dialog";
import { GROUPS, PAGES, PAGE_ORDER, resolvePageId, FIRST_PAGE } from "@/features/settings/nav/pages";
import type { SettingsPageId } from "@/features/settings/nav/types";

function renderedRowIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("[data-setting-id]"))
    .map((el) => el.getAttribute("data-setting-id")!)
    .sort();
}

/** Row ids a page declares, minus gated ones (they are asserted separately). */
function declaredRowIds(pageId: SettingsPageId): string[] {
  return PAGES[pageId].meta.cards
    .filter((c) => !c.dynamic)
    .flatMap((c) => c.rows)
    .filter((r) => !r.when)
    .map((r) => r.id)
    .sort();
}

describe("settings registry", () => {
  beforeEach(() => {
    resetDialogs();
  });

  it("declares exactly the rows each page renders", () => {
    for (const pageId of PAGE_ORDER) {
      const { Page } = PAGES[pageId];
      const { container, unmount } = render(
        <WithDialogs>
          <Page />
        </WithDialogs>,
      );
      const rendered = renderedRowIds(container).filter(
        (id) => !isDynamicRow(pageId, id),
      );
      expect(rendered, `${pageId}: rendered rows`).toEqual(declaredRowIds(pageId));
      unmount();
    }
  });

  it("gives every row a unique id app-wide", () => {
    const all = PAGE_ORDER.flatMap((p) =>
      PAGES[p].meta.cards.flatMap((c) => c.rows.map((r) => r.id)),
    );
    expect(new Set(all).size, `duplicate row id in ${all.join(", ")}`).toBe(all.length);
  });

  it("puts every page in exactly one non-empty group", () => {
    for (const group of GROUPS) {
      expect(group.pages.length, `${group.id} has no pages`).toBeGreaterThan(0);
    }
    const fromGroups = GROUPS.flatMap((g) => g.pages).sort();
    expect(fromGroups).toEqual([...PAGE_ORDER].sort());
    for (const pageId of PAGE_ORDER) {
      expect(PAGES[pageId].meta.group, `${pageId} group mismatch`).toBe(
        GROUPS.find((g) => g.pages.includes(pageId))?.id,
      );
    }
  });

  it("registers every SettingsPageId", () => {
    // A mapped type over the union, so a new page id fails to COMPILE until it
    // is listed here — the same trick AppShell.navroutes.test.tsx uses.
    const expected: { [K in SettingsPageId]: true } = {
      "general.appearance": true,
      "general.keyboard": true,
      "general.updates": true,
      "git.commit": true,
      "git.diff": true,
      "git.remote": true,
      "git.integrations": true,
      "advanced.cli": true,
      "advanced.workspace": true,
      "advanced.backup": true,
    };
    expect([...PAGE_ORDER].sort()).toEqual(Object.keys(expected).sort());
  });

  it("resolves an unrecognised persisted page id to the first page", () => {
    expect(resolvePageId("git.diff")).toBe("git.diff");
    expect(resolvePageId("nope.gone")).toBe(FIRST_PAGE);
    expect(resolvePageId(undefined)).toBe(FIRST_PAGE);
    expect(resolvePageId(42)).toBe(FIRST_PAGE);
    expect(FIRST_PAGE).toBe("general.appearance");
  });
});

/** Rows inside a `dynamic` card are data-driven; the DOM check skips them. */
function isDynamicRow(pageId: SettingsPageId, rowId: string): boolean {
  return PAGES[pageId].meta.cards.some(
    (c) => c.dynamic && c.rows.some((r) => r.id === rowId),
  );
}
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `~/Library/pnpm/pnpm vitest run --project unit src/screens/settings.index.test.tsx`

Expected: FAIL — `Failed to resolve import "@/features/settings/nav/pages"`.

- [ ] **Step 4: Create the Diff page**

Create `src/features/settings/pages/diff.tsx`. Move the inline Diff card from `src/screens/Settings.tsx:319-405` verbatim into the component body, add the ids from Task 1's table, and declare the meta:

```tsx
import { SettingsCard, SettingsRow } from "@/features/settings/layout/SettingsCard";
import type { SettingsPageMeta } from "@/features/settings/nav/types";

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
        { id: "diff.layout", label: "Layout", keywords: "split unified inline side by side" },
        { id: "diff.show", label: "Show", keywords: "whole file context hunks" },
        { id: "diff.context", label: "Context lines" },
        { id: "diff.whitespace", label: "Ignore whitespace" },
        { id: "diff.tool", label: "External diff tool", keywords: "difftool meld kdiff3 vimdiff bcompare" },
      ],
    },
  ],
};

export function DiffPage() {
  // …the JSX moved verbatim from Settings.tsx:319-405, with <Section>/<Row>
  // already renamed to <SettingsCard>/<SettingsRow> by Task 1 and the ids
  // from Task 1's table in place. It reads `useSettingsStore` exactly as
  // before; nothing about the controls changes.
}
```

Carry over whichever imports the moved JSX needs — at minimum `useSettingsStore`, `isValidDiffToolName`, `PGButtonGroup`, `PGInput`, `PGSelect`, `PGToggle`.

- [ ] **Step 5: Create the registry**

Create `src/features/settings/nav/pages.ts`:

```tsx
import { registerCardRows } from "@/features/settings/layout/SettingsCard";
import * as diff from "@/features/settings/pages/diff";
import type {
  SettingsGroupId,
  SettingsPageId,
  SettingsPageModule,
} from "./types";

export interface SettingsGroup {
  id: SettingsGroupId;
  title: string;
  pages: readonly SettingsPageId[];
}

/**
 * The side menu, in display order.
 *
 * Groups are declared here and not derived from the pages, because ORDER is a
 * design decision and a derived list would silently reorder when a page moved
 * file. The guard test cross-checks the two against each other.
 */
export const GROUPS: readonly SettingsGroup[] = [
  { id: "general", title: "General", pages: ["general.appearance", "general.keyboard", "general.updates"] },
  { id: "git", title: "Git", pages: ["git.commit", "git.diff", "git.remote", "git.integrations"] },
  { id: "advanced", title: "Advanced", pages: ["advanced.cli", "advanced.workspace", "advanced.backup"] },
];

export const PAGES: Record<SettingsPageId, SettingsPageModule> = {
  "git.diff": { meta: diff.meta, Page: diff.DiffPage },
  // Tasks 4-6 add the other nine. Until then the mapped type below fails to
  // compile, which is the point: a missing page cannot be forgotten.
} as Record<SettingsPageId, SettingsPageModule>;

export const PAGE_ORDER: readonly SettingsPageId[] = GROUPS.flatMap((g) => g.pages);

/** First page of the first group. The `settingsPage` default, and the fallback. */
export const FIRST_PAGE: SettingsPageId = PAGE_ORDER[0];

/**
 * Coerce a persisted or deep-linked page id.
 *
 * `coerceSettings`' scalar guard compares against `typeof DEFAULTS[key]` and so
 * waves through ANY string, and a deep link can name a page a later build
 * removed. Resolving here rather than trusting the caller is the same defensive
 * shape as `normalizeThemePreference`'s "an unknown mode reads as fixed".
 */
export function resolvePageId(raw: unknown): SettingsPageId {
  return typeof raw === "string" && (PAGE_ORDER as readonly string[]).includes(raw)
    ? (raw as SettingsPageId)
    : FIRST_PAGE;
}

// Hand the layout pair each card's declared rows, so a card can decide whether
// it is empty before its children render. Runs once, at module load.
for (const pageId of Object.keys(PAGES) as SettingsPageId[]) {
  for (const card of PAGES[pageId].meta.cards) {
    registerCardRows(card.id, card.rows.map((r) => r.id));
  }
}
```

**Note for the implementer:** `PAGES` is cast because it is incomplete until Task 6. Replace the cast with a plain typed literal in Task 6, Step 4 — the cast is scaffolding, and leaving it in would defeat the exhaustiveness the type is there to provide.

- [ ] **Step 6: Render the page from the screen**

In `src/screens/Settings.tsx`, replace lines 319–405 (the inline Diff card) with `<DiffPage />` and import it:

```tsx
import { DiffPage } from "@/features/settings/pages/diff";
```

The screen is still one scroll. Nothing about the rendered DOM changes.

- [ ] **Step 7: Run the guard test**

Run: `~/Library/pnpm/pnpm vitest run --project unit src/screens/settings.index.test.tsx`

Expected: the `declares exactly the rows each page renders`, `unique id`, `registers every SettingsPageId` and `resolvePageId` cases PASS for the one registered page. The `exactly one non-empty group` case FAILS, because `GROUPS` names ten pages and `PAGE_ORDER` has ten while `PAGES` has one.

Make it pass by narrowing the group cross-check to registered pages **only for the duration of Tasks 3–5**. Change that case's `fromGroups` line to:

```tsx
    const registered = new Set(Object.keys(PAGES));
    const fromGroups = GROUPS.flatMap((g) => g.pages).filter((p) => registered.has(p)).sort();
    expect(fromGroups).toEqual([...PAGE_ORDER].filter((p) => registered.has(p)).sort());
```

Task 6, Step 5 reverts this to the strict form. Leave a `// TASK 6: revert to the strict form` comment on it so the temporary shape cannot be mistaken for the intended one.

- [ ] **Step 8: Repoint the difftool test at the page**

In `src/screens/Settings.difftool.test.tsx`: delete `mockRestOfSettings()` and its call sites entirely — the Diff page does no IPC — and swap the import and render target:

```tsx
import { DiffPage } from "@/features/settings/pages/diff";
// …
render(<WithDialogs><DiffPage /></WithDialogs>);
```

Keep every assertion as it is. Drop the now-unused `mockInvoke` import if `tsc` says so.

- [ ] **Step 9: Verify**

Run: `~/Library/pnpm/pnpm tsc --noEmit && ~/Library/pnpm/pnpm vitest run --project unit src/screens`
Expected: PASS, including the other nine `Settings.*.test.tsx` files, which still render the whole screen and still see the Diff rows.

- [ ] **Step 10: Commit**

```bash
git add src/features/settings/nav src/features/settings/pages src/screens/Settings.tsx src/screens/Settings.difftool.test.tsx src/screens/settings.index.test.tsx
git commit -m "feat(settings): page registry with a drift-proof row index" -m "Why: search has to know what settings exist without rendering them, so
each page declares its rows as data. The guard test mounts every page and
compares declared ids against the DOM's data-setting-id both ways, which
is what stops the two drifting.

Diff is the first page through the machinery: five plain rows, no IPC, no
conditional rendering." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: The General pages

Appearance, Keyboard & actions, Updates. Updates carries the gated rows.

**Files:**
- Create: `src/features/settings/pages/appearance.tsx`, `keyboard.tsx`, `updates.tsx`
- Modify: `src/screens/Settings.tsx`, `src/features/settings/nav/pages.ts`
- Modify: `src/screens/Settings.appearance.test.tsx`, `Settings.dateFormat.test.tsx`, `Settings.updates.test.tsx`

**Interfaces:**
- Consumes: Task 3's types and registry.
- Produces: `appearance.meta` + `AppearancePage`, `keyboard.meta` + `KeyboardPage`, `updates.meta` + `UpdatesPage`.

- [ ] **Step 1: Create the Appearance page**

Create `src/features/settings/pages/appearance.tsx`. Move `AppearanceSection` (`src/screens/Settings.tsx:1154-1479`, post-Task-2 line numbers shift — find it by name) plus the `DATE_SAMPLE_NOW` / `DATE_SAMPLE_TS` constants (`1151-1153`). The component takes no props: it reads the active theme itself rather than receiving it, since the screen no longer computes it centrally.

Replace the `{ active }: { active: ThemeDef }` parameter with, at the top of the body:

```tsx
const s = useSettingsStore();
const active = s.getActiveTheme();
```

Declare:

```tsx
export const meta: SettingsPageMeta = {
  id: "general.appearance",
  group: "general",
  title: "Appearance",
  icon: "eye",
  cards: [
    {
      id: "appearance",
      title: "Appearance",
      subtitle: "Pick a theme, or customize every color and export it as a sharable file.",
      rows: [
        { id: "appearance.follow", label: "Appearance", keywords: "follow system os auto light dark mode" },
        { id: "appearance.light", label: "Light theme" },
        { id: "appearance.dark", label: "Dark theme", keywords: "dark mode" },
        { id: "appearance.theme", label: "Theme", keywords: "colors palette custom editor export" },
        { id: "appearance.density", label: "UI density", keywords: "compact cozy comfortable row height spacing" },
        { id: "appearance.dateFormat", label: "Date format", keywords: "relative absolute iso timestamp" },
        { id: "appearance.headMarks", label: "Current position (HEAD)", keywords: "bar tint ring marker" },
        { id: "appearance.zoom", label: "Zoom", keywords: "font size scale text bigger smaller" },
      ],
    },
  ],
};
```

- [ ] **Step 2: Create the Keyboard & actions page**

Create `src/features/settings/pages/keyboard.tsx`. Move `KeyboardSection` (`477-506`) and `CustomActionsSection` (`443-453`) into one component rendering both cards in that order:

```tsx
export const meta: SettingsPageMeta = {
  id: "general.keyboard",
  group: "general",
  title: "Keyboard & actions",
  icon: "kbd",
  cards: [
    {
      id: "keyboard",
      title: "Keyboard",
      subtitle: "Choose a keymap preset. Press ? anywhere to see the active bindings.",
      rows: [{ id: "keyboard.keymap", label: "Keymap", keywords: "shortcuts chords bindings preset vscode" }],
    },
    {
      id: "actions",
      title: "Custom actions",
      subtitle: "Your own commands, available from the command palette.",
      rows: [{ id: "actions.list", label: "Actions", keywords: "custom command script palette" }],
    },
  ],
};

export function KeyboardPage() {
  return (
    <>
      {/* KeyboardSection's card, moved verbatim */}
      {/* CustomActionsSection's card, moved verbatim */}
    </>
  );
}
```

- [ ] **Step 3: Create the Updates page with the Store gate**

Create `src/features/settings/pages/updates.tsx`. Move `UpdatesSection` (`759-957`) verbatim — **including its `storeManaged` branch at line 827, unchanged**. The page component keeps making that decision; the gate below only teaches the *index* the same thing.

```tsx
export const meta: SettingsPageMeta = {
  id: "general.updates",
  group: "general",
  title: "Updates",
  icon: "download",
  cards: [
    {
      id: "updates",
      title: "Updates",
      subtitle: "Check whether a newer PlatypusGit release is available.",
      rows: [
        { id: "updates.version", label: "Current version" },
        // Gated: absent from the DOM *and* the index on a Microsoft Store
        // install. Store policy 10.2.5 makes NAMING an update check the
        // violation, so a search result for "update" that says "Check for
        // updates" would be the v0.4.0 certification failure again.
        { id: "updates.check", label: "Check for updates", keywords: "automatic manual", when: "updatable" },
        { id: "updates.channel", label: "Release channel", keywords: "stable prerelease beta", when: "updatable" },
      ],
    },
  ],
};
```

- [ ] **Step 4: Register all three**

In `src/features/settings/nav/pages.ts`, add the imports and entries:

```tsx
import * as appearance from "@/features/settings/pages/appearance";
import * as keyboard from "@/features/settings/pages/keyboard";
import * as updates from "@/features/settings/pages/updates";
// …in PAGES:
  "general.appearance": { meta: appearance.meta, Page: appearance.AppearancePage },
  "general.keyboard": { meta: keyboard.meta, Page: keyboard.KeyboardPage },
  "general.updates": { meta: updates.meta, Page: updates.UpdatesPage },
```

- [ ] **Step 5: Render them from the screen**

In `src/screens/Settings.tsx`, replace `<AppearanceSection active={active} />`, `<KeyboardSection />`, `<CustomActionsSection />` and `<UpdatesSection />` with `<AppearancePage />`, `<KeyboardPage />` and `<UpdatesPage />` — keeping today's visual order (Appearance stays third, Keyboard and Updates stay near the end) so no test that asserts document order breaks. Delete the four now-dead local functions and any import `tsc` reports as unused (`ThemeDef` and `getActiveTheme`'s `active` local are likely).

- [ ] **Step 6: Add the gate assertion to the guard test**

Append to `src/screens/settings.index.test.tsx`:

```tsx
describe("the update gate", () => {
  it("declares the check and channel rows as gated", () => {
    const rows = PAGES["general.updates"].meta.cards.flatMap((c) => c.rows);
    expect(rows.find((r) => r.id === "updates.check")?.when).toBe("updatable");
    expect(rows.find((r) => r.id === "updates.channel")?.when).toBe("updatable");
    // The version row is NOT gated — it is what a Store install still shows.
    expect(rows.find((r) => r.id === "updates.version")?.when).toBeUndefined();
  });
});
```

The runtime half — that a store-managed capability actually removes them from the resolved index — is asserted in Task 12, where `useSettingsIndex` exists.

- [ ] **Step 7: Repoint the three test files**

For `Settings.appearance.test.tsx` and `Settings.dateFormat.test.tsx`: delete `mockRestOfSettings()` and render `<AppearancePage />`. For `Settings.updates.test.tsx`: delete `mockRestOfSettings()` and render `<UpdatesPage />`; keep its `update_capability` mocks, which are the point of that file.

- [ ] **Step 8: Verify**

Run: `~/Library/pnpm/pnpm tsc --noEmit && ~/Library/pnpm/pnpm vitest run --project unit src/screens`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/features/settings src/screens
git commit -m "feat(settings): extract the three General pages" -m "Why: Appearance, Keyboard & actions and Updates move behind the registry.

Updates carries the only conditional rows in the set: on a Microsoft
Store install there is no check and no channel, so both are declared
when: \"updatable\" — the index has to gate on the same predicate the card
does, or a search for \"update\" would name a check that policy 10.2.5
forbids naming." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: The Git pages

Commit, Remote & sync, Integrations. The two misfiled rows stay put for now — Task 6 moves them with the Workspace page they belong to.

**Files:**
- Create: `src/features/settings/pages/commit.tsx`, `remote.tsx`, `integrations.tsx`
- Modify: `src/screens/Settings.tsx`, `src/features/settings/nav/pages.ts`
- Modify: `src/screens/Settings.commit.test.tsx`, `Settings.identity.test.tsx`

**Interfaces:**
- Consumes: Task 3's types and registry.
- Produces: `commit.meta` + `CommitPage`, `remote.meta` + `RemotePage`, `integrations.meta` + `IntegrationsPage`.

- [ ] **Step 1: Create the Commit page**

Create `src/features/settings/pages/commit.tsx`, combining `IdentitySection` (`454-476`) and the inline Commit card (`255-317`) in that order:

```tsx
export const meta: SettingsPageMeta = {
  id: "git.commit",
  group: "git",
  title: "Commit",
  icon: "commit",
  cards: [
    {
      id: "identity",
      title: "Identity",
      subtitle: "Who your commits are recorded as. Unlike everything else here, this is written to your git config — the same user.name and user.email git itself reads.",
      rows: [
        { id: "identity.author", label: "Commit author", keywords: "user.name user.email name email git config scope global" },
        { id: "identity.saved", label: "Saved identities", keywords: "profile persona switch" },
      ],
    },
    {
      id: "commit",
      title: "Commit",
      subtitle: "Defaults applied when creating a new commit.",
      rows: [
        { id: "commit.signoff", label: "Append Signed-off-by", keywords: "dco trailer sign off" },
        { id: "commit.ticket", label: "Ticket pattern", keywords: "issue jira regex prefix branch" },
        { id: "commit.sign", label: "Sign commits", keywords: "gpg ssh signing key gpgsign verify" },
      ],
    },
  ],
};
```

- [ ] **Step 2: Create the Remote & sync page**

Create `src/features/settings/pages/remote.tsx` from the inline Pull & fetch card (`124-237`) and Push safety card (`239-253`). **Split the `pull` card into three** — `pull`, `push` and a new `rebase` card — and drop the two `workspace.*` rows, which Task 6 picks up:

```tsx
export const meta: SettingsPageMeta = {
  id: "git.remote",
  group: "git",
  title: "Remote & sync",
  icon: "sync",
  cards: [
    {
      id: "pull",
      title: "Pull & fetch",
      subtitle: "How platypusgit updates your local branches from their upstream.",
      rows: [
        { id: "pull.mode", label: "Default pull mode", keywords: "rebase merge ff-only fast forward" },
        { id: "pull.autostash", label: "Auto-stash before pull", keywords: "dirty working copy stash" },
        { id: "fetch.auto", label: "Auto-fetch", keywords: "background poll automatic" },
        { id: "fetch.interval", label: "Auto-fetch interval", keywords: "minutes frequency" },
        { id: "fetch.prune", label: "Prune on fetch", keywords: "delete stale remote branches" },
      ],
    },
    {
      id: "push",
      title: "Push safety",
      subtitle: "Guardrails around destructive remote operations.",
      rows: [{ id: "push.confirmForce", label: "Confirm force-push", keywords: "force lease destructive overwrite" }],
    },
    {
      id: "rebase",
      title: "Rebase",
      subtitle: "How a rebase treats branches that point inside the replayed range.",
      rows: [{ id: "rebase.updateRefs", label: "Move dependent branches", keywords: "update-refs stacked dependent" }],
    },
  ],
};
```

Move the five pull/fetch rows into the `pull` card, `push.confirmForce` into `push`, and `rebase.updateRefs` into `rebase`, all verbatim. Leave the two `workspace.*` rows in `Settings.tsx` for now — Task 6 moves them, and this page must not render them or the guard test fails.

- [ ] **Step 3: Create the Integrations page**

`src/features/forge/ForgeSettings.tsx` already renders the whole card. Create `src/features/settings/pages/integrations.tsx` as a thin declaration over it rather than moving 507 lines:

```tsx
import { ForgeSettings } from "@/features/forge/ForgeSettings";
import type { SettingsPageMeta } from "@/features/settings/nav/types";

export const meta: SettingsPageMeta = {
  id: "git.integrations",
  group: "git",
  title: "Integrations",
  icon: "link",
  cards: [
    {
      id: "integrations",
      title: "Integrations",
      // The host list is DATA — a host can hold several accounts — so there are
      // no fixed rows to index. `dynamic` means: render the card in full when
      // any of these synthetic rows match, and skip the both-directions DOM
      // check in the guard test.
      dynamic: true,
      rows: [
        { id: "integrations.token", label: "Forge token", keywords: "github gitlab personal access token pat account api credential pull request merge request" },
        { id: "integrations.none", label: "No forge detected" },
        { id: "integrations.error", label: "Last error" },
      ],
    },
  ],
};

export function IntegrationsPage() {
  return <ForgeSettings />;
}
```

- [ ] **Step 4: Register and render**

Add all three to `PAGES` in `nav/pages.ts` (same shape as Task 4, Step 4). In `src/screens/Settings.tsx`, replace the Commit card, the Push safety card, `<IdentitySection />` and `<ForgeSettings />` with `<CommitPage />`, `<RemotePage />` and `<IntegrationsPage />`, keeping today's order. The Pull & fetch card shrinks to just the two `workspace.*` rows plus its header until Task 6 empties it.

- [ ] **Step 5: Repoint the two test files**

`Settings.commit.test.tsx` and `Settings.identity.test.tsx`: delete `mockRestOfSettings()` and render `<CommitPage />`.

- [ ] **Step 6: Verify**

Run: `~/Library/pnpm/pnpm tsc --noEmit && ~/Library/pnpm/pnpm vitest run --project unit src/screens src/features/forge`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/settings src/screens
git commit -m "feat(settings): extract the four Git pages" -m "Why: Commit, Remote & sync and Integrations move behind the registry.

Pull & fetch splits into three cards — pull, push and rebase — because
'Move dependent branches' is a rebase setting that had been filed under
pull, and one card per concern is what makes the page readable.

Integrations declares itself dynamic: the forge host list is data, so
there are no fixed rows to index." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: The Advanced pages, and the misfiled rows

Command line, Workspace, Backup & diagnostics. This is where "Watch the working copy" and "Terminal shell" finally leave *Pull & fetch*, and where `Settings.tsx` stops holding any card of its own.

**Files:**
- Create: `src/features/settings/pages/cli.tsx`, `workspace.tsx`, `backup.tsx`
- Modify: `src/screens/Settings.tsx`, `src/features/settings/nav/pages.ts`, `src/screens/settings.index.test.tsx`
- Modify: `src/screens/Settings.cli.test.tsx`, `Settings.terminal.test.tsx`, `Settings.diagnostics.test.tsx`, `Settings.export.test.tsx`

**Interfaces:**
- Consumes: Task 3's types and registry.
- Produces: `cli.meta` + `CliPage`, `workspace.meta` + `WorkspacePage`, `backup.meta` + `BackupPage`. After this task `PAGES` is complete and loses its cast.

- [ ] **Step 1: Create the Command line page**

Create `src/features/settings/pages/cli.tsx` from `CliSection` (`507-620`), carrying `Mono` (`710-733`) and `PathNote` (`734-758`) with it — both are only used by this page and Diagnostics, so export them from here and let `backup.tsx` import them.

```tsx
export const meta: SettingsPageMeta = {
  id: "advanced.cli",
  group: "advanced",
  title: "Command line",
  icon: "terminal",
  cards: [
    {
      id: "cli",
      title: "Command line",
      subtitle: "Launch platypusgit from a terminal: pgit [commit|status|log|history|branches] [path].",
      rows: [{ id: "cli.pgit", label: "pgit command", keywords: "shim install path terminal launch binary symlink" }],
    },
  ],
};
```

- [ ] **Step 2: Create the Workspace page**

Create `src/features/settings/pages/workspace.tsx`. Move the two rows out of `Settings.tsx`'s Pull & fetch card — `workspace.watch` (`label="Watch the working copy"`, `data-testid="watch-filesystem"`) and `workspace.shell` (`label="Terminal shell"`, `data-testid="terminal-shell"`) — verbatim, testids included.

```tsx
export const meta: SettingsPageMeta = {
  id: "advanced.workspace",
  group: "advanced",
  title: "Workspace",
  icon: "repo",
  cards: [
    {
      id: "workspace",
      title: "Workspace",
      subtitle: "How the app watches and shells out to this machine.",
      rows: [
        { id: "workspace.watch", label: "Watch the working copy", keywords: "filesystem watcher notify refresh auto" },
        { id: "workspace.shell", label: "Terminal shell", keywords: "fish zsh bash pwsh powershell path binary" },
      ],
    },
  ],
};
```

- [ ] **Step 3: Create the Backup & diagnostics page**

Create `src/features/settings/pages/backup.tsx` from `BackupSection` (`958-1110`) and `DiagnosticsSection` (`621-709`) in that order, carrying `ImportReport` (`1111-1150`) and importing `Mono` / `PathNote` from `./cli`.

```tsx
export const meta: SettingsPageMeta = {
  id: "advanced.backup",
  group: "advanced",
  title: "Backup & diagnostics",
  icon: "info",
  cards: [
    {
      id: "backup",
      title: "Settings file",
      subtitle: "Move every preference to another machine, or share a house style with your team.",
      rows: [
        { id: "backup.export", label: "Export settings", keywords: "save file json share house style backup" },
        { id: "backup.import", label: "Import settings", keywords: "load file json restore" },
      ],
    },
    {
      id: "diagnostics",
      title: "Diagnostics",
      subtitle: "The app's log — what to attach to a bug report.",
      rows: [
        { id: "diagnostics.environment", label: "Environment", keywords: "version os arch git bug report" },
        { id: "diagnostics.log", label: "Log file", keywords: "tail reveal path debug troubleshoot" },
      ],
    },
  ],
};
```

- [ ] **Step 4: Complete the registry and drop the cast**

In `src/features/settings/nav/pages.ts`, add the last three entries and remove the `as Record<...>` cast Task 3 left, so `PAGES` is a plain typed literal:

```tsx
export const PAGES: Record<SettingsPageId, SettingsPageModule> = {
  "general.appearance": { meta: appearance.meta, Page: appearance.AppearancePage },
  "general.keyboard": { meta: keyboard.meta, Page: keyboard.KeyboardPage },
  "general.updates": { meta: updates.meta, Page: updates.UpdatesPage },
  "git.commit": { meta: commit.meta, Page: commit.CommitPage },
  "git.diff": { meta: diff.meta, Page: diff.DiffPage },
  "git.remote": { meta: remote.meta, Page: remote.RemotePage },
  "git.integrations": { meta: integrations.meta, Page: integrations.IntegrationsPage },
  "advanced.cli": { meta: cli.meta, Page: cli.CliPage },
  "advanced.workspace": { meta: workspace.meta, Page: workspace.WorkspacePage },
  "advanced.backup": { meta: backup.meta, Page: backup.BackupPage },
};
```

With the cast gone, `Record<SettingsPageId, …>` makes a missing page a compile error.

- [ ] **Step 5: Restore the strict group cross-check**

In `src/screens/settings.index.test.tsx`, revert Task 3 Step 7's temporary narrowing (and delete the `// TASK 6: revert to the strict form` comment):

```tsx
    const fromGroups = GROUPS.flatMap((g) => g.pages).sort();
    expect(fromGroups).toEqual([...PAGE_ORDER].sort());
```

- [ ] **Step 6: Empty the screen of cards**

In `src/screens/Settings.tsx`, replace `<CliSection />`, `<BackupSection />` and `<DiagnosticsSection />` with `<CliPage />`, `<WorkspacePage />` and `<BackupPage />`, and delete what is left of the Pull & fetch card — its two rows have moved, so the card is now empty. Delete every local `*Section` function; the file should hold only `SettingsScreen` and its imports.

Run: `~/Library/pnpm/pnpm exec grep -c "" src/screens/Settings.tsx`
Expected: well under 300 lines.

- [ ] **Step 7: Repoint the last four test files**

`Settings.cli.test.tsx` → `<CliPage />` (keep the `cli_shim_status` mock, drop the rest of `mockRestOfSettings()`). `Settings.terminal.test.tsx` → `<WorkspacePage />`. `Settings.diagnostics.test.tsx` and `Settings.export.test.tsx` → `<BackupPage />` (keep `diagnostics_report`, drop the rest).

- [ ] **Step 8: Verify — the whole suite this time**

Run: `~/Library/pnpm/pnpm tsc --noEmit && ~/Library/pnpm/pnpm test`
Expected: PASS. This is the first point where every page exists, so the guard test's both-directions check is finally meaningful across all ten.

- [ ] **Step 9: Commit**

```bash
git add src/features/settings src/screens
git commit -m "feat(settings): extract the Advanced pages, unfile two rows" -m "Why: completes the registry — PAGES loses its cast, so Record
<SettingsPageId, …> now makes a missing page a compile error.

'Watch the working copy' and 'Terminal shell' finally leave Pull & fetch,
which described neither, for a Workspace page that does. Settings.tsx
holds no cards of its own any more." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: Persist the selected page

**Files:**
- Modify: `src/features/settings/useSettingsStore.ts` (`PersistedState` ~798, `DEFAULTS` 1043–1075, `NON_PORTABLE_KEYS` 1112–1136)
- Modify: `src/features/settings/useSettingsStore.export.test.ts`

**Interfaces:**
- Consumes: `SettingsPageId`, `FIRST_PAGE` from Task 3.
- Produces: `useSettingsStore().settingsPage: SettingsPageId` and `set("settingsPage", id)`.

- [ ] **Step 1: Write the failing test**

Append to `src/features/settings/useSettingsStore.export.test.ts`:

```ts
describe("settingsPage is remembered but never shared (#settings-nav)", () => {
  it("defaults to the first page", () => {
    expect(useSettingsStore.getState().settingsPage).toBe("general.appearance");
  });

  it("is denied on export", () => {
    useSettingsStore.getState().set("settingsPage", "git.diff");
    const payload = JSON.parse(exportSettings());
    expect(payload.settings).not.toHaveProperty("settingsPage");
  });

  it("is ignored on import", () => {
    useSettingsStore.getState().set("settingsPage", "git.diff");
    const report = useSettingsStore.getState().importSettings(
      JSON.stringify({ version: SETTINGS_FILE_VERSION, settings: { settingsPage: "advanced.cli" } }),
    );
    expect(useSettingsStore.getState().settingsPage).toBe("git.diff");
    expect(report.ignored).toContain("settingsPage");
  });
});
```

Match the file's existing helpers for `exportSettings` / `importSettings` / `SETTINGS_FILE_VERSION` — read the top of that file and reuse whatever it already imports rather than inventing names.

- [ ] **Step 2: Run to verify it fails**

Run: `~/Library/pnpm/pnpm vitest run --project unit src/features/settings/useSettingsStore.export.test.ts`
Expected: FAIL — `settingsPage` is not a property of the state.

- [ ] **Step 3: Add the key**

In `src/features/settings/useSettingsStore.ts`:

1. In `PersistedState` (starts ~798), add:

```ts
  /**
   * The Settings page the side menu was last on.
   *
   * NOT portable — see NON_PORTABLE_KEYS. Per-machine UI memory, like
   * `lastCreateDir`. Typed as the union so a removed page id cannot survive a
   * refactor silently; `coerceSettings` still waves any string through, which is
   * why `resolvePageId` guards the read side.
   */
  settingsPage: SettingsPageId;
```

2. In `DEFAULTS` (1043–1075), add `settingsPage: FIRST_PAGE,`.

3. In `NON_PORTABLE_KEYS` (1112–1136), add:

```ts
  /**
   * The last-visited Settings page. Denied because an export is a file people
   * SHARE and this describes nothing about how the app should behave — only
   * where one person happened to be standing. Importing it would yank a
   * colleague's Settings to an unrelated page on their next visit.
   */
  "settingsPage",
```

4. Import the two names:

```ts
import { FIRST_PAGE } from "@/features/settings/nav/pages";
import type { SettingsPageId } from "@/features/settings/nav/types";
```

**Watch for a cycle:** `nav/pages.ts` imports the page modules, which import `useSettingsStore`. Importing `FIRST_PAGE` from `pages.ts` into the store closes that loop. If `tsc` or vitest reports a circular import, move `FIRST_PAGE` and `resolvePageId` into `nav/types.ts` (which imports nothing from the feature) and re-export them from `pages.ts` so existing importers keep working.

- [ ] **Step 4: Run to verify it passes**

Run: `~/Library/pnpm/pnpm vitest run --project unit src/features/settings`
Expected: PASS. The export test's existing key-list snapshot will also need `settingsPage` added to whichever list it pins — update it deliberately, since that snapshot exists precisely to make this a conscious decision.

- [ ] **Step 5: Commit**

```bash
git add src/features/settings
git commit -m "feat(settings): remember the last visited settings page" -m "Why: reopening Settings should land where you were. Stored per machine
and denied on export: an export is a file people share, and where one
person was standing is not a house style." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8: The `open-settings` nav intent, deep link and palette

**Files:**
- Modify: `src/features/nav/useNavStore.ts:48`
- Modify: `src/AppShell.tsx:407`
- Modify: `src/AppShell.navroutes.test.tsx`
- Modify: `src/screens/Pulls.tsx:226`
- Modify: `src/features/keymap/actions.ts:220`
- Modify: `src/features/palette/commands.ts:252-265`

**Interfaces:**
- Consumes: `SettingsPageId`, `PAGE_ORDER`, `PAGES`, `resolvePageId` from Task 3; `set("settingsPage", …)` from Task 7.
- Produces: `NavIntent` variant `{ kind: "open-settings"; page?: SettingsPageId }`; keymap action ids `nav.settings.<pageId>`.

- [ ] **Step 1: Add the intent**

In `src/features/nav/useNavStore.ts`, above line 48's `switch-screen`:

```ts
  /**
   * Open Settings, optionally on a named page.
   *
   * Its own kind rather than a field on `switch-screen`, whose `screen` is a
   * bare `string`: this one carries a typed page id, so a deep link cannot name
   * a page that does not exist. With no `page`, the screen lands on the
   * remembered one.
   */
  | { kind: "open-settings"; page?: SettingsPageId }
```

Import the type: `import type { SettingsPageId } from "@/features/settings/nav/types";` — `nav/types.ts` is pure, so this keeps `useNavStore` free of a feature-store dependency, the same reason `CompareSide` is imported from a pure module on line 5.

- [ ] **Step 2: Run tsc to see the compile-enforced gap**

Run: `~/Library/pnpm/pnpm tsc --noEmit`
Expected: FAIL in `src/AppShell.tsx` — the `default` clause's `assertNever` rejects the unrouted kind — and in `AppShell.navroutes.test.tsx`, whose mapped type over `NavIntent["kind"]` now misses a key. Both failures are the guard working.

- [ ] **Step 3: Route it**

In `src/AppShell.tsx`, beside the `switch-screen` case (~407):

```tsx
      case "open-settings":
        // enterScreen, not setScreen — same reasoning as switch-screen: asking
        // for Settings while already in Settings still means "put me there".
        if (intent.page) {
          useSettingsStore.getState().set("settingsPage", intent.page);
        }
        enterScreen("settings");
        clearIntent();
        break;
```

- [ ] **Step 4: Add the navroutes expectation**

In `src/AppShell.navroutes.test.tsx`'s `EXPECTED` map, add an entry matching the shape its neighbours use — intent `{ kind: "open-settings", page: "git.diff" }`, expected screen `settings`. Follow the existing entries' exact field names rather than guessing.

- [ ] **Step 5: Fix the Pulls deep link**

In `src/screens/Pulls.tsx:226`, replace:

```tsx
useNavStore.getState().setIntent({ kind: "switch-screen", screen: "settings" });
```

with:

```tsx
useNavStore.getState().setIntent({ kind: "open-settings", page: "git.integrations" });
```

- [ ] **Step 6: Add the ten palette entries**

In `src/features/keymap/actions.ts`, after `nav.settings` (line 220), generate one action per page. Extend the `ActionId` union with the ten ids, then:

```ts
  // One action per Settings page, so the palette can jump straight to a page.
  // Deliberately NOT one per setting: thirty-seven more rows would swamp the
  // palette, and page-level plus in-Settings search covers the same ground.
  ...Object.fromEntries(
    PAGE_ORDER.map((pageId) => [
      `nav.settings.${pageId}`,
      {
        id: `nav.settings.${pageId}`,
        title: `Settings: ${PAGES[pageId].meta.title}`,
        category: "Navigation",
        scope: "global" as const,
        run: () => {
          useNavStore.getState().setIntent({ kind: "open-settings", page: pageId });
          return true;
        },
      },
    ]),
  ),
```

If `actions.test.ts` asserts that every catalog action is bound in both presets, these ten will trip it. They are deliberately unbound — the number chords are full and CLAUDE.md's own comment on line 213 records that reasoning for the bisect ops. Add the ten to whatever exemption list that test already uses for palette-only actions; if it has none, add one named for this reason.

In `src/features/palette/commands.ts`, leave `SCREENS` alone and append the page commands where `buildCommands()` assembles its command list, reusing the `type: "command" as const` shape at line 235.

- [ ] **Step 7: Verify**

Run: `~/Library/pnpm/pnpm tsc --noEmit && ~/Library/pnpm/pnpm vitest run --project unit src/AppShell.navroutes.test.tsx src/features/keymap src/features/palette src/screens/Pulls.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/features/nav src/AppShell.tsx src/AppShell.navroutes.test.tsx src/screens/Pulls.tsx src/features/keymap src/features/palette
git commit -m "feat(settings): deep-link to a settings page" -m "Why: Pulls' 'add a forge token' button sent people to Settings and left
them wherever they last were. open-settings carries a typed page id, so
that button lands on Integrations and the palette can offer one entry per
page." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 9: The sidebar primitives

Two additive, backward-compatible prop additions.

**Files:**
- Modify: `src/design/chrome.tsx` (`PGSidebarGroupProps` + `PGSidebarGroup` 598-657, `PGSidebarRowProps` + `PGSidebarRow` 659-749)
- Modify: `src/design/chrome.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `PGSidebarGroup` accepts `open?: boolean` + `onOpenChange?: (open: boolean) => void`; `PGSidebarRow` accepts `role?: string`, `tabIndex?: number`, `onKeyDown?: React.KeyboardEventHandler`, `id?: string`, `dimmed?: boolean`, `ariaSelected?: boolean`.

- [ ] **Step 1: Write the failing test**

Append to `src/design/chrome.test.tsx`:

```tsx
describe("PGSidebarGroup controlled open", () => {
  it("stays uncontrolled when `open` is omitted", () => {
    render(<PGSidebarGroup title="G"><div>child</div></PGSidebarGroup>);
    expect(screen.getByText("child")).toBeTruthy();
    fireEvent.click(screen.getByText("G"));
    expect(screen.queryByText("child")).toBeNull();
  });

  it("obeys `open` and reports clicks when controlled", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <PGSidebarGroup title="G" open={false} onOpenChange={onOpenChange}>
        <div>child</div>
      </PGSidebarGroup>,
    );
    expect(screen.queryByText("child")).toBeNull();
    fireEvent.click(screen.getByText("G"));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    // Controlled: the click alone must not open it.
    expect(screen.queryByText("child")).toBeNull();
    rerender(
      <PGSidebarGroup title="G" open onOpenChange={onOpenChange}>
        <div>child</div>
      </PGSidebarGroup>,
    );
    expect(screen.getByText("child")).toBeTruthy();
  });
});

describe("PGSidebarRow a11y passthrough", () => {
  it("forwards role, tabIndex, aria-selected and keydown", () => {
    const onKeyDown = vi.fn();
    render(
      <PGSidebarRow
        label="Diff"
        role="treeitem"
        tabIndex={0}
        ariaSelected
        onKeyDown={onKeyDown}
      />,
    );
    const row = screen.getByRole("treeitem");
    expect(row.getAttribute("aria-selected")).toBe("true");
    expect(row.getAttribute("tabindex")).toBe("0");
    fireEvent.keyDown(row, { key: "ArrowDown" });
    expect(onKeyDown).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `~/Library/pnpm/pnpm vitest run --project unit src/design/chrome.test.tsx`
Expected: FAIL — unknown props; no element with role `treeitem`.

- [ ] **Step 3: Make `PGSidebarGroup` optionally controlled**

In `src/design/chrome.tsx`, add `open?: boolean` and `onOpenChange?: (open: boolean) => void` to `PGSidebarGroupProps`, and in the body:

```tsx
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  // Optionally controlled: `open` omitted keeps today's local-state behaviour,
  // so no existing caller changes. A search needs to force groups with hits
  // open, which local state cannot express.
  const open = controlledOpen ?? uncontrolledOpen;
  const toggle = () => {
    if (controlledOpen === undefined) setUncontrolledOpen(!open);
    onOpenChange?.(!open);
  };
```

Destructure `open: controlledOpen` and replace the header's `onClick={() => setOpen(!open)}` with `onClick={toggle}`.

- [ ] **Step 4: Add the `PGSidebarRow` passthrough**

Add `role`, `tabIndex`, `onKeyDown`, `id`, `dimmed` and `ariaSelected` to `PGSidebarRowProps` and spread them onto the row's outer `div` as `role={role}`, `tabIndex={tabIndex}`, `aria-selected={ariaSelected}`, `onKeyDown={onKeyDown}`, `id={id}`. For `dimmed`, add `opacity: dimmed ? 0.45 : undefined` to the existing style object — no new colour token, so the accent-hue rule is untouched.

- [ ] **Step 5: Run to verify it passes**

Run: `~/Library/pnpm/pnpm vitest run --project unit src/design`
Expected: PASS, including every existing `chrome.test.tsx` case — the additions are opt-in.

- [ ] **Step 6: Commit**

```bash
git add src/design
git commit -m "feat(design): optional controlled open + a11y props on sidebar rows" -m "Why: the settings side menu needs to force groups with hits open during a
search, and needs tree ARIA with roving focus. Both additive and opt-in,
so Branches and RepoBrowser are untouched.

Extending these beats hand-rolling a second sidebar — hand-rolling is how
Settings ended up with two copies of its card layout." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 10: The side menu, and one page at a time

**Files:**
- Create: `src/features/settings/nav/SettingsNav.tsx`
- Create: `src/screens/settings.nav.test.tsx`
- Modify: `src/screens/Settings.tsx`
- Modify: `e2e/support/app.ts:637`
- Modify: `e2e/specs/settings.e2e.ts` (7 call sites)

**Interfaces:**
- Consumes: everything from Tasks 3, 7, 8, 9.
- Produces: `SettingsNav({ pageId, onSelect, query, onQueryChange, matchCounts })`; the shell renders exactly one page.

- [ ] **Step 1: Write the failing test**

Create `src/screens/settings.nav.test.tsx`:

```tsx
// The side menu: three groups, ten pages, one page rendered at a time.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { mockInvoke } from "@/test/invokeMock";
import { WithDialogs, resetDialogs } from "@/test/dialog";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { SettingsScreen } from "./Settings";

beforeEach(() => {
  resetDialogs();
  useSettingsStore.getState().set("settingsPage", "general.appearance");
  mockInvoke("cli_shim_status", () => ({
    installed: true, shimPath: "/usr/local/bin/pgit",
    target: "/usr/bin/platypusgit", source: "package", pathState: "onPath",
  }));
});

describe("settings side menu", () => {
  it("lists all three groups and lands on the remembered page", () => {
    render(<WithDialogs><SettingsScreen /></WithDialogs>);
    expect(screen.getByText("General")).toBeTruthy();
    expect(screen.getByText("Git")).toBeTruthy();
    expect(screen.getByText("Advanced")).toBeTruthy();
    // Appearance is rendered…
    expect(document.querySelector('[data-settings-page="general.appearance"]')).toBeTruthy();
    // …and nothing else is.
    expect(document.querySelector('[data-settings-page="git.diff"]')).toBeNull();
  });

  it("switches page on click and remembers the choice", () => {
    render(<WithDialogs><SettingsScreen /></WithDialogs>);
    fireEvent.click(screen.getByRole("treeitem", { name: /Diff/ }));
    expect(document.querySelector('[data-settings-page="git.diff"]')).toBeTruthy();
    expect(document.querySelector('[data-settings-page="general.appearance"]')).toBeNull();
    expect(useSettingsStore.getState().settingsPage).toBe("git.diff");
  });

  it("marks the current page selected", () => {
    useSettingsStore.getState().set("settingsPage", "git.diff");
    render(<WithDialogs><SettingsScreen /></WithDialogs>);
    expect(
      screen.getByRole("treeitem", { name: /Diff/ }).getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("falls back to the first page when the persisted id is unknown", () => {
    // Bypass the typed setter the way a hand-edited localStorage payload would.
    useSettingsStore.setState({ settingsPage: "nope.gone" as never });
    render(<WithDialogs><SettingsScreen /></WithDialogs>);
    expect(document.querySelector('[data-settings-page="general.appearance"]')).toBeTruthy();
  });

  it("moves between pages with the arrow keys", () => {
    useSettingsStore.getState().set("settingsPage", "general.appearance");
    render(<WithDialogs><SettingsScreen /></WithDialogs>);
    const first = screen.getByRole("treeitem", { name: /Appearance/ });
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(useSettingsStore.getState().settingsPage).toBe("general.keyboard");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `~/Library/pnpm/pnpm vitest run --project unit src/screens/settings.nav.test.tsx`
Expected: FAIL — no `treeitem` roles, and every page renders at once.

- [ ] **Step 3: Build the side menu**

Create `src/features/settings/nav/SettingsNav.tsx`:

```tsx
import React from "react";
import { PGPrimarySidebar, PGSearchInput, PGSidebarGroup, PGSidebarRow } from "@/design";

import { GROUPS, PAGES } from "./pages";
import type { SettingsPageId } from "./types";

export function SettingsNav({
  pageId,
  onSelect,
  query,
  onQueryChange,
  matchCounts,
}: {
  pageId: SettingsPageId;
  onSelect: (id: SettingsPageId) => void;
  query: string;
  onQueryChange: (q: string) => void;
  /** Row hits per page while a search is active, else null. */
  matchCounts: ReadonlyMap<SettingsPageId, number> | null;
}) {
  // Groups with no hits collapse while a search is active, and spring back to
  // the user's own open/closed state when the query clears.
  const groupOpen = (groupPages: readonly SettingsPageId[]): boolean | undefined => {
    if (!matchCounts) return undefined;
    return groupPages.some((p) => (matchCounts.get(p) ?? 0) > 0);
  };

  const visible = GROUPS.flatMap((g) =>
    g.pages.filter((p) => !matchCounts || (matchCounts.get(p) ?? 0) > 0),
  );

  const onKeyDown = (e: React.KeyboardEvent, id: SettingsPageId) => {
    const i = visible.indexOf(id);
    if (e.key === "ArrowDown" && i < visible.length - 1) {
      e.preventDefault();
      onSelect(visible[i + 1]);
    } else if (e.key === "ArrowUp" && i > 0) {
      e.preventDefault();
      onSelect(visible[i - 1]);
    }
  };

  return (
    <PGPrimarySidebar width={232}>
      <div style={{ padding: 8, borderBottom: "1px solid var(--border-0)" }}>
        <PGSearchInput
          value={query}
          onChange={onQueryChange}
          placeholder="Search settings"
          testId="settings-search"
        />
      </div>
      <div role="tree" aria-label="Settings pages" style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {GROUPS.map((group) => (
          <PGSidebarGroup
            key={group.id}
            title={group.title}
            open={groupOpen(group.pages)}
          >
            <div role="group" aria-label={group.title}>
              {group.pages.map((id) => {
                const hits = matchCounts?.get(id) ?? null;
                return (
                  <PGSidebarRow
                    key={id}
                    icon={PAGES[id].meta.icon}
                    label={PAGES[id].meta.title}
                    selected={id === pageId}
                    ariaSelected={id === pageId}
                    role="treeitem"
                    tabIndex={id === pageId ? 0 : -1}
                    dimmed={matchCounts ? hits === 0 : undefined}
                    meta={hits ? String(hits) : undefined}
                    onClick={() => onSelect(id)}
                    onKeyDown={(e) => onKeyDown(e, id)}
                  />
                );
              })}
            </div>
          </PGSidebarGroup>
        ))}
      </div>
    </PGPrimarySidebar>
  );
}
```

- [ ] **Step 4: Rewrite the shell**

Replace `src/screens/Settings.tsx`'s body so it renders the side menu plus exactly one page. `matchCounts` is `null` until Task 12 — search arrives next task, and wiring it as `null` now keeps this task's diff about navigation:

```tsx
export function SettingsScreen() {
  const s = useSettingsStore();
  const pageId = resolvePageId(s.settingsPage);
  const [query, setQuery] = React.useState("");
  const { Page, meta } = PAGES[pageId];

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", background: "var(--bg-0)" }}>
      <SettingsNav
        pageId={pageId}
        onSelect={(id) => s.set("settingsPage", id)}
        query={query}
        onQueryChange={setQuery}
        matchCounts={null}
      />
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <div style={{ maxWidth: 820, margin: "0 auto", padding: "28px 32px 64px" }}>
          {/* header: page title + "Reset to defaults" */}
          <div data-settings-page={pageId}>
            <Page />
          </div>
        </div>
      </div>
    </div>
  );
}
```

Keep the header's `PGIcon`, the `<h1>` (now showing `meta.title`) and the `Reset to defaults` button, moving the button into the sidebar footer per the spec. Keep the "Preferences are saved locally and apply to every repository." line under the page title.

- [ ] **Step 5: Run to verify it passes**

Run: `~/Library/pnpm/pnpm vitest run --project unit src/screens/settings.nav.test.tsx`
Expected: PASS.

- [ ] **Step 6: Teach the e2e helper to navigate**

In `e2e/support/app.ts:637`, replace `openSettings`:

```ts
/**
 * Open Settings, optionally on a named page.
 *
 * The wait target is the side menu, not a row: Settings renders ONE page now,
 * so waiting on any particular setting's label would only work for the page
 * that happens to be remembered.
 */
export async function openSettings(page?: string): Promise<void> {
  await $('button[title="Settings"]').click();
  await $('[role="tree"]').waitForDisplayed({
    timeout: 10_000,
    timeoutMsg: "Settings screen never appeared",
  });
  if (page) {
    await $(`[data-settings-nav="${page}"]`).click();
    await $(`[data-settings-page="${page}"]`).waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: `Settings page ${page} never appeared`,
    });
  }
}
```

Add `data-settings-nav={id}` to `PGSidebarRow`'s call in `SettingsNav` via the new `id` passthrough — or, if `id` proves to collide with anything, add a `testId` prop in the same additive style as Task 9. Use **exact** attribute selectors, never the `*=` form: `test/e2eSelectors.test.ts` documents why a substring match on nested testids silently matches nothing, and these dotted ids prefix one another (`diff.context` inside `diff.contextLines`).

- [ ] **Step 7: Update the seven call sites**

In `e2e/specs/settings.e2e.ts`: line 124 → `openSettings("general.updates")`; 145, 160, 179, 296 → `openSettings("git.remote")`; 269, 283 → `openSettings("general.appearance")`. Replace the `clickSettingsToggleRow` helper's DOM walk with a selector on the new attribute:

```ts
async function clickSettingsToggleRow(labelText: string, settingId: string): Promise<void> {
  // executeOnce: a driver-retry re-run would click the toggle twice, flipping
  // the setting straight back (issue #35). `data-setting-id` replaces the old
  // parentElement.parentElement walk, which depended on Row's exact DOM shape.
  const ok = await executeOnce((id: string) => {
    const row = document.querySelector(`[data-setting-id="${id}"]`);
    const toggle = row?.querySelector("label");
    if (!toggle) return false;
    (toggle as HTMLElement).click();
    return true;
  }, settingId);
  if (!ok) throw new Error(`settings toggle row not found: ${labelText} (${settingId})`);
}
```

Pass the id at each call site (`push.confirmForce` for "Confirm force-push", and so on) and update the helper's doc comment, which currently explains the walk this replaces.

`e2e/specs/pulls.e2e.ts:88-94` needs no change — it clicks `pulls-open-settings` and waits on `settings-forge`, which Task 8's deep link now lands on directly.

- [ ] **Step 8: Verify, including e2e**

Run: `~/Library/pnpm/pnpm tsc --noEmit && ~/Library/pnpm/pnpm exec tsc -p e2e/tsconfig.json --noEmit && ~/Library/pnpm/pnpm test`
Expected: PASS.

Then, and only after the above is green:

```bash
~/Library/pnpm/pnpm test:e2e:docker build
~/Library/pnpm/pnpm test:e2e:docker run --spec e2e/specs/settings.e2e.ts
~/Library/pnpm/pnpm test:e2e:docker run --spec e2e/specs/pulls.e2e.ts
```

Expected: PASS. Run one cold container build at a time across all worktrees. Do not run a full vitest suite alongside a Docker e2e build — contention fakes a red.

- [ ] **Step 9: Commit**

```bash
git add src/features/settings src/screens e2e
git commit -m "feat(settings): navigate settings from a grouped side menu" -m "Why: fourteen cards in one scroll meant finding a setting by scrolling
and reading. Three groups over ten pages, one page rendered at a time,
with arrow-key navigation and tree ARIA.

Opening Settings also gets cheaper: cli_shim_status and
diagnostics_report used to fire for anyone who came to change a theme." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 11: Matching, and the gated index

Pure logic first, no UI.

**Files:**
- Create: `src/features/settings/nav/match.ts`
- Create: `src/features/settings/nav/match.test.ts`
- Modify: `src/features/settings/nav/pages.ts`

**Interfaces:**
- Consumes: Task 3's types and registry; `updatesManagedExternally` from `@/features/update/useUpdateStore`.
- Produces: `IndexedRow { row, cardId, cardTitle, pageId, pageTitle, groupTitle, haystack }`; `buildIndex(gates: { updatable: boolean }): IndexedRow[]`; `matchRows(query: string, index: IndexedRow[]): IndexedRow[]`; `useSettingsIndex(): IndexedRow[]`; `matchCountsByPage(hits): Map<SettingsPageId, number>`.

- [ ] **Step 1: Write the failing test**

Create `src/features/settings/nav/match.test.ts`:

```ts
// Search matching, and the Store gate that keeps an update check out of the
// index on a Microsoft Store install.
import { describe, expect, it } from "vitest";

import { buildIndex, matchRows, matchCountsByPage } from "./match";

const FULL = buildIndex({ updatable: true });

describe("matchRows", () => {
  it("matches a label", () => {
    const ids = matchRows("context lines", FULL).map((r) => r.row.id);
    expect(ids).toContain("diff.context");
  });

  it("requires every term (AND, not OR)", () => {
    expect(matchRows("dark theme", FULL).map((r) => r.row.id)).toContain("appearance.dark");
    expect(matchRows("dark banana", FULL)).toHaveLength(0);
  });

  it("matches on keywords the label does not contain", () => {
    expect(matchRows("gpg", FULL).map((r) => r.row.id)).toContain("commit.sign");
    expect(matchRows("pwsh", FULL).map((r) => r.row.id)).toContain("workspace.shell");
  });

  it("matches every row on a page whose title matches", () => {
    const hits = matchRows("diff", FULL).filter((r) => r.pageId === "git.diff");
    expect(hits).toHaveLength(5);
  });

  it("spans pages", () => {
    const pages = new Set(matchRows("dark", FULL).map((r) => r.pageId));
    expect(pages.size).toBeGreaterThan(1);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(matchRows("  DARK   THEME ", FULL).map((r) => r.row.id)).toContain("appearance.dark");
  });

  it("returns nothing for a query that matches nothing", () => {
    expect(matchRows("zzzznope", FULL)).toHaveLength(0);
  });

  it("counts hits per page", () => {
    const counts = matchCountsByPage(matchRows("diff", FULL));
    expect(counts.get("git.diff")).toBe(5);
  });
});

describe("the Store gate", () => {
  it("indexes the check and channel on an ordinary install", () => {
    const ids = FULL.map((r) => r.row.id);
    expect(ids).toContain("updates.check");
    expect(ids).toContain("updates.channel");
  });

  it("omits them entirely when updates are managed externally", () => {
    // Store policy 10.2.5: NAMING an update check is the violation. A search
    // for "update" must not offer one on a Store install — that is what failed
    // v0.4.0 certification.
    const gated = buildIndex({ updatable: false });
    const ids = gated.map((r) => r.row.id);
    expect(ids).not.toContain("updates.check");
    expect(ids).not.toContain("updates.channel");
    expect(ids).toContain("updates.version");
    expect(matchRows("check for updates", gated)).toHaveLength(0);
    expect(matchRows("release channel", gated)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `~/Library/pnpm/pnpm vitest run --project unit src/features/settings/nav/match.test.ts`
Expected: FAIL — `Failed to resolve import "./match"`.

- [ ] **Step 3: Implement matching**

Create `src/features/settings/nav/match.ts`:

```ts
import { GROUPS, PAGES, PAGE_ORDER } from "./pages";
import type { SettingRowMeta, SettingsPageId } from "./types";

export interface IndexedRow {
  row: SettingRowMeta;
  cardId: string;
  cardTitle: string;
  pageId: SettingsPageId;
  pageTitle: string;
  groupTitle: string;
  /** Pre-lowercased match target. */
  haystack: string;
}

/**
 * Flatten the registry into a searchable index.
 *
 * The haystack folds in the CARD and PAGE titles as well as the row's own label
 * and keywords, deliberately: "diff" then matches every row on the Diff page,
 * which is what people expect, and it removes any need for a "the page title
 * matched but no rows did" special case.
 *
 * Hints are NOT indexed — they are `React.ReactNode` and cannot be flattened to
 * text reliably. That is what `keywords` is for.
 */
export function buildIndex(gates: { updatable: boolean }): IndexedRow[] {
  const groupTitleOf = new Map(
    GROUPS.flatMap((g) => g.pages.map((p) => [p, g.title] as const)),
  );
  const out: IndexedRow[] = [];
  for (const pageId of PAGE_ORDER) {
    const { meta } = PAGES[pageId];
    for (const card of meta.cards) {
      for (const row of card.rows) {
        if (row.when === "updatable" && !gates.updatable) continue;
        out.push({
          row,
          cardId: card.id,
          cardTitle: card.title,
          pageId,
          pageTitle: meta.title,
          groupTitle: groupTitleOf.get(pageId) ?? "",
          haystack: [row.label, row.keywords ?? "", card.title, meta.title]
            .join(" ")
            .toLowerCase(),
        });
      }
    }
  }
  return out;
}

/** Every whitespace-separated term must appear. Substring, not fuzzy. */
export function matchRows(query: string, index: IndexedRow[]): IndexedRow[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  return index.filter((e) => terms.every((t) => e.haystack.includes(t)));
}

export function matchCountsByPage(
  hits: IndexedRow[],
): Map<SettingsPageId, number> {
  const counts = new Map<SettingsPageId, number>();
  for (const pageId of PAGE_ORDER) counts.set(pageId, 0);
  for (const hit of hits) counts.set(hit.pageId, (counts.get(hit.pageId) ?? 0) + 1);
  return counts;
}
```

- [ ] **Step 4: Add the gated hook**

Append to `src/features/settings/nav/pages.ts`:

```tsx
import { updatesManagedExternally, useUpdateStore } from "@/features/update/useUpdateStore";
import { buildIndex, type IndexedRow } from "./match";

/**
 * The search index, with conditional rows resolved.
 *
 * A hook rather than a module constant because the update gate needs runtime
 * state. It reuses `updatesManagedExternally` instead of re-spelling
 * `=== "store-managed"` — that predicate's own comment asks for exactly this,
 * and it means the index's exposure window is identical to the Updates card's
 * (both answer "not managed" while the capability is still null, so an ordinary
 * install never flickers).
 */
export function useSettingsIndex(): IndexedRow[] {
  const capability = useUpdateStore((s) => s.capability);
  const updatable = !updatesManagedExternally(capability);
  return React.useMemo(() => buildIndex({ updatable }), [updatable]);
}
```

Add `import React from "react";` to `pages.ts`. If importing `match.ts` from `pages.ts` while `match.ts` imports `pages.ts` trips a cycle warning, move `useSettingsIndex` into its own `nav/useSettingsIndex.ts` — the one-way dependency `useSettingsIndex → match → pages` is the shape to keep.

- [ ] **Step 5: Run to verify it passes**

Run: `~/Library/pnpm/pnpm vitest run --project unit src/features/settings/nav`
Expected: PASS — all sixteen cases.

- [ ] **Step 6: Commit**

```bash
git add src/features/settings/nav
git commit -m "feat(settings): searchable settings index with the Store gate" -m "Why: matching is pure logic over the declared registry, so it is testable
without rendering anything. Terms are ANDed substrings; card and page
titles join the haystack so 'diff' finds every diff setting.

The index reads UpdateCapability, so it gates like every other surface
that does: on a Store install it contains no update check to find." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 12: The flat results pane

**Files:**
- Create: `src/features/settings/nav/SettingsResults.tsx`
- Create: `src/screens/settings.search.test.tsx`
- Modify: `src/screens/Settings.tsx`

**Interfaces:**
- Consumes: `useSettingsIndex`, `matchRows`, `matchCountsByPage` from Task 11; `SettingsFilterProvider` from Task 1.
- Produces: `SettingsResults({ hits, query, onClear })`.

- [ ] **Step 1: Write the failing test**

Create `src/screens/settings.search.test.tsx`:

```tsx
// Settings search: one flat list of matching rows across every page, each with
// its real working control.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { mockInvoke } from "@/test/invokeMock";
import { WithDialogs, resetDialogs } from "@/test/dialog";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { SettingsScreen } from "./Settings";

function typeSearch(text: string) {
  fireEvent.change(screen.getByTestId("settings-search"), { target: { value: text } });
}

beforeEach(() => {
  resetDialogs();
  useSettingsStore.getState().set("settingsPage", "general.appearance");
  mockInvoke("cli_shim_status", () => ({
    installed: true, shimPath: "/usr/local/bin/pgit",
    target: "/usr/bin/platypusgit", source: "package", pathState: "onPath",
  }));
  mockInvoke("diagnostics_report", () => ({
    logPath: "/tmp/platypusgit.log", logExists: false, logSizeBytes: 0,
    environment: "host os=macos arch=aarch64 git=2.43.0", version: "0.1.0",
  }));
});

describe("settings search", () => {
  it("shows matching rows from more than one page", () => {
    render(<WithDialogs><SettingsScreen /></WithDialogs>);
    typeSearch("whitespace");
    expect(document.querySelector('[data-setting-id="diff.whitespace"]')).toBeTruthy();
    // The page the user was on is no longer rendered as a page.
    expect(document.querySelector('[data-settings-page="general.appearance"]')).toBeNull();
  });

  it("shows a breadcrumb for each page with hits", () => {
    render(<WithDialogs><SettingsScreen /></WithDialogs>);
    typeSearch("theme");
    expect(screen.getByText(/General.*Appearance/)).toBeTruthy();
  });

  it("hides rows on a hit page that do not match", () => {
    render(<WithDialogs><SettingsScreen /></WithDialogs>);
    typeSearch("context lines");
    expect(document.querySelector('[data-setting-id="diff.context"]')).toBeTruthy();
    expect(document.querySelector('[data-setting-id="diff.layout"]')).toBeNull();
  });

  it("badges pages with hits and dims pages without", () => {
    render(<WithDialogs><SettingsScreen /></WithDialogs>);
    typeSearch("context lines");
    const diff = screen.getByRole("treeitem", { name: /Diff/ });
    expect(diff.textContent).toContain("1");
    // Pages with no hits stay listed rather than disappearing.
    expect(screen.getByRole("treeitem", { name: /Updates/ })).toBeTruthy();
  });

  it("finds a row by a keyword its label does not contain", () => {
    render(<WithDialogs><SettingsScreen /></WithDialogs>);
    typeSearch("gpg");
    expect(document.querySelector('[data-setting-id="commit.sign"]')).toBeTruthy();
  });

  it("shows an empty state and clears back to the page", () => {
    render(<WithDialogs><SettingsScreen /></WithDialogs>);
    typeSearch("zzzznope");
    expect(screen.getByText(/No settings match/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Clear search/ }));
    expect(document.querySelector('[data-settings-page="general.appearance"]')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `~/Library/pnpm/pnpm vitest run --project unit src/screens/settings.search.test.tsx`
Expected: FAIL — no `settings-search` testid behaviour; typing changes nothing.

- [ ] **Step 3: Build the results pane**

Create `src/features/settings/nav/SettingsResults.tsx`:

```tsx
import { PGButton } from "@/design";
import { SettingsFilterProvider } from "@/features/settings/layout/filterContext";

import { PAGES } from "./pages";
import type { IndexedRow } from "./match";
import type { SettingsPageId } from "./types";

export function SettingsResults({
  hits,
  query,
  onClear,
}: {
  hits: IndexedRow[];
  query: string;
  onClear: () => void;
}) {
  if (hits.length === 0) {
    return (
      <div style={{ padding: "48px 0", textAlign: "center", color: "var(--fg-2)" }}>
        <div style={{ fontSize: "var(--fs-13)", marginBottom: 12 }}>
          No settings match “{query}”.
        </div>
        <PGButton size="sm" variant="ghost" onClick={onClear}>
          Clear search
        </PGButton>
      </div>
    );
  }

  // Group hits by page, preserving registry order.
  const byPage = new Map<SettingsPageId, IndexedRow[]>();
  for (const hit of hits) {
    const list = byPage.get(hit.pageId);
    if (list) list.push(hit);
    else byPage.set(hit.pageId, [hit]);
  }
  const visibleRowIds = new Set(hits.map((h) => h.row.id));

  return (
    <>
      <div style={{ margin: "0 0 16px", color: "var(--fg-2)", fontSize: "var(--fs-12)" }}>
        {hits.length} {hits.length === 1 ? "result" : "results"} for “{query}”
      </div>
      {[...byPage.entries()].map(([pageId, pageHits]) => {
        const { Page, meta } = PAGES[pageId];
        return (
          <div key={pageId} data-settings-result-page={pageId}>
            <div
              style={{
                marginTop: 20,
                fontFamily: "var(--font-mono)",
                fontSize: "var(--fs-11)",
                color: "var(--fg-2)",
              }}
            >
              {pageHits[0].groupTitle} › {meta.title}
            </div>
            {/* The page renders itself; the filter context hides the rows that
                did not match, so the controls here are the real ones. */}
            <SettingsFilterProvider visibleRowIds={visibleRowIds}>
              <Page />
            </SettingsFilterProvider>
          </div>
        );
      })}
    </>
  );
}
```

- [ ] **Step 4: Wire the shell**

In `src/screens/Settings.tsx`, replace the `matchCounts={null}` placeholder from Task 10:

```tsx
  const index = useSettingsIndex();
  const searching = query.trim().length > 0;
  const hits = React.useMemo(
    () => (searching ? matchRows(query, index) : []),
    [searching, query, index],
  );
  const matchCounts = React.useMemo(
    () => (searching ? matchCountsByPage(hits) : null),
    [searching, hits],
  );
```

Pass `matchCounts` to `SettingsNav`, and in the right pane render `<SettingsResults hits={hits} query={query} onClear={() => setQuery("")} />` when `searching`, else today's single `<Page />` wrapped in `data-settings-page={pageId}`.

**Wrap the single-page branch in `<SettingsFilterProvider visibleRowIds={null}>`** so a page renders identically whether or not a search is active — without it, `SettingsCard`'s unregistered-card guard would behave differently in the two branches.

- [ ] **Step 5: Highlight matched terms**

In `src/features/settings/layout/SettingsCard.tsx`, add an optional `highlight?: string[]` to the filter context and have `SettingsRow` wrap matching substrings of its label:

```tsx
function highlightLabel(label: string, terms: string[]): React.ReactNode {
  if (terms.length === 0) return label;
  const re = new RegExp(`(${terms.map(escapeRe).join("|")})`, "ig");
  return label
    .split(re)
    .map((part, i) =>
      re.test(part) && terms.some((t) => part.toLowerCase() === t.toLowerCase()) ? (
        <span key={i} style={{ background: "var(--bg-selection)", color: "var(--fg-0)" }}>
          {part}
        </span>
      ) : (
        part
      ),
    );
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

Highlighting only applies while a query is active, and uses `--bg-selection` rather than any literal colour, so the accent-hue rule holds.

- [ ] **Step 6: Run to verify it passes**

Run: `~/Library/pnpm/pnpm vitest run --project unit src/screens/settings.search.test.tsx`
Expected: PASS — all six cases.

Note: the breadcrumb case asserts `getByText(/General.*Appearance/)`. Highlighting splits the *label* into spans, not the breadcrumb, so this stays a single text node. If a highlight ever breaks a `getByText`, the fix is a `data-` attribute on the breadcrumb, never removing the highlight.

- [ ] **Step 7: Verify the whole suite**

Run: `~/Library/pnpm/pnpm tsc --noEmit && ~/Library/pnpm/pnpm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/features/settings src/screens
git commit -m "feat(settings): search every page from one box" -m "Why: thirty-seven settings across ten pages needs a way in that is not
browsing. Typing returns every matching row grouped under its breadcrumb,
each rendering the control that actually changes the setting — no
navigating to the page first.

Pages render themselves under a filter context, so a result IS the real
row rather than a copy of it that could drift." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 13: E2E coverage and the docs

**Files:**
- Modify: `e2e/specs/settings.e2e.ts`
- Modify: `docs/dev/architecture.md`, `docs/dev/frontend.md`

**Interfaces:**
- Consumes: everything.
- Produces: nothing new.

- [ ] **Step 1: Add the e2e case**

Append to `e2e/specs/settings.e2e.ts`, inside the `describe("settings", …)`:

```ts
  // Navigation + search in the real webview. The unit tests cover matching and
  // filtering; what only a real run proves is that the side menu switches the
  // rendered page and that a search reaches rows on pages nobody navigated to.
  it("navigates to a page and searches across pages", async () => {
    await openSettings("git.diff");
    await expect($('[data-setting-id="diff.layout"]')).toBeExisting();
    // A page the user did not navigate to is genuinely not rendered.
    await expect($('[data-setting-id="appearance.zoom"]')).not.toBeExisting();

    await $('[data-testid="settings-search"]').setValue("theme");
    // Appearance rows appear without navigating to Appearance…
    await $('[data-setting-id="appearance.theme"]').waitForExist({
      timeout: 10_000,
      timeoutMsg: "search never surfaced the Appearance theme row",
    });
    // …and a non-matching row on the page we WERE on is filtered out.
    await expect($('[data-setting-id="diff.context"]')).not.toBeExisting();
  });
```

`waitForExist`, not `isDisplayed`: `isDisplayed` caches an `elementId` and never re-resolves it, so a re-render kills the wait and a bigger timeout cannot help. That is the root cause of the #364 flake class.

- [ ] **Step 2: Run the spec**

```bash
~/Library/pnpm/pnpm test:e2e:docker build
~/Library/pnpm/pnpm test:e2e:docker run --spec e2e/specs/settings.e2e.ts
```

Expected: PASS. If it reds, check whether the identical failure appears on a recent red `main` run before assuming it is this change — CI-only e2e flakes here are not confined to one shard.

- [ ] **Step 3: Update the architecture doc**

In `docs/dev/architecture.md`'s `features/` tree, expand the `settings/` entry with the new subdirectories — `layout/`, `nav/`, `pages/`, `theme/` — and one line each on what they own. `test/docs.test.ts` requires the qualified `features/<name>` or a `── <name>/` tree entry for every top-level feature directory; this task adds no new top-level directory, but the tree should still describe the structure accurately.

- [ ] **Step 4: Update the frontend doc**

Add a section to `docs/dev/frontend.md` covering: the declarative-meta model and why matching does not render; the guard test as the anti-drift mechanism; the `keywords` convention and why hints are not indexed; the Store gate on the index; and the rule that `data-setting-id` is selected exactly, never with `*=`.

Add the matching CLAUDE.md convention bullet, in the house style:

```markdown
- **Settings is a registry, not a screen** — every page under
  `features/settings/pages/` exports pure `meta` beside its component, so search
  matches without rendering. A new setting joins its page's `meta.cards[].rows`
  or `settings.index.test.tsx` fails the build; a word that lives only in a
  `hint` goes in `keywords`, because hints are `ReactNode` and are NOT indexed.
  The index reads `UpdateCapability`, so it gates on `updatesManagedExternally`
  like every other update surface. (`docs/dev/frontend.md`)
```

- [ ] **Step 5: Verify the doc gates**

Run: `~/Library/pnpm/pnpm test`
Expected: PASS, including the `docs` project.

- [ ] **Step 6: Commit**

```bash
git add e2e docs CLAUDE.md
git commit -m "test(settings): e2e for page navigation and cross-page search" -m "Why: the unit tests cover matching; only a real webview run proves the
side menu swaps the rendered page and that search reaches rows on pages
nobody navigated to.

Docs record the registry model, the keywords convention and the Store
gate on the index." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 14: Squash and open the PRs

**Files:** none.

- [ ] **Step 1: Confirm the tree is green after the last edit**

Run: `~/Library/pnpm/pnpm tsc --noEmit && ~/Library/pnpm/pnpm exec tsc -p e2e/tsconfig.json --noEmit && ~/Library/pnpm/pnpm test`
Expected: PASS. A green number is only evidence for the tree it ran on — this run must come after the final edit.

- [ ] **Step 2: Pin main's SHA before squashing**

```bash
git fetch origin
git rev-parse origin/main
```

Record the SHA. A concurrent PR landing between the fetch and the `reset --soft` would otherwise make the squashed commit revert it.

- [ ] **Step 3: Squash per stage and push**

The stage→PR mapping is at the top of this plan. For each stage, branch off the recorded SHA, squash that stage's commits into one Conventional Commit, and push:

```bash
git checkout -b feat/settings-layout-extract <recorded-sha>
# cherry-pick or reset --soft the stage's commits, then one commit
git push -u origin feat/settings-layout-extract
```

- [ ] **Step 4: Open each PR with a body file**

Use `--body-file`, never `--body "<prose>"` — the sandbox guard refuses the latter:

```bash
gh pr create --title "refactor(settings): one card/row layout pair" --body-file /Users/jonas/.claude/jobs/28c3614f/tmp/pr1.md
```

- [ ] **Step 5: Check for accidental closing keywords**

```bash
gh pr view <N> --json closingIssuesReferences
```

Expected: empty, unless an issue is genuinely being closed. "Does not close #145" still closes #145 — check the parsed field, never trust the body text.

- [ ] **Step 6: Merge each PR when GitHub reports it mergeable**

```bash
gh pr view <N> --json mergeable,mergeStateStatus
```

Merge with squash once `mergeable: MERGEABLE`. No rebase-before-merge is required: `required_linear_history` is satisfied by the squash merge itself and the required `e2e-linux` check is non-strict. Rebase only on `CONFLICTING`.

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: taxonomy → Tasks 3–6; declarative meta + types → Task 3; what search reads → Task 11; how filtering renders → Tasks 1 and 12; dynamic cards → Task 5 Step 3; conditional rows and the Store gate → Task 4 Step 3, Task 11 Steps 3–4; file layout → Tasks 1–6; nav intent, deep link, persistence, palette → Tasks 7–8; chrome and layout → Tasks 9–10; edge cases → Task 3 Step 2 (`resolvePageId`), Task 10 Step 1 (unknown id), Task 12 Step 3 (empty state); testing → every task, plus Task 13; suggested staging → Task 14.

**Two gaps found and closed while reviewing:** the plan originally left `PAGES` permanently cast (Task 6 Step 4 now removes it, restoring the exhaustiveness the type exists for), and the single-page branch was not wrapped in a filter provider, which would have made `SettingsCard`'s unregistered-card guard behave differently between the search and non-search branches (Task 12 Step 4).

**Type consistency.** `SettingsCard`/`SettingsRow` are used under those names from Task 1 onward — the plan never says `Section`/`Row` except when naming what is being deleted. `visibleRowIds` is `ReadonlySet<string> | null` everywhere. `resolvePageId`, `FIRST_PAGE`, `PAGE_ORDER`, `PAGES`, `GROUPS` keep one spelling. `buildIndex` takes `{ updatable: boolean }` in both its definition and its three call sites. `matchCountsByPage` returns `Map<SettingsPageId, number>`, which is what `SettingsNav`'s `matchCounts` prop accepts as `ReadonlyMap`.

**Two known risks the implementer should expect**, both with a stated fallback rather than a discovery mid-task: the `useSettingsStore` ↔ `nav/pages.ts` import cycle (Task 7 Step 3) and the `pages.ts` ↔ `match.ts` cycle (Task 11 Step 4).
