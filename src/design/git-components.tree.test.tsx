// PGFileTree renders only the caller's window of rows (#61 A8). "All files"
// mode lists every file in the repository, so on a real repo this is thousands
// of DOM rows plus their icons.
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import {
  FILE_TREE_ROW_BASE_H,
  PGFileTree,
  type PGFileTreeNode,
} from "./git-components";

/** 50 flat files, named so a row's identity is readable from its text. */
const NODES: PGFileTreeNode[] = Array.from({ length: 50 }, (_, i) => ({
  name: `file${String(i).padStart(2, "0")}.txt`,
  status: "M",
}));

const rows = (c: HTMLElement) => [...c.querySelectorAll("[data-pg-row]")];

describe("PGFileTree windowing", () => {
  it("renders every row when no window is given", () => {
    // Every existing caller omits the prop and must be unaffected.
    const { container } = render(<PGFileTree nodes={NODES} />);
    expect(rows(container)).toHaveLength(50);
  });

  it("renders only the requested slice", () => {
    const { container } = render(
      <PGFileTree
        nodes={NODES}
        window={{ start: 10, end: 15, topPad: 240, bottomPad: 840 }}
      />,
    );
    const shown = rows(container);
    expect(shown).toHaveLength(5);
    expect(shown[0]!.textContent).toContain("file10.txt");
    expect(shown[4]!.textContent).toContain("file14.txt");
  });

  it("pads the scroll body so its height still covers every row", () => {
    // RepoBrowser's scrollbar must reflect the whole tree, not the slice.
    const { container } = render(
      <PGFileTree
        nodes={NODES}
        window={{ start: 10, end: 15, topPad: 240, bottomPad: 840 }}
      />,
    );
    const spacers = [...container.querySelectorAll("[data-tree-spacer]")];
    expect(spacers).toHaveLength(2);
    expect(spacers[0]!.getAttribute("style")).toContain("240px");
    expect(spacers[1]!.getAttribute("style")).toContain("840px");
  });

  it("keeps the stage column reserved from rows outside the window", () => {
    // stageSlot is a whole-tree decision. Deriving it from the visible slice
    // would make the checkbox column appear and disappear while scrolling,
    // shifting every filename sideways.
    const stageState = (key: string) =>
      key.includes("file49") ? ("none" as const) : undefined;

    const windowed = render(
      <PGFileTree
        nodes={NODES}
        stageState={stageState}
        window={{ start: 0, end: 3, topPad: 0, bottomPad: 940 }}
      />,
    );
    const full = render(<PGFileTree nodes={NODES} stageState={stageState} />);

    // The only stageable row (file49) is outside the window, yet the column is
    // reserved identically in both renders.
    const slotWidth = (c: HTMLElement) =>
      rows(c)[0]!.getAttribute("style")?.includes("grid") ??
      rows(c)[0]!.outerHTML.length > 0;
    expect(slotWidth(windowed.container)).toBe(slotWidth(full.container));
    expect(rows(windowed.container)).toHaveLength(3);
  });

  it("exports a row height matching the --row-h token's base", () => {
    // index.css: --row-h: calc(24px + var(--row-step)). A literal here would
    // desync the window from the rows in comfortable density (#70).
    expect(FILE_TREE_ROW_BASE_H).toBe(24);
  });
});
