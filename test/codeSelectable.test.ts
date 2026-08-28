/**
 * @vitest-environment node
 */
// "Every surface that shows code lets you select it." (#297)
//
// The app is `user-select: none` everywhere (`index.css`, so a drag across the
// UI does not smear a selection over the chrome), and each surface that renders
// CODE opts one cell back in with `.pg-selectable` — the code, never the gutters
// beside it, so a copied block pastes as source rather than as a column of line
// numbers and commit hashes.
//
// That contract is invisible until it is broken, and then it is invisible in the
// other direction: an unselectable pane looks completely normal, and nobody
// reports it until they try to copy a line out. Blame shipped that way and the
// three rendering guards next door could not see it, because none of them knew
// Blame existed. This is the list they were missing.
//
// The per-surface rendering proof lives in `src/design/diffSelection.test.tsx`,
// `src/features/diff/CommitDiffPanel.selection.test.tsx` and
// `src/screens/Blame.selection.test.tsx`; the end-to-end proof against a real
// WebKit is `e2e/specs/diff-selection.e2e.ts`. What none of them can catch is a
// SIXTH surface arriving without any of it, which is what this file fails the
// build for.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every file that renders lines of source for reading.
 *
 * The four diff surfaces reach it through shared renderers (`PGDiffRow`,
 * `PGDiffLine`, `PGSideBySideDiff`) or their own markup; Blame renders its own.
 * The merge window is out: CodeMirror manages its own selection and is not built
 * on the DiffRow model.
 */
const CODE_SURFACES = [
  "src/design/git-components.tsx",
  "src/features/diff/CommitDiffPanel.tsx",
  "src/screens/Blame.tsx",
];

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("code is selectable wherever it is shown", () => {
  it.each(CODE_SURFACES)("%s opts its code cell back in", (file) => {
    expect(read(file)).toContain("pg-selectable");
  });

  // The class only means something while the rule that grants selection exists.
  it("the class still grants selection, prefixed and not", () => {
    const css = read("src/index.css");
    const rule = css.slice(css.indexOf(".pg-selectable"));
    expect(rule).toMatch(/user-select:\s*text/);
    expect(rule).toMatch(/-webkit-user-select:\s*text/);
  });

  // The three diff surfaces that render through `PGWindowedDiff` inherit their
  // cell from `git-components.tsx`, so they carry no class of their own — which
  // is why they are absent above and asserted here instead. A surface that stops
  // using the shared renderer would fail this, and belong in the list.
  it.each([
    "src/screens/CommitPanel.tsx",
    "src/screens/DiffViewer.tsx",
    "src/screens/RepoBrowser.tsx",
  ])("%s renders through the shared row", (file) => {
    expect(read(file)).toContain("PGWindowedDiff");
  });
});
