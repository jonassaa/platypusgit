// PGCommitRow is the one density surface that cannot be pure CSS: PGGraphRow
// draws its lanes in SVG user units (`y2={height}`, bezier control points at
// `height / 2`), so the row box and the graph gutter must agree on the SAME
// number. A `calc()` on the row alone would desync the curves from the row
// pitch — the most visible list in the app. These tests pin them together.
import { describe, it, expect, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";

import {
  COMMIT_ROW_BASE_H,
  PGCommitRow,
  type GraphLane,
  type GraphNode,
} from "./git-components";
import { useSettingsStore } from "@/features/settings/useSettingsStore";

const lanes: GraphLane[] = [{ col: 0, color: "red", kind: "line" }];
const node: GraphNode = { col: 0, color: "red" };

function renderCommitRow() {
  const { container } = render(
    <PGCommitRow
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
  useSettingsStore.getState().set("uiDensity", "compact");
});

describe("PGCommitRow density", () => {
  it("keeps the compact row at its pre-density height", () => {
    const { row, svg } = renderCommitRow();
    expect(COMMIT_ROW_BASE_H).toBe(26); // the pre-density height, pinned
    expect(row.style.height).toBe(`${COMMIT_ROW_BASE_H}px`);
    expect(svg.getAttribute("height")).toBe(`${COMMIT_ROW_BASE_H}`);
  });

  // Literal 30, not COMMIT_ROW_BASE_H + step: if either the base or the step
  // moves, this fails rather than following along silently.
  it("grows row and graph gutter together when density is comfortable", () => {
    useSettingsStore.getState().set("uiDensity", "comfortable");
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
      useSettingsStore.getState().set("uiDensity", "comfortable");
    });

    expect(row.style.height).toBe("30px");
    expect(svg.getAttribute("height")).toBe("30");
  });

  it("lets an explicit rowHeight override the density-derived height", () => {
    const { container } = render(
      <PGCommitRow
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
});
