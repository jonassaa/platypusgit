/**
 * @vitest-environment node
 */
// "Every diff surface has a caret, and F7 moves it." (#297)
//
// Same shape, and the same reasoning, as `diffFindSurfaces.test.ts` and
// `diffCopyMenu.test.ts` next door. The line caret shipped in ONE of the four
// surfaces and stayed there: `focusedRow` was passed by CommitPanel alone, so
// history, compare and browse rendered rows that could draw the ring
// (`PGDiffRow` has always known how) and never lit one. Nothing failed — a
// missing cursor looks like a design choice, not a bug, until someone presses
// the down arrow and watches nothing happen.
//
// The other half is the coupling. A caret that F7 does not move is worse than no
// caret: the highlight says "you are here" and the text cursor says otherwise,
// and the reader's next arrow key believes the wrong one. So each surface must
// both MOUNT the hook and hand it to `useHunkNav` — `onLand` (F7 moves the
// caret) and `follows` (the caret moves F7).
//
// The merge window is deliberately NOT in this list, for the same reason it is
// out of the find guard's: it renders conflicts through CodeMirror, which brings
// its own cursor, and shares none of the DiffRow model this is built on.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Every file that renders diff rows — the same four as the find and copy guards. */
const DIFF_SURFACES = [
  "src/screens/CommitPanel.tsx",
  "src/screens/DiffViewer.tsx",
  "src/screens/RepoBrowser.tsx",
  "src/features/diff/CommitDiffPanel.tsx",
];

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("the diff caret reaches every diff surface", () => {
  it.each(DIFF_SURFACES)("%s mounts the shared cursor", (file) => {
    expect(read(file)).toContain("useDiffLineFocus(");
  });

  // Three surfaces render through `PGWindowedDiff` and pass `focusedRow`;
  // `CommitDiffPanel` keeps its own lighter markup and draws the ring by hand.
  // Both routes end at the same attribute, which is what this greps for rather
  // than a prop name only three of them have.
  it.each(DIFF_SURFACES)("%s draws the ring", (file) => {
    const src = read(file);
    expect(src.includes("focusedRow=") || src.includes("data-focused=")).toBe(true);
  });

  it.each(DIFF_SURFACES)("%s lets F7 move the caret", (file) => {
    expect(read(file)).toContain("onLand:");
  });

  // Without this the hunk cursor stays where the last F7 left it, so arrowing
  // down through two hunks and pressing F7 walks back over ground already read.
  it.each(DIFF_SURFACES)("%s lets the caret move F7", (file) => {
    expect(read(file)).toContain("follows:");
  });

  // The four surfaces are the SAME four the find and copy-menu guards name.
  // Keeping the lists in step is what stops a fifth surface being added to one
  // and forgotten by the others.
  it("names the same surfaces the find and copy-menu guards do", () => {
    const find = read("test/diffFindSurfaces.test.ts");
    const copy = read("test/diffCopyMenu.test.ts");
    for (const file of DIFF_SURFACES) {
      expect(find).toContain(file);
      expect(copy).toContain(file);
    }
  });

  it("leaves the merge window out, and out of the row model entirely", () => {
    const merge = read("src/features/merge/MergeBody.tsx");
    expect(merge).not.toContain("useDiffLineFocus");
    expect(merge).not.toContain("flattenDiffRows");
  });
});
