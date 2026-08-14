import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PGWindowedDiff } from "./PGWindowedDiff";
import { flattenDiffRows } from "@/lib/diffRows";
import type { FileDiff } from "@/lib/types";

/** 50 lines, alternating addition and context, so changed indices are 0,1,2… */
const bigHunk: FileDiff["hunks"] = [
  {
    header: "@@ -1,50 +1,50 @@",
    oldStart: 1,
    oldLines: 50,
    newStart: 1,
    newLines: 50,
    lines: Array.from({ length: 50 }, (_, i) =>
      i % 2 === 0
        ? {
            kind: { kind: "Addition" as const },
            oldLineno: null,
            newLineno: i + 1,
            content: `line ${i}`,
          }
        : {
            kind: { kind: "Context" as const },
            oldLineno: i + 1,
            newLineno: i + 1,
            content: `line ${i}`,
          },
    ),
  },
];

const rows = flattenDiffRows(bigHunk, { headerH: 26, rowH: 19 });

describe("PGWindowedDiff", () => {
  it("renders every row when no window is given", () => {
    render(<PGWindowedDiff rows={rows} />);
    expect(screen.getByText("line 0")).toBeInTheDocument();
    expect(screen.getByText("line 49")).toBeInTheDocument();
  });

  it("renders only the windowed slice, with a spacer standing in for the rest", () => {
    render(
      <PGWindowedDiff rows={rows} window={{ start: 0, end: 6, topPad: 0, bottomPad: 855 }} />,
    );
    expect(screen.getByText("line 0")).toBeInTheDocument();
    expect(screen.queryByText("line 49")).not.toBeInTheDocument();
    const spacer = document.querySelector('[data-pg-spacer="bottom"]') as HTMLElement;
    expect(spacer.style.height).toBe("855px");
  });

  it("keeps changedIndex ABSOLUTE in a mid-list slice", () => {
    // The whole point of numbering before windowing (#61 D7): a click in a slice
    // must report the hunk-wide index, or staging targets the wrong line.
    const clicks: Array<[number, number]> = [];
    const target = rows[21];
    if (target.kind !== "line" || target.line.changedIndex === undefined) {
      throw new Error("fixture must put a changed line at row 21");
    }
    render(
      <PGWindowedDiff
        rows={rows}
        window={{ start: 20, end: 26, topPad: 387, bottomPad: 500 }}
        onLineClick={(h, c) => clicks.push([h, c])}
      />,
    );
    fireEvent.click(screen.getByText(target.line.text!));
    expect(clicks).toEqual([[0, target.line.changedIndex]]);
  });

  it("marks the active hunk's header, which is how F7 navigation is addressed", () => {
    render(<PGWindowedDiff rows={rows} activeHunk={0} />);
    const header = document.querySelector('[data-hunk-index="0"]');
    expect(header).not.toBeNull();
    expect(header?.getAttribute("data-hunk-active")).toBe("");
  });

  it("routes stage and collapse per hunk index", () => {
    const onToggleHunk = vi.fn();
    const onStage = vi.fn();
    render(
      <PGWindowedDiff
        rows={rows}
        onToggleHunk={onToggleHunk}
        hunkActions={() => ({ onStage })}
      />,
    );
    fireEvent.click(screen.getByTestId("hunk-stage"));
    expect(onStage).toHaveBeenCalled();
  });

  it("renders no spacer when the window covers everything", () => {
    render(
      <PGWindowedDiff
        rows={rows}
        window={{ start: 0, end: rows.length, topPad: 0, bottomPad: 0 }}
      />,
    );
    expect(document.querySelector("[data-pg-spacer]")).toBeNull();
  });
});
