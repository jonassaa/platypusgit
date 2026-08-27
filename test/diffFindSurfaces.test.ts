/**
 * @vitest-environment node
 */
// "Every diff surface offers find-in-diff." (#241)
//
// Same shape, and the same reasoning, as `diffCopyMenu.test.ts` next door: the
// diff surfaces are WINDOWED, so the webview's own find would search the
// screenful that happens to be mounted and answer "no results" for a match two
// thousand lines down. `useDiffFind` searches the row model instead — and a
// surface that forgets to mount it is a surface where the find key does nothing
// at all, which looks like nothing, not like a bug, until someone tries.
//
// What no rendering test can catch is a FIFTH diff surface arriving without it,
// which is exactly the mistake this file fails the build for. The behaviour is
// pinned by `src/features/diff/useDiffFind.test.tsx` and the highlighting by
// `src/design/diffFindHighlight.test.tsx`.
//
// The merge window is deliberately NOT in this list: it renders conflicts through
// CodeMirror (`features/merge/`), not through the flat DiffRow model, so it shares
// none of this and has none of the windowing problem that motivates it.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Every file that renders diff rows — the same four as the copy menu's list. */
const DIFF_SURFACES = [
  "src/screens/CommitPanel.tsx",
  "src/screens/DiffViewer.tsx",
  "src/screens/RepoBrowser.tsx",
  "src/features/diff/CommitDiffPanel.tsx",
];

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("find in diff reaches every diff surface", () => {
  it.each(DIFF_SURFACES)("%s drives the shared hook", (file) => {
    expect(read(file)).toContain("useDiffFind(");
  });

  it.each(DIFF_SURFACES)("%s mounts the bar", (file) => {
    expect(read(file)).toContain("<DiffFindBar");
  });

  // A bar with no highlighting is a match counter, not a find: the reader still
  // cannot see WHICH text matched. Each surface hands its renderer the marks —
  // three through `PGWindowedDiff`'s `findMarks`, and `CommitDiffPanel` through
  // its own markup, which is why this greps for the shared accessor rather than
  // for one prop name.
  it.each(DIFF_SURFACES)("%s hands its renderer the marks", (file) => {
    expect(read(file)).toContain("find.marksFor");
  });

  // The four surfaces are the SAME four the copy menu names, and for the same
  // reason. Keeping the lists in step is what stops a new surface being added to
  // one and forgotten by the other.
  it("names the same surfaces the copy-menu guard does", () => {
    const other = read("test/diffCopyMenu.test.ts");
    for (const file of DIFF_SURFACES) expect(other).toContain(file);
  });

  // The merge window renders no DiffRow, so it must not be quietly half-wired.
  it("leaves the merge window out, and out of the row model entirely", () => {
    const merge = read("src/features/merge/MergeBody.tsx");
    expect(merge).not.toContain("useDiffFind");
    expect(merge).not.toContain("flattenDiffRows");
  });
});
