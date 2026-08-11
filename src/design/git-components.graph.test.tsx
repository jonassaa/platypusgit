// PGGraphRow rendering. Every assertion here maps to a bug in issue #68: the
// gutter clipped lanes past column 8 (G1), and an elided link had no dashed
// treatment while a stuck lane had no terminator (G2).
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import {
  PGCommitRow,
  PGGraphRow,
  type GraphLane,
  type GraphNode,
} from "./git-components";
import { GRAPH_MAX_W, commitRowGrid, graphWidth, isGraphClamped, laneX } from "./graph-geometry";

function renderGraph(lanes: GraphLane[], node?: GraphNode, maxCol = 0) {
  const { container } = render(
    <PGGraphRow lanes={lanes} node={node} width={graphWidth(maxCol)} height={26} />,
  );
  return container.querySelector("svg")!;
}

describe("PGGraphRow", () => {
  it("draws a plain lane with no dash pattern", () => {
    const svg = renderGraph([{ col: 0, color: "red", kind: "line" }]);
    const line = svg.querySelector("line")!;
    expect(line.getAttribute("stroke-dasharray")).toBeNull();
  });

  it("dashes an elided lane segment", () => {
    const svg = renderGraph([{ col: 0, color: "red", kind: "line", dashed: true }]);
    expect(svg.querySelector("line")!.getAttribute("stroke-dasharray")).toBeTruthy();
  });

  it("dashes an elided half-lane and an elided curve alike", () => {
    // The reason `dashed` is a flag and not a lane kind: one elided link
    // renders as a straight run, a half-lane, and a curve depending on the row.
    const svg = renderGraph(
      [
        { col: 0, color: "red", kind: "half-bot", dashed: true },
        { col: 0, color: "red", kind: "fork-bot", to: 1, dashed: true },
      ],
      undefined,
      1,
    );
    const dashed = [...svg.querySelectorAll("[stroke-dasharray]")];
    expect(dashed).toHaveLength(2);
  });

  it("tags each lane with its kind so callers can select by role", () => {
    const svg = renderGraph([
      { col: 0, color: "red", kind: "half-top" },
      { col: 0, color: "red", kind: "half-bot" },
    ]);
    expect(svg.querySelector('[data-lane-kind="half-top"]')).not.toBeNull();
    expect(svg.querySelector('[data-lane-kind="half-bot"]')).not.toBeNull();
  });

  // THE G1 REGRESSION. A col-9 lane used to be drawn outside a fixed 140px
  // viewport and vanish, node dot included, with no overflow and no warning.
  it("keeps a column-9 lane and its dot inside the viewport", () => {
    const svg = renderGraph(
      [{ col: 9, color: "red", kind: "line" }],
      { col: 9, color: "red", solid: true },
      9,
    );
    const width = Number(svg.getAttribute("width"));
    expect(width).toBe(graphWidth(9));
    expect(width).toBeGreaterThan(140);

    expect(Number(svg.querySelector("line")!.getAttribute("x1"))).toBe(laneX(9));
    const dot = svg.querySelector("circle")!;
    expect(Number(dot.getAttribute("cx")) + 4).toBeLessThanOrEqual(width);
  });

  it("puts the node dot on the same x as its lane", () => {
    const svg = renderGraph(
      [{ col: 3, color: "red", kind: "line" }],
      { col: 3, color: "red" },
      3,
    );
    expect(svg.querySelector("circle")!.getAttribute("cx")).toBe(
      svg.querySelector("line")!.getAttribute("x1"),
    );
  });

  it("draws a dashed stub under a truncated node", () => {
    const svg = renderGraph(
      [{ col: 0, color: "red", kind: "half-top" }],
      { col: 0, color: "red", truncated: true },
    );
    const stub = svg.querySelector('[data-graph-stub="true"]');
    expect(stub).not.toBeNull();
    expect(stub!.getAttribute("stroke-dasharray")).toBeTruthy();
  });

  it("draws no stub for an ordinary node", () => {
    const svg = renderGraph(
      [{ col: 0, color: "red", kind: "half-top" }],
      { col: 0, color: "red" },
    );
    expect(svg.querySelector('[data-graph-stub="true"]')).toBeNull();
  });

  it("stops widening past the clamp", () => {
    const svg = renderGraph([{ col: 0, color: "red", kind: "line" }], undefined, 20);
    expect(isGraphClamped(20)).toBe(true);
    expect(Number(svg.getAttribute("width"))).toBe(GRAPH_MAX_W);
  });

  it("fades the right edge when lanes are clamped away, and not otherwise", () => {
    const { container: faded } = render(
      <PGGraphRow
        lanes={[{ col: 0, color: "red", kind: "line" }]}
        width={GRAPH_MAX_W}
        height={26}
        clamped
      />,
    );
    expect(faded.querySelector('[data-graph-clamped="true"]')).not.toBeNull();

    const { container: plain } = render(
      <PGGraphRow
        lanes={[{ col: 0, color: "red", kind: "line" }]}
        width={graphWidth(0)}
        height={26}
      />,
    );
    expect(plain.querySelector('[data-graph-clamped="true"]')).toBeNull();
  });
});

describe("PGCommitRow graph column", () => {
  function renderRow(graphW: number) {
    const { container } = render(
      <PGCommitRow
        graphW={graphW}
        lanes={[{ col: 0, color: "red", kind: "line" }]}
        node={{ col: 0, color: "red" }}
        sha="abc1234"
        message="feat: something"
        author="Tester"
        date="2026-08-11"
      />,
    );
    const row = container.querySelector<HTMLElement>('[data-testid="commit-row"]')!;
    return { row, svg: container.querySelector("svg") };
  }

  it("sizes the grid's first column from graphW", () => {
    const { row } = renderRow(152);
    expect(row.style.gridTemplateColumns).toBe(commitRowGrid(152));
    expect(row.style.gridTemplateColumns.startsWith("152px")).toBe(true);
  });

  it("drops the graph column entirely for graphW 0", () => {
    const { row, svg } = renderRow(0);
    expect(row.style.gridTemplateColumns).toBe(commitRowGrid(0));
    expect(svg).toBeNull();
  });
});
