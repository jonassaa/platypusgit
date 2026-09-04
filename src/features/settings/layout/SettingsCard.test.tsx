// The ONE card/row layout pair (was duplicated in Settings.tsx and
// ForgeSettings.tsx). The `data-setting-id` attribute is load-bearing: the
// guard test in settings.index.test.tsx reads it, and e2e selects rows by it.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { registerCardRows, SettingsCard, SettingsRow } from "./SettingsCard";
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
