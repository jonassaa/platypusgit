// THE guard test for the settings registry.
//
// Every page declares its rows and cards as data (`meta`) so search can match
// without rendering. That only stays true if the data cannot drift from what
// renders, which is what this file enforces: mount each page, read
// `data-setting-id` and `data-settings-card` out of the DOM, and compare the
// two sets BOTH ways. A row that renders but is not declared is invisible to
// search; a row declared but never rendered is a dead search result. Cards get
// the same treatment plus a title check, because `registerCardRows` keys its
// module-global map by card id and `cardHasVisibleRow` answers false for a
// card nobody registered — so a rendered card id that drifts from its declared
// one drops every matching row on it out of the results pane, silently.
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

function renderedCards(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-settings-card]"));
}

function renderedCardIds(container: HTMLElement): string[] {
  return renderedCards(container)
    .map((el) => el.getAttribute("data-settings-card")!)
    .sort();
}

function declaredCardIds(pageId: SettingsPageId): string[] {
  return PAGES[pageId].meta.cards.map((c) => c.id).sort();
}

/**
 * A rendered card's title, as the user reads it.
 *
 * `SettingsCard` renders `<section data-settings-card><header><div>{title}
 * </div>{subtitle && <div>…</div>}</header>` — so the header's FIRST child
 * div is the title and nothing else. Reading it positionally (rather than by
 * text) is what makes the comparison below a real check: matching on the
 * declared string would pass whatever the DOM said.
 */
function renderedCardTitle(card: HTMLElement): string | undefined {
  return card.querySelector("header")?.firstElementChild?.textContent?.trim();
}

/**
 * Row ids a page declares.
 *
 * Gated rows (`when: …`) are included on purpose, and the render states are
 * what makes that safe:
 *
 * - `when: "updatable"` — every page mounts under the DEFAULT update
 *   capability (`capability: null`, `useUpdateStore`'s initial state), and
 *   `updatesManagedExternally(null)` is `false`, so `UpdatesPage`'s ordinary
 *   branch renders and its gated rows genuinely appear in the DOM. (The INDEX
 *   reads `null` the other way — see `useSettingsIndex` — but that is the
 *   index's call, not the page's, and this file checks the page.) The
 *   Store-managed case gets its own case below, under "the update gate".
 * - `when: "themeFixed"` / `"themeFollowsSystem"` — neither mode renders all
 *   three Appearance rows, which is exactly what `PAGE_RENDER_STATES` is for:
 *   each state's render is checked as a SUBSET of `declared`, and only the
 *   union across states has to equal it.
 *
 * Excluding gated rows here would make `declared` a subset of `rendered` and
 * hide a real drift.
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

  it("declares exactly the cards each page renders", () => {
    // The card half of the drift guard, and it is not cosmetic:
    // `registerCardRows` keys a module-global map by CARD id, and
    // `cardHasVisibleRow` returns false for a card nobody registered. So a
    // rendered `<SettingsCard id=…>` that disagrees with its declared
    // `meta.cards[].id` — a typo, a one-sided rename — makes every matching
    // row on that card silently vanish from the search results pane while
    // every other test in the suite still passes. Both directions: an
    // undeclared rendered card is unreachable by search, a declared card that
    // never renders is a dead row group.
    for (const pageId of PAGE_ORDER) {
      const { Page } = PAGES[pageId];
      const declared = declaredCardIds(pageId);
      for (const state of renderStatesFor(pageId)) {
        applyState(state);
        const { container, unmount } = render(
          <WithDialogs>
            <Page />
          </WithDialogs>,
        );
        expect(
          renderedCardIds(container),
          `${pageId} (${state.name}): rendered cards vs declared cards`,
        ).toEqual(declared);
        unmount();
      }
    }
  });

  it("gives every card a unique id app-wide", () => {
    // `CARD_ROWS` in SettingsCard.tsx is one flat map keyed by card id and
    // written once per card at module load — last write wins. Two pages
    // sharing an id would cross-wire their row visibility: one page's card
    // would decide whether it is empty from the OTHER page's row ids. (Not
    // hypothetical: mid-refactor a card still left behind in `Settings.tsx`
    // and `git.remote`'s new card both carried the id `pull` for two commits.
    // It was inert only because no search existed yet.)
    const all = PAGE_ORDER.flatMap((p) => declaredCardIds(p));
    expect(new Set(all).size, `duplicate card id in ${all.join(", ")}`).toBe(all.length);
  });

  it("renders each card's title exactly as its meta declares", () => {
    // Card titles are folded into the search haystack (`buildIndex` joins the
    // row label, its keywords, the CARD title and the page title), so a title
    // edited in the JSX but not in `meta` makes search match text the user
    // cannot see anywhere — the same defect the row-label check below exists
    // to catch, one level up. Every declared card duplicates its title string
    // between `meta` and the JSX beside it; this is what keeps the two equal.
    for (const pageId of PAGE_ORDER) {
      const { Page, meta } = PAGES[pageId];
      for (const state of renderStatesFor(pageId)) {
        applyState(state);
        const { container, unmount } = render(
          <WithDialogs>
            <Page />
          </WithDialogs>,
        );
        for (const card of renderedCards(container)) {
          const id = card.getAttribute("data-settings-card")!;
          const declared = meta.cards.find((c) => c.id === id);
          expect(
            renderedCardTitle(card),
            `${pageId}/${id} card title (${state.name})`,
          ).toBe(declared?.title);
        }
        unmount();
      }
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

describe("the theme-mode gates", () => {
  it("gates Appearance's mutually-exclusive rows to the mode that renders them", () => {
    // `PAGE_RENDER_STATES` above already proves each of these three renders in
    // exactly one of the two modes; this pins WHICH one to the gate the index
    // filters on, so light/dark and the single picker cannot be swapped
    // without a failure. Getting it wrong the other way round would put the
    // light/dark pair in the index while the theme is fixed — a search hit
    // that renders an empty card.
    const rows = PAGES["general.appearance"].meta.cards.flatMap((c) => c.rows);
    const gateOf = (id: string) => rows.find((r) => r.id === id)?.when;
    expect(gateOf("appearance.light")).toBe("themeFollowsSystem");
    expect(gateOf("appearance.dark")).toBe("themeFollowsSystem");
    expect(gateOf("appearance.theme")).toBe("themeFixed");
    // The mode toggle is how you reach either branch — never gated.
    expect(gateOf("appearance.follow")).toBeUndefined();
  });
});

/** Rows inside a `dynamic` card are data-driven; the DOM check skips them. */
function isDynamicRow(pageId: SettingsPageId, rowId: string): boolean {
  return PAGES[pageId].meta.cards.some(
    (c) => c.dynamic && c.rows.some((r) => r.id === rowId),
  );
}
