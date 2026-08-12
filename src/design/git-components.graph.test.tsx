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

describe("PGGraphRow crossings and emphasis (#68 G6)", () => {
  it("draws every straight lane before any curve, so casings can bridge them", () => {
    const svg = renderGraph(
      [
        { col: 1, color: "blue", kind: "fork-bot", to: 2 },
        { col: 0, color: "red", kind: "line" },
      ],
      undefined,
      2,
    );
    const kinds = [...svg.querySelectorAll("[data-lane-kind]")].map((el) =>
      el.getAttribute("data-lane-kind"),
    );
    expect(kinds).toEqual(["line", "fork-bot"]);
  });

  it("puts a background casing under each curve", () => {
    const svg = renderGraph(
      [{ col: 0, color: "red", kind: "fork-bot", to: 1 }],
      undefined,
      1,
    );
    const casing = svg.querySelector('[data-lane-casing="true"]')!;
    expect(casing).not.toBeNull();
    // Wider than the stroke it protects, and painted in the row background.
    expect(Number(casing.getAttribute("stroke-width"))).toBeGreaterThan(1.5);
    expect(casing.getAttribute("stroke")).toBe("var(--bg-0)");
    // Immediately precedes its coloured stroke in paint order.
    expect(casing.nextElementSibling!.getAttribute("data-lane-kind")).toBe("fork-bot");
  });

  it("does not dash the casing of an elided curve", () => {
    // The casing is a gap, not a line — dashing it would let the lane beneath
    // show through the gaps and defeat the bridge.
    const svg = renderGraph(
      [{ col: 0, color: "red", kind: "fork-bot", to: 1, dashed: true }],
      undefined,
      1,
    );
    const casing = svg.querySelector('[data-lane-casing="true"]')!;
    expect(casing.getAttribute("stroke-dasharray")).toBeNull();
  });

  it("gives no casing to straight lanes", () => {
    const svg = renderGraph([{ col: 0, color: "red", kind: "line" }]);
    expect(svg.querySelector('[data-lane-casing="true"]')).toBeNull();
  });

  it("weights a primary lane heavier than an ordinary one", () => {
    const plain = renderGraph([{ col: 0, color: "red", kind: "line" }]);
    const head = renderGraph([{ col: 0, color: "red", kind: "line", primary: true }]);
    const w = (svg: SVGElement) =>
      Number(svg.querySelector("[data-lane-kind]")!.getAttribute("stroke-width"));
    expect(w(head)).toBeGreaterThan(w(plain));
  });
});

describe("PGGraphRow HEAD marker (#68 G7)", () => {
  const node = (over: Partial<GraphNode> = {}): GraphNode => ({
    col: 0,
    color: "red",
    solid: true,
    ...over,
  });

  it("rings the HEAD commit", () => {
    const svg = renderGraph([], node({ head: true }));
    const ring = svg.querySelector('[data-graph-head="true"]')!;
    expect(ring).not.toBeNull();
    // Outer ring sits outside the r=4 dot.
    expect(Number(ring.getAttribute("r"))).toBeGreaterThan(4);
    expect(ring.getAttribute("fill")).toBe("none");
  });

  it("leaves an ordinary commit unringed", () => {
    const svg = renderGraph([], node());
    expect(svg.querySelector('[data-graph-head="true"]')).toBeNull();
  });

  it("rings a merge commit that is also HEAD", () => {
    const svg = renderGraph([], node({ solid: false, merge: true, head: true }));
    expect(svg.querySelector('[data-graph-head="true"]')).not.toBeNull();
  });

  it("centres the ring on the node's lane", () => {
    const svg = renderGraph([], node({ col: 2, head: true }), 2);
    const ring = svg.querySelector('[data-graph-head="true"]')!;
    expect(Number(ring.getAttribute("cx"))).toBe(laneX(2));
  });
});

describe("PGGraphRow accessibility (#68 G8)", () => {
  it("hides the gutter from assistive tech", () => {
    // A screen reader walking a 500-row log would otherwise hit 500 unlabeled
    // graphics that add nothing over the sha / subject / author already in the row.
    const svg = renderGraph([{ col: 0, color: "red", kind: "line" }]);
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("focusable")).toBe("false");
  });

  it("snaps straight lanes to whole pixels but leaves curves antialiased", () => {
    const svg = renderGraph(
      [
        { col: 0, color: "red", kind: "line" },
        { col: 0, color: "red", kind: "fork-bot", to: 1 },
      ],
      undefined,
      1,
    );
    expect(
      svg.querySelector('[data-lane-kind="line"]')!.getAttribute("shape-rendering"),
    ).toBe("crispEdges");
    expect(
      svg.querySelector('[data-lane-kind="fork-bot"]')!.getAttribute("shape-rendering"),
    ).toBeNull();
  });
});
