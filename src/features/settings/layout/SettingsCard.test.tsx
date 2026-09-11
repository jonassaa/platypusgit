// The ONE card/row layout pair (was duplicated in Settings.tsx and
// ForgeSettings.tsx). The `data-setting-id` attribute is load-bearing: the
// guard test in settings.index.test.tsx reads it, and e2e selects rows by it.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  densityPadding,
  registerCardRows,
  SETTINGS_ROW_PADDING,
  SettingsCard,
  SettingsRow,
} from "./SettingsCard";
import { SettingsFilterProvider } from "./filterContext";
import { SettingsHighlightProvider } from "./highlightContext";

describe("SettingsCard / SettingsRow", () => {
  registerCardRows("diff", ["diff.layout", "diff.context"]);

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

  // Every settings row is a list-row surface, so it opts into UI density
  // (#70) rather than keeping one fixed height while the rest of the app
  // scales. The card header is deliberately excluded: it is chrome.
  it("sizes a row with UI density, and leaves the header fixed", () => {
    render(
      <SettingsCard id="diff" title="Diff">
        <SettingsRow id="diff.layout" label="Layout" control={<span>ctl</span>} />
      </SettingsCard>,
    );
    const row = document.querySelector<HTMLElement>('[data-setting-id="diff.layout"]');
    expect(row?.style.padding).toBe(SETTINGS_ROW_PADDING);
    // The header's EXACT padding, not merely "no --row-step in it": deleting
    // the header's padding altogether satisfies a `not.toContain` while the
    // card title sits flush against the border, and "the header keeps its
    // fixed chrome padding" is the claim being pinned. Asserted non-null
    // first, because a wrapped header makes the query null and chai then
    // reports an argument-type error instead of "header not found".
    const header = document.querySelector<HTMLElement>(
      '[data-settings-card="diff"] > header',
    );
    expect(header).not.toBeNull();
    expect(header?.style.padding).toBe("12px 16px 10px");
  });

  // `--row-step` is the whole extra row height, so vertical padding takes HALF
  // of it; spelling `var(--row-step)` without the `/ 2` double-counts, the trap
  // src/index.css names. No `toContain("var(--row-step)")` can see that — jsdom
  // does not resolve calc() — so the token math is pinned as a string here and
  // as real geometry in e2e/specs/settings.e2e.ts.
  it("takes half a step, so density is not double-counted", () => {
    expect(densityPadding(12)).toBe("calc(12px + var(--row-step) / 2) 16px");
    expect(densityPadding(10)).toBe("calc(10px + var(--row-step) / 2) 16px");
    expect(SETTINGS_ROW_PADDING).toBe(densityPadding(12));
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

  // The precise bug `highlightLabel` was written to avoid: deciding each split
  // part by membership in a lowercased Set, never by re-testing the same
  // stateful `/g` regex against it. A label where the term occurs twice
  // ("Banana" contains "an" at index 1 AND index 3) is exactly the case a
  // `.test()`/`.exec()` reuse bug drops to one hit — e.g. re-scanning the
  // whole label after each match with `re.test(label)` "to confirm it still
  // matches" silently consumes the NEXT occurrence's position too. The
  // control is a <button>, not a <span>, so every <span> found under the row
  // is a highlight and nothing else.
  it("highlights every occurrence of a repeated search term, not just the first", () => {
    render(
      <SettingsFilterProvider visibleRowIds={null}>
        <SettingsHighlightProvider terms={["an"]}>
          <SettingsCard id="diff" title="Diff">
            <SettingsRow
              id="diff.layout"
              label="Banana"
              control={<button type="button">ctl</button>}
            />
          </SettingsCard>
        </SettingsHighlightProvider>
      </SettingsFilterProvider>,
    );
    const row = document.querySelector('[data-setting-id="diff.layout"]');
    const spans = row!.querySelectorAll("span");
    expect(spans.length).toBe(2);
    expect(spans[0].textContent).toBe("an");
    expect(spans[1].textContent).toBe("an");
    // The unhighlighted characters are still there, in order.
    expect(row!.textContent).toContain("Banana");
  });
});
