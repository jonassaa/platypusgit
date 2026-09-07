// PGButtonGroup — a segmented control's labels must never wrap.
//
// The group is a flex item in PGToolbar's row: `display: flex`, no wrap, a
// fixed 36px height. Narrow the window and flexbox squeezes every shrinkable
// item in that row, so a two-word label ("This branch" in History's All / This
// branch scope, "Existing branch" in WorktreeAddDialog, "Comfortable" beside
// "Compact" in Settings) broke at its space and stacked two lines inside a
// 22px-high button, bulging the toolbar out of its own height.
//
// `white-space: nowrap` is also what stops the squeeze itself: it raises each
// button's min-content width, and a flex item's automatic minimum size is its
// min-content size, so the group holds its width instead of being clipped. The
// same property is already on PGButton for the same reason.
//
// jsdom has no layout, so a wrap cannot be observed here — this pins the
// property that produces the behaviour. The pixels were verified separately
// with a headless screenshot of the History toolbar from 1174px down to 380px.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { PGButtonGroup } from "./primitives";

/** History's scope selector, verbatim — the reported case. */
const SCOPE = [
  { value: "all", label: "All" },
  { value: "branch", label: "This branch" },
];

describe("PGButtonGroup", () => {
  it("never lets an option label wrap", () => {
    render(<PGButtonGroup value="all" options={SCOPE} />);
    for (const opt of SCOPE) {
      const btn = screen.getByRole("button", { name: opt.label });
      expect(btn.style.whiteSpace).toBe("nowrap");
    }
  });

  it("keeps a multi-word label in one element, unbroken", () => {
    // A label split across two nodes could still wrap between them however the
    // white-space declaration reads.
    render(<PGButtonGroup value="branch" options={SCOPE} />);
    const btn = screen.getByRole("button", { name: "This branch" });
    expect(btn.textContent).toBe("This branch");
  });

  it("holds the rule for the wider groups too", () => {
    // Branches' five-option filter is the widest group in a toolbar, and the
    // narrow-column ones sit in dialogs and Settings cards.
    const wide = [
      { value: "all", label: "All" },
      { value: "local", label: "Local" },
      { value: "remote", label: "Remote" },
      { value: "tags", label: "Tags" },
      { value: "stashes", label: "Stashes" },
      { value: "existing", label: "Existing branch" },
    ];
    render(<PGButtonGroup value="all" options={wide} />);
    for (const opt of wide) {
      expect(
        screen.getByRole("button", { name: opt.label }).style.whiteSpace
      ).toBe("nowrap");
    }
  });
});
