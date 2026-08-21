// The copy entries on a diff's own context menu.
//
// A mouse selection in a diff stops at the rendered window, so right-clicking is
// the discoverable way to copy more than a screenful. The menu offers whichever
// of the three selections the reader actually has — the text they dragged over,
// the diff lines they clicked, or the whole file — and never an entry that would
// put an empty string on the clipboard.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { diffCopyMenuItems, type ContextMenuItem } from "./context-menu";
import type { FileDiff } from "@/lib/types";

const diff: FileDiff = {
  path: "a.ts",
  oldPath: null,
  binary: false,
  additions: 2,
  deletions: 1,
  hunks: [
    {
      header: "@@ -1,2 +1,3 @@",
      oldStart: 1,
      oldLines: 2,
      newStart: 1,
      newLines: 3,
      lines: [
        { kind: { kind: "Context" }, oldLineno: 1, newLineno: 1, content: "base\n" },
        { kind: { kind: "Deletion" }, oldLineno: 2, newLineno: null, content: "gone\n" },
        { kind: { kind: "Addition" }, oldLineno: null, newLineno: 2, content: "add1\n" },
        { kind: { kind: "Addition" }, oldLineno: null, newLineno: 3, content: "add2\n" },
      ],
    },
  ],
};

const copied: string[] = [];

const labels = (items: ContextMenuItem[]) =>
  items.filter((i) => !i.divider && !i.__menuTitle).map((i) => String(i.label));

const click = async (items: ContextMenuItem[], label: string) => {
  const item = items.find((i) => String(i.label) === label);
  expect(item, `no menu item labelled ${label}`).toBeDefined();
  await item!.onClick?.();
};

/** Put a real, non-collapsed selection over `text` in the document. */
function selectText(text: string) {
  const host = document.createElement("div");
  host.textContent = text;
  document.body.appendChild(host);
  const range = document.createRange();
  range.selectNodeContents(host);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  expect(sel.isCollapsed).toBe(false);
}

beforeEach(() => {
  copied.length = 0;
  window.getSelection()?.removeAllRanges();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn((t: string) => void copied.push(t)) },
  });
});

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
});

describe("diffCopyMenuItems", () => {
  it("offers only the whole file when nothing is selected", () => {
    expect(labels(diffCopyMenuItems({ diff }))).toEqual(["Copy file diff as text"]);
  });

  it("copies the whole file as a patch, headers and prefixes included", async () => {
    await click(diffCopyMenuItems({ diff }), "Copy file diff as text");
    expect(copied).toEqual([
      ["@@ -1,2 +1,3 @@", " base", "-gone", "+add1", "+add2"].join("\n"),
    ]);
  });

  it("offers the dragged text when there is a text selection", () => {
    selectText("some code");
    expect(labels(diffCopyMenuItems({ diff }))).toEqual([
      "Copy",
      "Copy file diff as text",
    ]);
  });

  it("copies exactly the dragged text", async () => {
    selectText("some code");
    await click(diffCopyMenuItems({ diff }), "Copy");
    expect(copied).toEqual(["some code"]);
  });

  it("names the line selection by its size", () => {
    expect(labels(diffCopyMenuItems({ diff, lineSel: { 0: [1, 2] } }))).toEqual([
      "Copy 2 selected lines",
      "Copy file diff as text",
    ]);
    expect(labels(diffCopyMenuItems({ diff, lineSel: { 0: [1] } }))).toContain(
      "Copy 1 selected line",
    );
  });

  it("copies the selected lines as bare code", async () => {
    await click(
      diffCopyMenuItems({ diff, lineSel: { 0: [0, 2] } }),
      "Copy 2 selected lines",
    );
    expect(copied).toEqual(["gone\nadd2"]);
  });

  it("offers all three when both kinds of selection exist", () => {
    selectText("some code");
    expect(labels(diffCopyMenuItems({ diff, lineSel: { 0: [1] } }))).toEqual([
      "Copy",
      "Copy 1 selected line",
      "Copy file diff as text",
    ]);
  });

  it("offers nothing without a diff — an empty menu never opens", () => {
    expect(diffCopyMenuItems({ diff: null })).toEqual([]);
    expect(diffCopyMenuItems(null)).toEqual([]);
  });

  it("ignores an empty line selection", () => {
    expect(labels(diffCopyMenuItems({ diff, lineSel: { 0: [] } }))).toEqual([
      "Copy file diff as text",
    ]);
  });
});
