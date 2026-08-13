// Intra-line highlighting inside the unified diff (#61 D8).
//
// chunkDiffLines groups by kind, so a removed run and the added run after it
// are two ADJACENT chunks — pairing crosses that pair rather than happening
// inside one chunk. These tests pin that behaviour through PGHunk's public API.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PGHunk } from "./git-components";

const pair = [
  { kind: "rem" as const, lnL: 1, text: "const a = 1;" },
  { kind: "add" as const, lnR: 1, text: "const a = 2;" },
];

describe("word diff rendering", () => {
  it("marks only the changed token on each side", () => {
    render(<PGHunk header="-1,1 +1,1" lines={pair} />);
    const marks = screen.getAllByTestId("word-change");
    expect(marks.map((m) => m.textContent)).toEqual(["1", "2"]);
  });

  it("adds no marks to a context-only hunk", () => {
    render(
      <PGHunk
        header="-1,1 +1,1"
        lines={[{ kind: "ctx", lnL: 1, lnR: 1, text: "unchanged" }]}
      />,
    );
    expect(screen.queryAllByTestId("word-change")).toHaveLength(0);
  });

  it("adds no marks when the two lines are unrelated", () => {
    render(
      <PGHunk
        header="-1,1 +1,1"
        lines={[
          { kind: "rem", lnL: 1, text: "alpha beta gamma" },
          { kind: "add", lnR: 1, text: "totally different words here" },
        ]}
      />,
    );
    expect(screen.queryAllByTestId("word-change")).toHaveLength(0);
  });

  it("adds no marks to an addition with no removal to pair with", () => {
    render(
      <PGHunk
        header="-1,0 +1,1"
        lines={[{ kind: "add", lnR: 1, text: "brand new line" }]}
      />,
    );
    expect(screen.queryAllByTestId("word-change")).toHaveLength(0);
  });

  it("still renders the full line text when highlighting", () => {
    // Highlighting splits a line across several spans, so assert on the
    // rendered text content rather than looking for one matching element.
    const { container } = render(<PGHunk header="-1,1 +1,1" lines={pair} />);
    expect(container.textContent).toContain("const a = 1;");
    expect(container.textContent).toContain("const a = 2;");
  });

  it("pairs line-for-line across a multi-line rem/add run", () => {
    render(
      <PGHunk
        header="-1,2 +1,2"
        lines={[
          { kind: "rem", lnL: 1, text: "let x = 1;" },
          { kind: "rem", lnL: 2, text: "let y = 2;" },
          { kind: "add", lnR: 1, text: "let x = 10;" },
          { kind: "add", lnR: 2, text: "let y = 20;" },
        ]}
      />,
    );
    expect(screen.getAllByTestId("word-change").map((m) => m.textContent)).toEqual([
      "1",
      "2",
      "10",
      "20",
    ]);
  });
});
