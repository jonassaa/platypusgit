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

/** Rows inside a `dynamic` card are data-driven; the DOM check skips them. */
function isDynamicRow(pageId: SettingsPageId, rowId: string): boolean {
  return PAGES[pageId].meta.cards.some(
    (c) => c.dynamic && c.rows.some((r) => r.id === rowId),
  );
}
