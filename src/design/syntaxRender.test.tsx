// Syntax spans in diff rows, and how they compose with word-diff marks.
//
// Goes through the production path: flattenDiffRows resolves each row's tokens
// from the correct SIDE of the diff, and PGWindowedDiff renders them.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PGWindowedDiff } from "./PGWindowedDiff";
import { flattenDiffRows } from "@/lib/diffRows";
import type { SyntaxLine } from "@/lib/syntax";
import type { FileDiff } from "@/lib/types";

type Line = FileDiff["hunks"][number]["lines"][number];

const rem = (n: number, content: string): Line => ({
  kind: { kind: "Deletion" }, oldLineno: n, newLineno: null, content,
});
const add = (n: number, content: string): Line => ({
  kind: { kind: "Addition" }, oldLineno: null, newLineno: n, content,
});
const ctx = (n: number, content: string): Line => ({
  kind: { kind: "Context" }, oldLineno: n, newLineno: n, content,
});

function renderLines(
  lines: Line[],
  syntax?: { old: SyntaxLine[] | null; new: SyntaxLine[] | null },
) {
  const rows = flattenDiffRows(
    [{ header: "@@ -1 +1 @@", oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines }],
    { headerH: 26, rowH: 19, syntax },
  );
  return render(<PGWindowedDiff rows={rows} />);
}

describe("syntax spans in diff rows", () => {
  it("wraps scoped ranges in a classed span", () => {
    renderLines([ctx(1, "let x")], {
      old: null,
      new: [[{ start: 0, end: 3, cls: "syn-keyword" }]],
    });
    expect(document.querySelector(".syn-keyword")).toHaveTextContent("let");
  });

  it("still renders the full line text when syntax is absent", () => {
    renderLines([ctx(1, "plain text")]);
    expect(screen.getByText("plain text")).toBeInTheDocument();
  });

  it("combines a syntax class and a word-change mark on one range", () => {
    renderLines([rem(1, "let a"), add(1, "let b")], {
      old: [[{ start: 0, end: 3, cls: "syn-keyword" }]],
      new: [[{ start: 0, end: 3, cls: "syn-keyword" }]],
    });
    expect(document.querySelectorAll(".syn-keyword").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("word-change").length).toBeGreaterThan(0);
  });

  it("maps rem rows to the old side and add rows to the new side", () => {
    // Old side scopes its line as a comment, new side as a keyword, so the class
    // that lands proves which array each row read.
    renderLines([rem(1, "aaa"), add(1, "bbb")], {
      old: [[{ start: 0, end: 3, cls: "syn-comment" }]],
      new: [[{ start: 0, end: 3, cls: "syn-keyword" }]],
    });
    expect(document.querySelector(".syn-comment")).toHaveTextContent("aaa");
    expect(document.querySelector(".syn-keyword")).toHaveTextContent("bbb");
  });

  it("leaves a row plain when its line number has no tokens", () => {
    // Line 5 of the file, but only one line of tokens supplied.
    renderLines([ctx(5, "no tokens for me")], {
      old: null,
      new: [[{ start: 0, end: 2, cls: "syn-keyword" }]],
    });
    expect(document.querySelector(".syn-keyword")).toBeNull();
    expect(screen.getByText("no tokens for me")).toBeInTheDocument();
  });
});
