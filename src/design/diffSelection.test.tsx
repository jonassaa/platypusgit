// Diff text is selectable; diff CHROME is not.
//
// The app sets `user-select: none` on `body` (index.css) for a native desktop
// feel, so every surface that wants selectable text opts back in. In a diff that
// opt-in is deliberately narrow: the code, and nothing else. A selection that
// swept up the line numbers and the +/- marker would paste as something you have
// to clean by hand, which defeats the point of being able to copy it.
//
// Asserted on the class rather than a computed style because jsdom applies no
// stylesheet — so this file also pins what `.pg-selectable` MEANS in index.css.
// The end-to-end proof, in a real WebKit, is e2e/specs/diff-selection.e2e.ts.
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { PGWindowedDiff } from "./PGWindowedDiff";
import { PGDiffLine, PGSideBySideDiff } from "./git-components";
import { selectionText } from "@/test/selectionText";
import { flattenDiffRows } from "@/lib/diffRows";
import type { FileDiff } from "@/lib/types";

type Line = FileDiff["hunks"][number]["lines"][number];

const lines: Line[] = [
  { kind: { kind: "Context" }, oldLineno: 1, newLineno: 1, content: "ctx line" },
  { kind: { kind: "Deletion" }, oldLineno: 2, newLineno: null, content: "removed line" },
  { kind: { kind: "Addition" }, oldLineno: null, newLineno: 2, content: "added line" },
];

const rows = () =>
  flattenDiffRows(
    [{ header: "@@ -1,2 +1,2 @@", oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines }],
    { foldH: 22, rowH: 19 },
  );

/** Every element that opts into selection, by the one class that grants it. */
const selectable = (root: HTMLElement) => root.querySelectorAll(".pg-selectable");

describe(".pg-selectable, the class these surfaces rely on", () => {
  it("grants text selection in index.css, prefixed and not", () => {
    const css = fs.readFileSync(
      path.join(process.cwd(), "src/index.css"),
      "utf8",
    );
    const rule = css.match(/\.pg-selectable\s*\{[^}]*\}|[^}]*\.pg-selectable[^{]*\{[^}]*\}/);
    expect(rule, ".pg-selectable must exist in index.css").not.toBeNull();
    expect(rule![0]).toContain("user-select: text");
    expect(rule![0]).toContain("-webkit-user-select: text");
  });
});

describe("PGDiffRow selection (unified diff — DiffViewer, CommitPanel, Compare)", () => {
  it("makes each row's code text selectable", () => {
    const { container } = render(<PGWindowedDiff rows={rows()} />);
    expect([...selectable(container)].map((el) => el.textContent)).toEqual([
      "ctx line",
      "removed line",
      "added line",
    ]);
  });

  it("copies the code and none of the chrome", () => {
    const { container } = render(<PGWindowedDiff rows={rows()} />);
    // Rows are block-level, so a real engine separates them by a newline; jsdom
    // has no layout, hence the concatenation. What matters is what is IN it.
    expect(selectionText(container)).toBe("ctx lineremoved lineadded line");
  });
});

describe("PGDiffLine selection (the separator/info renderer)", () => {
  it("makes its code text selectable and its gutters not", () => {
    const { container } = render(
      <PGDiffLine kind="add" lnL={undefined} lnR={7} text="added line" />,
    );
    expect([...selectable(container)].map((el) => el.textContent)).toEqual([
      "added line",
    ]);
    expect(selectionText(container)).toBe("added line");
  });
});

describe("selecting text vs staging a line", () => {
  afterEach(() => window.getSelection()?.removeAllRanges());

  const clickFirstChanged = (onLineClick: (h: number, c: number) => void) => {
    const r = render(<PGWindowedDiff rows={rows()} onLineClick={onLineClick} />);
    const changed = r.container.querySelectorAll('[data-testid="diff-line-changed"]');
    return { ...r, changed };
  };

  it("still stages the line a plain click lands on", () => {
    const clicks: number[][] = [];
    const { changed } = clickFirstChanged((h, c) => clicks.push([h, c]));
    fireEvent.click(changed[0]);
    expect(clicks).toEqual([[0, 0]]);
  });

  // The click that ends a drag-selection fires on the row the pointer came up
  // over, so without this guard copying a line would silently stage it. A plain
  // click cannot trip the guard: mousedown collapses any existing selection
  // before the click event runs, so only a drag arrives here with text selected.
  it("does not stage the line a drag-selection ended on", () => {
    const clicks: number[][] = [];
    const { container, changed } = clickFirstChanged((h, c) => clicks.push([h, c]));
    const range = document.createRange();
    range.selectNodeContents(container.querySelector(".pg-selectable")!);
    window.getSelection()!.addRange(range);
    fireEvent.click(changed[0]);
    expect(clicks).toEqual([]);
  });
});

describe("PGSideBySideDiff selection (split view)", () => {
  it("makes both columns' code text selectable", () => {
    const { container } = render(
      <PGSideBySideDiff
        left={[{ kind: "rem", ln: 2, text: "removed line" }]}
        right={[{ kind: "add", ln: 2, text: "added line" }]}
      />,
    );
    expect([...selectable(container)].map((el) => el.textContent)).toEqual([
      "removed line",
      "added line",
    ]);
  });

  it("copies each column's code and neither line number", () => {
    const { container } = render(
      <PGSideBySideDiff
        left={[{ kind: "rem", ln: 2, text: "removed line" }]}
        right={[{ kind: "add", ln: 2, text: "added line" }]}
      />,
    );
    expect(selectionText(container)).toBe("removed lineadded line");
  });
});
