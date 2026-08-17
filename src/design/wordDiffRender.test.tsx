// Intra-line highlighting inside the unified diff (#61 D8).
//
// Pins the whole path production takes: flattenDiffRows pairs a removed run with
// the added run that follows it, and PGWindowedDiff renders the resulting spans.
// (It went through PGHunk before that component was retired.)

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PGWindowedDiff } from "./PGWindowedDiff";
import { flattenDiffRows } from "@/lib/diffRows";
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

function renderLines(lines: Line[]) {
  const rows = flattenDiffRows(
    [{ header: "@@ -1 +1 @@", oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines }],
    { foldH: 22, rowH: 19 },
  );
  return render(<PGWindowedDiff rows={rows} />);
}

const pair = [rem(1, "const a = 1;"), add(1, "const a = 2;")];

describe("word diff rendering", () => {
  it("marks only the changed token on each side", () => {
    renderLines(pair);
    const marks = screen.getAllByTestId("word-change");
    expect(marks.map((m) => m.textContent)).toEqual(["1", "2"]);
  });

  it("adds no marks to a context-only hunk", () => {
    renderLines([ctx(1, "unchanged")]);
    expect(screen.queryAllByTestId("word-change")).toHaveLength(0);
  });

  it("adds no marks when the two lines are unrelated", () => {
    renderLines([rem(1, "alpha beta gamma"), add(1, "totally different words here")]);
    expect(screen.queryAllByTestId("word-change")).toHaveLength(0);
  });

  it("adds no marks to an addition with no removal to pair with", () => {
    renderLines([add(1, "brand new line")]);
    expect(screen.queryAllByTestId("word-change")).toHaveLength(0);
  });

  it("still renders the full line text when highlighting", () => {
    // Highlighting splits a line across several spans, so assert on the rendered
    // text content rather than looking for one matching element.
    const { container } = renderLines(pair);
    expect(container.textContent).toContain("const a = 1;");
    expect(container.textContent).toContain("const a = 2;");
  });

  it("tints changed words with the dedicated word tokens", () => {
    // The emphasis has to be a token, not an inline alpha off --git-added: a
    // light theme needs its own calibration, and the theme editor can only reach
    // a named token.
    renderLines(pair);
    const [remMark, addMark] = screen.getAllByTestId("word-change");
    expect(remMark.style.background).toContain("--git-removed-word");
    expect(addMark.style.background).toContain("--git-added-word");
  });

  it("pairs line-for-line across a multi-line rem/add run", () => {
    renderLines([
      rem(1, "let x = 1;"),
      rem(2, "let y = 2;"),
      add(1, "let x = 10;"),
      add(2, "let y = 20;"),
    ]);
    expect(screen.getAllByTestId("word-change").map((m) => m.textContent)).toEqual([
      "1",
      "2",
      "10",
      "20",
    ]);
  });
});
