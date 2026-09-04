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
import { UpdatesPage } from "@/features/settings/pages/updates";
import { useUpdateStore } from "@/features/update/useUpdateStore";

/**
 * Pages actually in the registry.
 *
 * TASK 6: revert every use of this back to PAGE_ORDER. `PAGES` is incomplete
 * until Task 6 registers the last three pages, so a case that walks all ten
 * ids would dereference `undefined` for the nine that do not exist yet.
 */
const REGISTERED = PAGE_ORDER.filter((p) => p in PAGES);

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
  });

  it("declares exactly the rows each page renders", () => {
    for (const pageId of REGISTERED) {
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

  it("renders each row's label exactly as its meta declares", () => {
    // Search matches on `meta.label` (SettingRowMeta's docstring promises this
    // is enforced) — a drifted label would make a search result show text the
    // user never actually sees on screen.
    for (const pageId of REGISTERED) {
      const { Page, meta } = PAGES[pageId];
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
          // Absent under the default render (a gated row, or the other half
          // of a follow-system/fixed toggle) — nothing to compare here; the
          // both-directions id check above already pins presence.
          if (!row) continue;
          const labelText = row.firstElementChild?.firstElementChild
            ?.textContent?.trim();
          expect(labelText, `${pageId}/${rowMeta.id} label`).toBe(
            rowMeta.label,
          );
        }
      }
      unmount();
    }
  });

  it("gives every row a unique id app-wide", () => {
    const all = REGISTERED.flatMap((p) =>
      PAGES[p].meta.cards.flatMap((c) => c.rows.map((r) => r.id)),
    );
    expect(new Set(all).size, `duplicate row id in ${all.join(", ")}`).toBe(all.length);
  });

  it("puts every page in exactly one non-empty group", () => {
    for (const group of GROUPS) {
      expect(group.pages.length, `${group.id} has no pages`).toBeGreaterThan(0);
    }
    const fromGroups = GROUPS.flatMap((g) => g.pages).filter((p) => REGISTERED.includes(p)).sort();
    expect(fromGroups).toEqual([...REGISTERED].sort());
    for (const pageId of REGISTERED) {
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
