// THE guard test for the settings registry.
//
// Every page declares its rows as data (`meta`) so search can match without
// rendering. That only stays true if the data cannot drift from what renders,
// which is what this file enforces: mount each page, read `data-setting-id`
// out of the DOM, and compare the two sets BOTH ways. A row that renders but
// is not declared is invisible to search; a row declared but never rendered is
// a dead search result.
//
// Some pages render a mutually-exclusive subset of their declared rows
// depending on other state (Appearance: the light/dark pair while following
// the OS, one theme picker while fixed) — no SINGLE render can contain every
// declared row for those pages, so the both-directions check runs across a
// small set of named render states per page (`PAGE_RENDER_STATES`) and
// compares per-state subsets plus the union, rather than one flat render.
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { mockInvoke } from "@/test/invokeMock";
import { WithDialogs, resetDialogs } from "@/test/dialog";
import { GROUPS, PAGES, PAGE_ORDER, resolvePageId, FIRST_PAGE } from "@/features/settings/nav/pages";
import { PAGE_ORDER as RESOLUTION_ORDER } from "@/features/settings/nav/types";
import type { SettingsPageId } from "@/features/settings/nav/types";
import { UpdatesPage } from "@/features/settings/pages/updates";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { useUpdateStore } from "@/features/update/useUpdateStore";

interface RenderState {
  name: string;
  setup: () => void;
}

/**
 * Render states a page must be checked in.
 *
 * Some pages render mutually-exclusive row sets: Appearance shows the
 * light/dark pair while following the OS and the single theme picker
 * otherwise (`AppearancePage`'s `following ? (...) : (...)`), so no ONE
 * render can contain every declared row. Checking the union across states
 * keeps both directions of the drift guard intact — a declared row that never
 * renders in any state is missing from the union, and a rendered row that is
 * not declared breaks the per-state subset check.
 *
 * `dynamic` is NOT the tool for this: it means "data-driven, no stable
 * per-row ids" (a list of forge hosts, say) and changes how search renders
 * the whole card in full rather than filtering it per row. Appearance's rows
 * have stable, known-in-advance ids; they are merely conditionally rendered.
 */
const PAGE_RENDER_STATES: Partial<Record<SettingsPageId, readonly RenderState[]>> = {
  "general.appearance": [
    {
      name: "fixed theme",
      setup: () => useSettingsStore.getState().setThemeFollowMode("fixed"),
    },
    {
      name: "following the OS",
      setup: () => useSettingsStore.getState().setThemeFollowMode("system"),
    },
  ],
};

/** Every page not listed in `PAGE_RENDER_STATES` gets checked in one state. */
const DEFAULT_STATES: readonly RenderState[] = [{ name: "default", setup: () => {} }];

function renderStatesFor(pageId: SettingsPageId): readonly RenderState[] {
  return PAGE_RENDER_STATES[pageId] ?? DEFAULT_STATES;
}

/**
 * Reset to a known baseline, then apply one named state's setup.
 *
 * The reset matters as much as the setup: without it, "fixed theme" run right
 * after "following the OS" would just be whatever the previous state left
 * behind, and the case would stop proving `setThemeFollowMode("fixed")`
 * actually produces the fixed-mode render rather than merely not having
 * called `setThemeFollowMode("system")` yet.
 */
function applyState(state: RenderState): void {
  useSettingsStore.getState().reset();
  state.setup();
}

function renderedRowIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("[data-setting-id]"))
    .map((el) => el.getAttribute("data-setting-id")!)
    .sort();
}

/**
 * Row ids a page declares.
 *
 * Gated rows (`when: "updatable"`) are included on purpose: the guard test
 * mounts every page under the DEFAULT update capability (`capability: null`,
 * `useUpdateStore`'s initial state), and `updatesManagedExternally(null)` is
 * `false` — so `UpdatesPage`'s ordinary branch renders, and its gated rows
 * genuinely appear in the DOM. Excluding them here would make `declared` a
 * subset of `rendered` and hide a real drift. The Store-managed case (where
 * the gated rows really are absent) gets its own case below, under "the
 * update gate".
 */
function declaredRowIds(pageId: SettingsPageId): string[] {
  return PAGES[pageId].meta.cards
    .filter((c) => !c.dynamic)
    .flatMap((c) => c.rows)
    .map((r) => r.id)
    .sort();
}

describe("settings registry", () => {
  beforeEach(() => {
    resetDialogs();
    // Every case starts from the default, unmanaged capability — a case that
    // sets it to "store-managed" (below) must not leak into its neighbours.
    useUpdateStore.setState({ capability: null });
    // general.updates' useEffect calls loadCapability() on every mount here,
    // capability: null or not — it does not short-circuit that call. Left
    // unmocked, that is a real (if silently-swallowed) unmocked IPC call in
    // every case in this suite.
    mockInvoke("get_update_capability", () => "self-update");
    // advanced.cli's CliPage and advanced.backup's BackupPage each fire a real
    // IPC call on mount too — cli_shim_status and diagnostics_report — whose
    // rejection an empty catch swallows silently. Same reasoning as
    // get_update_capability above; see Settings.cli.test.tsx and
    // Settings.diagnostics.test.tsx for the shapes.
    mockInvoke("cli_shim_status", () => ({
      installed: false,
      shimPath: "/usr/local/bin/pgit",
      target: "/Applications/PlatypusGit.app/Contents/MacOS/platypusgit",
      source: "none",
      pathState: "onPath",
    }));
    mockInvoke("diagnostics_report", () => ({
      logPath: "/home/jonas/.local/share/io.github.jonassaa.platypusgit/logs/platypusgit.log",
      logExists: true,
      logSizeBytes: 4096,
      environment:
        "host os=linux arch=x86_64 kernel=5.15.153.1-microsoft-standard-WSL2 wsl=Ubuntu-24.04 git=2.43.0",
      version: "0.1.0",
    }));
  });

  it("declares exactly the rows each page renders", () => {
    for (const pageId of PAGE_ORDER) {
      const { Page } = PAGES[pageId];
      const declared = declaredRowIds(pageId);
      const union = new Set<string>();
      for (const state of renderStatesFor(pageId)) {
        applyState(state);
        const { container, unmount } = render(
          <WithDialogs>
            <Page />
          </WithDialogs>,
        );
        const rendered = renderedRowIds(container).filter(
          (id) => !isDynamicRow(pageId, id),
        );
        for (const id of rendered) union.add(id);
        // Every row this ONE state renders must be declared — a row that
        // renders but is not declared is invisible to search regardless of
        // which state produced it.
        const undeclared = rendered.filter((id) => !declared.includes(id));
        expect(
          undeclared,
          `${pageId} (${state.name}): rendered but not declared`,
        ).toEqual([]);
        unmount();
      }
      // The UNION across every named state must equal declared exactly — a
      // row that never renders in ANY reachable state is a dead search
      // result. A page with only the implicit "default" state (no toggles)
      // still has to clear this in a single pass, same as before.
      expect(
        [...union].sort(),
        `${pageId}: declared rows vs the union of every state's render`,
      ).toEqual(declared);
    }
  });

  it("renders each row's label exactly as its meta declares", () => {
    // Search matches on `meta.label` (SettingRowMeta's docstring promises this
    // is enforced) — a drifted label would make a search result show text the
    // user never actually sees on screen. Checked across every render state so
    // a conditionally-rendered row (Appearance's light/dark/theme trio) is
    // checked in the state where it actually appears, not skipped entirely.
    for (const pageId of PAGE_ORDER) {
      const { Page, meta } = PAGES[pageId];
      for (const state of renderStatesFor(pageId)) {
        applyState(state);
        const { container, unmount } = render(
          <WithDialogs>
            <Page />
          </WithDialogs>,
        );
        for (const card of meta.cards) {
          if (card.dynamic) continue;
          for (const rowMeta of card.rows) {
            const row = container.querySelector(
              `[data-setting-id="${rowMeta.id}"]`,
            );
            // Not rendered in THIS state (gated, or the other half of a
            // toggle) — the id check above already pins presence overall.
            if (!row) continue;
            const labelText = row.firstElementChild?.firstElementChild
              ?.textContent?.trim();
            expect(
              labelText,
              `${pageId}/${rowMeta.id} label (${state.name})`,
            ).toBe(rowMeta.label);
          }
        }
        unmount();
      }
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

  it("keeps types.ts's resolution-order list in sync with GROUPS, members AND order", () => {
    // The mapped-type check above ("registers every SettingsPageId") catches
    // a new union member missing from GROUPS, but not the two lists drifting
    // in ORDER — and a GROUPS reorder would leave FIRST_PAGE (and
    // resolvePageId's fallback) disagreeing with the side menu's own first
    // row, which is user-visible. toEqual on arrays checks order too, so this
    // is a stronger claim than the sorted-and-compared check above.
    expect(RESOLUTION_ORDER).toEqual(PAGE_ORDER);
  });

  it("resolves an unrecognised persisted page id to the first page", () => {
    expect(resolvePageId("git.diff")).toBe("git.diff");
    expect(resolvePageId("nope.gone")).toBe(FIRST_PAGE);
    expect(resolvePageId(undefined)).toBe(FIRST_PAGE);
    expect(resolvePageId(42)).toBe(FIRST_PAGE);
    expect(FIRST_PAGE).toBe("general.appearance");
  });
});

describe("the update gate", () => {
  beforeEach(() => {
    resetDialogs();
    useUpdateStore.setState({ capability: null });
  });

  it("declares the check and channel rows as gated", () => {
    const rows = PAGES["general.updates"].meta.cards.flatMap((c) => c.rows);
    expect(rows.find((r) => r.id === "updates.check")?.when).toBe("updatable");
    expect(rows.find((r) => r.id === "updates.channel")?.when).toBe("updatable");
    // The version row is NOT gated — it is what a Store install still shows.
    expect(rows.find((r) => r.id === "updates.version")?.when).toBeUndefined();
  });

  it("drops the update check and channel on a Store install", () => {
    // Store policy 10.2.5 makes NAMING an update check the violation, not just
    // offering one — v0.4.0 failed certification on exactly this. The page must
    // render neither row when updates are managed externally.
    useUpdateStore.setState({ capability: "store-managed" });
    const { container, unmount } = render(
      <WithDialogs>
        <UpdatesPage />
      </WithDialogs>,
    );
    const ids = renderedRowIds(container);
    expect(ids).toContain("updates.version");
    expect(ids).not.toContain("updates.check");
    expect(ids).not.toContain("updates.channel");
    unmount();
  });
});

/** Rows inside a `dynamic` card are data-driven; the DOM check skips them. */
function isDynamicRow(pageId: SettingsPageId, rowId: string): boolean {
  return PAGES[pageId].meta.cards.some(
    (c) => c.dynamic && c.rows.some((r) => r.id === rowId),
  );
}
