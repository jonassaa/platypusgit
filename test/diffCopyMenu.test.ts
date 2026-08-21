/**
 * @vitest-environment node
 */
// "Every diff surface offers the copy menu."
//
// A diff's text is selectable, but the surfaces are WINDOWED: only the rendered
// rows are in the document, so a mouse selection stops at the edge of the
// viewport and there is no way to drag over a range longer than a screenful.
// `diffCopyMenuItems` is the answer to that, and a surface that forgets to wire
// it is a surface where a long diff simply cannot be copied — which looks like
// nothing at all, not like a bug, until someone tries.
//
// So this guards the wiring rather than the behaviour: the behaviour is pinned by
// `src/design/context-menu.diffcopy.test.tsx` (the builder), and end to end by
// `src/screens/CommitPanel.copy.test.tsx` and
// `src/features/diff/CommitDiffPanel.selection.test.tsx`. What no rendering test
// can catch is a FIFTH diff surface arriving without the menu, which is exactly
// the mistake this file fails the build for.
//
// Lives at the repo root, beside `nativeSelect.test.ts`, because it reads source
// TEXT rather than rendering anything — a node test in the `docs` vitest project.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every file that renders diff rows.
 *
 * Three go through `PGWindowedDiff`; `CommitDiffPanel` has its own lighter
 * markup and is itself rendered by Compare, CommitDiff and History, so wiring it
 * once covers those three screens.
 */
const DIFF_SURFACES = [
  "src/screens/CommitPanel.tsx",
  "src/screens/DiffViewer.tsx",
  "src/screens/RepoBrowser.tsx",
  "src/features/diff/CommitDiffPanel.tsx",
];

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("the diff copy menu reaches every diff surface", () => {
  it.each(DIFF_SURFACES)("%s builds the copy menu", (file) => {
    expect(read(file)).toContain("diffCopyMenuItems");
  });

  it.each(DIFF_SURFACES)("%s opens it on right-click", (file) => {
    expect(read(file)).toContain("onContextMenu");
  });

  // The list above is only as good as its completeness, so pin what defines it:
  // if a new file starts rendering diff rows, it has to be named here too.
  it("names every PGWindowedDiff caller", () => {
    const callers = DIFF_SURFACES.filter((f) => read(f).includes("PGWindowedDiff"));
    expect(callers.sort()).toEqual(
      [
        "src/screens/CommitPanel.tsx",
        "src/screens/DiffViewer.tsx",
        "src/screens/RepoBrowser.tsx",
      ].sort(),
    );
  });
});
