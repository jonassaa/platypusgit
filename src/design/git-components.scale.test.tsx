// PGCommitRow is the one row-scale surface that cannot be pure CSS: PGGraphRow
// draws its lanes in SVG user units (`y2={height}`, bezier control points at
// `height / 2`), so the row box and the graph gutter must agree on the SAME
// number for BOTH axes — the spacing step and the text scale. A `calc()` on
// the row alone would desync the curves from the row pitch — the most visible
// list in the app. These tests pin them together.
import { describe, it, expect, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";

import {
  COMMIT_ROW_BASE_H,
  PGCommitRow,
  type GraphLane,
  type GraphNode,
} from "./git-components";
import { graphWidth } from "./graph-geometry";
import { useSettingsStore } from "@/features/settings/useSettingsStore";

const lanes: GraphLane[] = [{ col: 0, color: "red", kind: "line" }];
const node: GraphNode = { col: 0, color: "red" };

function renderCommitRow() {
  const { container } = render(
    <PGCommitRow
      graphW={graphWidth(0)}
      lanes={lanes}
      node={node}
      sha="abc1234"
      message="feat: something"
      author="Tester"
      date="2026-08-11"
    />,
  );
  const row = container.querySelector<HTMLElement>('[data-testid="commit-row"]')!;
  const svg = container.querySelector("svg")!;
  return { row, svg };
}

beforeEach(() => {
  useSettingsStore.getState().set("uiSpacing", "compact");
  useSettingsStore.getState().set("uiTextScale", "default");
});

describe("PGCommitRow row scale", () => {
  it("keeps the compact row at its pre-density height", () => {
    const { row, svg } = renderCommitRow();
    expect(COMMIT_ROW_BASE_H).toBe(26); // the pre-density height, pinned
    expect(row.style.height).toBe(`${COMMIT_ROW_BASE_H}px`);
    expect(svg.getAttribute("height")).toBe(`${COMMIT_ROW_BASE_H}`);
  });

  // Literal 30, not COMMIT_ROW_BASE_H + step: if either the base or the step
  // moves, this fails rather than following along silently.
  it("grows row and graph gutter together when density is comfortable", () => {
    useSettingsStore.getState().set("uiSpacing", "comfortable");
    const { row, svg } = renderCommitRow();
    expect(row.style.height).toBe("30px");
    expect(svg.getAttribute("height")).toBe("30");
  });

  // Every other test here measures a fresh mount, which a subscription-free
  // `useSettingsStore.getState()` read would also satisfy. This one changes the
  // setting under an ALREADY-MOUNTED row: without a real subscription the
  // gutter would keep drawing at the old pitch until the screen remounted.
  it("re-renders a mounted row and gutter when density changes", () => {
    const { row, svg } = renderCommitRow();
    expect(svg.getAttribute("height")).toBe("26");

    act(() => {
      useSettingsStore.getState().set("uiSpacing", "comfortable");
    });

    expect(row.style.height).toBe("30px");
    expect(svg.getAttribute("height")).toBe("30");
  });

  it("lets an explicit rowHeight override the density-derived height", () => {
    const { container } = render(
      <PGCommitRow
        graphW={graphWidth(0)}
        lanes={lanes}
        node={node}
        sha="abc1234"
        message="m"
        author="a"
        date="d"
        rowHeight={40}
      />,
    );
    expect(
      container.querySelector<HTMLElement>('[data-testid="commit-row"]')!.style.height,
    ).toBe("40px");
    expect(container.querySelector("svg")!.getAttribute("height")).toBe("40");
  });

  // The graph gutter is drawn in SVG user units, so it cannot read
  // --row-scale. If PGCommitRow does not hand it the same number the row box
  // used, the lane curves stop meeting the dots -- in the most visible list in
  // the app. Literals, not the expression: if either input moves this fails
  // rather than following along silently.
  it("grows row and graph gutter together when the text scale changes", () => {
    useSettingsStore.getState().set("uiTextScale", "larger");
    const { row, svg } = renderCommitRow();
    // COMMIT_ROW_BASE_H 26 x 1.3 = 33.8, + compact step 0
    expect(row.style.height).toBe("33.8px");
    expect(svg.getAttribute("height")).toBe("33.8");
  });

  it("adds the spacing step on top of the scaled base", () => {
    useSettingsStore.getState().set("uiTextScale", "large");
    useSettingsStore.getState().set("uiSpacing", "spacious");
    const { row, svg } = renderCommitRow();
    // 26 x 1.15 = 29.9, + spacious step 8
    expect(row.style.height).toBe("37.9px");
    expect(svg.getAttribute("height")).toBe("37.9");
  });
});
