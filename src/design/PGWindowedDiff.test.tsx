import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PGWindowedDiff } from "./PGWindowedDiff";
import { flattenDiffRows } from "@/lib/diffRows";
import type { FileDiff } from "@/lib/types";

/**
 * 50 lines, alternating addition and context, so changed indices are 0,1,2… —
 * behind the `HunkHeader` line the backend's commit-diff builder puts at the front
 * of every hunk's `lines[]` (#161). The fixture carries it because the version
 * without it let `renders no @@ text anywhere` pass while `@@` was on screen.
 */
const bigHunk: FileDiff["hunks"] = [
  {
    header: "@@ -1,50 +1,50 @@",
    oldStart: 1,
    oldLines: 50,
    newStart: 1,
    newLines: 50,
    lines: [
      {
        kind: { kind: "HunkHeader" as const },
        oldLineno: null,
        newLineno: null,
        content: "@@ -1,50 +1,50 @@\n",
      },
      ...Array.from({ length: 50 }, (_, i) =>
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
    ],
  },
];

const rows = flattenDiffRows(bigHunk, { foldH: 22, rowH: 19 });

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
    const target = rows[20];
    if (target.kind !== "line" || target.line.changedIndex === undefined) {
      throw new Error("fixture must put a changed line at row 20");
    }
    render(
      <PGWindowedDiff
        rows={rows}
        window={{ start: 20, end: 26, topPad: 380, bottomPad: 500 }}
        onLineClick={(h, c) => clicks.push([h, c])}
      />,
    );
    fireEvent.click(screen.getByText(target.line.text!));
    expect(clicks).toEqual([[0, target.line.changedIndex]]);
  });

  it("marks the active hunk's ANCHOR row, which is how F7 navigation is addressed", () => {
    // Since #157 the host is the hunk's first changed line, not a `@@` banner —
    // so it must also be the row that actually holds the first addition.
    render(<PGWindowedDiff rows={rows} activeHunk={0} />);
    const anchor = document.querySelector('[data-hunk-index="0"]');
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute("data-hunk-active")).toBe("");
    expect(anchor?.textContent).toContain("line 0");
  });

  it("puts exactly one anchor host in the DOM per hunk", () => {
    render(<PGWindowedDiff rows={rows} />);
    expect(document.querySelectorAll("[data-hunk-index]")).toHaveLength(1);
  });

  it("renders no `@@` text anywhere", () => {
    const { container } = render(<PGWindowedDiff rows={rows} />);
    expect(container.textContent).not.toContain("@@");
  });

  it("routes stage per hunk index, from the gutter cluster on the anchor row", () => {
    const onStage = vi.fn();
    render(<PGWindowedDiff rows={rows} hunkActions={() => ({ onStage })} />);
    const stage = screen.getByTestId("hunk-stage");
    // The cluster hangs off the anchor row, which is what makes it addressable
    // without a per-hunk wrapper the windowing could split.
    expect(stage.closest("[data-hunk-index]")).not.toBeNull();
    fireEvent.click(stage);
    expect(onStage).toHaveBeenCalled();
  });

  it("names the selection in the stage button, and stays wordless without one", () => {
    const { unmount } = render(
      <PGWindowedDiff
        rows={rows}
        hunkActions={() => ({ onStage: () => {} })}
        selectedLines={() => [0, 1, 2]}
      />,
    );
    expect(screen.getByTestId("hunk-stage").textContent).toMatch(/3 lines/);
    unmount();
    render(<PGWindowedDiff rows={rows} hunkActions={() => ({ onStage: () => {} })} />);
    expect(screen.getByTestId("hunk-stage").textContent).not.toMatch(/line/i);
  });

  it("suppresses line selection when the hunk's actions are disabled", () => {
    // Whitespace-ignoring diffs are a rewritten view, so their indices do not
    // address the lines git would apply (#61 D2) — selecting must be off.
    const onLineClick = vi.fn();
    render(
      <PGWindowedDiff
        rows={rows}
        onLineClick={onLineClick}
        hunkActions={() => ({ actionsDisabledReason: "whitespace ignored" })}
      />,
    );
    expect(document.querySelectorAll('[data-testid="diff-line-changed"]')).toHaveLength(0);
    fireEvent.click(screen.getByText("line 0"));
    expect(onLineClick).not.toHaveBeenCalled();
  });

  // Chunked mode's separator. The fixture's one change is at line 5 of a file that
  // starts above it, so there is a leading gap to name.
  const gapped: FileDiff["hunks"] = [
    {
      header: "@@ -5,1 +5,1 @@",
      oldStart: 5,
      oldLines: 1,
      newStart: 5,
      newLines: 1,
      lines: [
        { kind: { kind: "Deletion" as const }, oldLineno: 5, newLineno: null, content: "was" },
        { kind: { kind: "Addition" as const }, oldLineno: null, newLineno: 5, content: "now" },
      ],
    },
  ];
  const gappedRows = flattenDiffRows(gapped, { foldH: 22, rowH: 19, gaps: "fold" });

  it("names a folded gap and offers to expand it", () => {
    const onExpandGap = vi.fn();
    render(<PGWindowedDiff rows={gappedRows} onExpandGap={onExpandGap} />);
    const fold = screen.getByTestId("fold-expand");
    expect(fold.textContent).toMatch(/4 unchanged lines/);
    fireEvent.click(fold);
    expect(onExpandGap).toHaveBeenCalledWith(0);
  });

  it("leaves the separator informational when nothing can expand it", () => {
    render(<PGWindowedDiff rows={gappedRows} />);
    expect(screen.getByTestId("fold-expand")).toBeDisabled();
    // The range is still stated — that is the whole point of replacing `@@`.
    expect(document.querySelector("[data-pg-fold]")?.textContent).toContain("1–4");
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
