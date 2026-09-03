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

  // A textual diff with no hunks is an everyday thing — an empty added file, a
  // mode-only `chmod +x` — and `fileDiffToText` has nothing to build from. The
  // entry used to be pushed unconditionally, so it copied "" and flashed
  // "copied diff": the same rule the two entries above already follow.
  const empty: FileDiff = { ...diff, additions: 0, deletions: 0, hunks: [] };

  it("offers no whole-file entry when the file has no hunks", () => {
    expect(labels(diffCopyMenuItems({ diff: empty }))).toEqual([]);
  });

  it("still offers the dragged text on a file with no hunks", () => {
    selectText("some code");
    expect(labels(diffCopyMenuItems({ diff: empty }))).toEqual(["Copy"]);
  });

  // The case that separates "has hunks" from "has something to copy". A hunk is
  // only ever created by the line callback that carries its `@@` header, and
  // that header arrives as a `HunkHeader` LINE — which `isFileContent` drops. So
  // a hunk holding nothing but its own header is the shape the builder has to
  // survive, and `hunks.length > 0` would offer an entry that copies a bare
  // `@@` range and no code.
  const headerOnly: FileDiff = {
    ...diff,
    additions: 0,
    deletions: 0,
    hunks: [
      {
        header: "@@ -1,1 +1,1 @@",
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        lines: [
          {
            kind: { kind: "HunkHeader" },
            oldLineno: null,
            newLineno: null,
            content: "@@ -1,1 +1,1 @@\n",
          },
        ],
      },
    ],
  };

  it("offers no whole-file entry when the hunks hold no file content", () => {
    expect(labels(diffCopyMenuItems({ diff: headerOnly }))).toEqual([]);
  });

  // The regression guard. `fileDiffToText` walks every line of every hunk and
  // allocates a string per line; a checked-in minified blob is a real audited
  // case here, and the commit-diff paths set no `max_size`. Deciding whether to
  // SHOW the entry must not pay that cost on every right-click — the text is
  // built when the reader actually clicks Copy.
  it("does not walk the whole diff just to decide whether to offer the entry", () => {
    let reads = 0;
    const lines = diff.hunks[0].lines;
    const counted = new Proxy(lines, {
      get(t, k, r) {
        if (typeof k === "string" && /^\d+$/.test(k)) reads++;
        return Reflect.get(t, k, r);
      },
    });
    const big: FileDiff = {
      ...diff,
      hunks: [{ ...diff.hunks[0], lines: counted }],
    };

    const items = diffCopyMenuItems({ diff: big });
    expect(labels(items)).toEqual(["Copy file diff as text"]);
    // Stops at the first line that is file content, rather than reading all four.
    expect(reads).toBeLessThan(lines.length);

    // ...and clicking still copies the whole thing.
    const before = reads;
    void click(items, "Copy file diff as text");
    expect(reads).toBeGreaterThan(before);
  });
});
