// Find-in-diff highlighting, at the two renderers that draw diff rows.
//
// The marks come from `lib/diffFind.ts` (the ROW model) and are reconciled with
// syntax and word-diff spans by `buildLineSpans`, so what is left to pin here is
// what reaches the DOM: every match visible, the current one distinct, and the
// selection split still intact — highlighting is the one feature that adds
// elements INSIDE the code cell, which is exactly where `.pg-selectable` lives.
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { PGWindowedDiff } from "./PGWindowedDiff";
import { selectionText } from "@/test/selectionText";
import { flattenDiffRows } from "@/lib/diffRows";
import type { FindMark } from "@/lib/diffFind";
import type { FileDiff } from "@/lib/types";

type Line = FileDiff["hunks"][number]["lines"][number];

const lines: Line[] = [
  { kind: { kind: "Context" }, oldLineno: 1, newLineno: 1, content: "one needle here" },
  { kind: { kind: "Deletion" }, oldLineno: 2, newLineno: null, content: "no hit" },
  { kind: { kind: "Addition" }, oldLineno: null, newLineno: 2, content: "two needle rows" },
];

const rows = flattenDiffRows(
  [{ header: "@@ -1,2 +1,2 @@", oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines }],
  { foldH: 22, rowH: 19 },
);

/** Marks for "needle": row 0 at 4..10, row 2 at 4..10; row 2's is the active one. */
const marks = new Map<number, FindMark[]>([
  [0, [{ start: 4, end: 10 }]],
  [2, [{ start: 4, end: 10, active: true }]],
]);
const findMarks = (i: number) => marks.get(i);

describe("find highlighting in PGWindowedDiff", () => {
  it("marks every match in view", () => {
    const { container } = render(<PGWindowedDiff rows={rows} findMarks={findMarks} />);
    const hits = container.querySelectorAll('[data-testid="diff-find-match"]');
    expect([...hits].map((el) => el.textContent)).toEqual(["needle", "needle"]);
  });

  it("makes the CURRENT match distinct from the rest", () => {
    const { container } = render(<PGWindowedDiff rows={rows} findMarks={findMarks} />);
    const active = container.querySelectorAll("[data-find-active]");
    expect(active).toHaveLength(1);
    expect(active[0].textContent).toBe("needle");
    // ...and it is the one on row 2, not merely "some match".
    expect(active[0].closest(".pg-selectable")?.textContent).toBe("two needle rows");
  });

  it("leaves rows with no match untouched", () => {
    const { container } = render(<PGWindowedDiff rows={rows} findMarks={findMarks} />);
    expect(container.textContent).toContain("no hit");
    expect(container.querySelectorAll('[data-testid="diff-find-match"]')).toHaveLength(2);
  });

  it("renders nothing extra when there is no query", () => {
    const { container } = render(<PGWindowedDiff rows={rows} />);
    expect(container.querySelectorAll('[data-testid="diff-find-match"]')).toHaveLength(0);
  });

  it("keeps the selection split: code selectable, gutters and marker not", () => {
    const { container } = render(<PGWindowedDiff rows={rows} findMarks={findMarks} />);
    expect([...container.querySelectorAll(".pg-selectable")].map((e) => e.textContent))
      .toEqual(["one needle here", "no hit", "two needle rows"]);
    // No line number, no +/- marker — the highlight spans did not open a hole.
    expect(selectionText(container)).toBe("one needle hereno hittwo needle rows");
  });
});
