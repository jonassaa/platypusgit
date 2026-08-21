import { describe, expect, it } from "vitest";
import { fileDiffToText, selectedLinesToText } from "./diffCopy";
import type { FileDiff } from "./types";

/**
 * A hunk whose lines carry their trailing newline, the way the backend emits
 * them — `content` is git's raw line, so every builder here has to normalise it
 * rather than assume one shape.
 */
const hunk = (n: number): FileDiff["hunks"][number] => ({
  header: `@@ -${n},3 +${n},3 @@`,
  oldStart: n,
  oldLines: 3,
  newStart: n,
  newLines: 3,
  lines: [
    { kind: { kind: "Context" }, oldLineno: n, newLineno: n, content: "ctx\n" },
    { kind: { kind: "Deletion" }, oldLineno: n + 1, newLineno: null, content: "old\n" },
    { kind: { kind: "Addition" }, oldLineno: null, newLineno: n + 1, content: "new\n" },
  ],
});

const diff = (hunks: FileDiff["hunks"]): FileDiff => ({
  path: "a.ts",
  oldPath: null,
  binary: false,
  additions: 1,
  deletions: 1,
  hunks,
});

describe("fileDiffToText", () => {
  it("prefixes each line and keeps the hunk header", () => {
    expect(fileDiffToText(diff([hunk(1)]))).toBe(
      ["@@ -1,3 +1,3 @@", " ctx", "-old", "+new"].join("\n"),
    );
  });

  it("separates hunks by one newline, with no blank line between them", () => {
    expect(fileDiffToText(diff([hunk(1), hunk(10)]))).toBe(
      [
        "@@ -1,3 +1,3 @@",
        " ctx",
        "-old",
        "+new",
        "@@ -10,3 +10,3 @@",
        " ctx",
        "-old",
        "+new",
      ].join("\n"),
    );
  });

  // The commit-diff builder keeps libgit2's `'H'` line inside `hunks[].lines`
  // (CLAUDE.md: the two backend builders disagree). Emitting it would print the
  // `@@` range twice — once as the header, once as a space-prefixed body line.
  it("drops a HunkHeader line from the body rather than printing @@ twice", () => {
    const h = hunk(1);
    h.lines.unshift({
      kind: { kind: "HunkHeader" },
      oldLineno: null,
      newLineno: null,
      content: "@@ -1,3 +1,3 @@\n",
    });
    expect(fileDiffToText(diff([h]))).toBe(
      ["@@ -1,3 +1,3 @@", " ctx", "-old", "+new"].join("\n"),
    );
  });

  it("keeps a line that has no trailing newline intact", () => {
    const h = hunk(1);
    h.lines[2] = {
      kind: { kind: "Addition" },
      oldLineno: null,
      newLineno: 2,
      content: "no-eol",
    };
    expect(fileDiffToText(diff([h]))).toBe(
      ["@@ -1,3 +1,3 @@", " ctx", "-old", "+no-eol"].join("\n"),
    );
  });

  it("is empty for a diff with no hunks", () => {
    expect(fileDiffToText(diff([]))).toBe("");
  });
});

describe("selectedLinesToText", () => {
  // changedIndex counts ADD/REM lines only, per hunk, after the header is
  // dropped — the same index space the line-staging ops accept.
  it("returns the bare code of the selected changed lines, no +/- prefix", () => {
    expect(selectedLinesToText(diff([hunk(1)]), { 0: [0, 1] })).toBe("old\nnew");
  });

  it("takes one line without its neighbours", () => {
    expect(selectedLinesToText(diff([hunk(1)]), { 0: [1] })).toBe("new");
  });

  it("orders by hunk, then by changedIndex, whatever order the set is in", () => {
    expect(
      selectedLinesToText(diff([hunk(1), hunk(10)]), { 1: [1, 0], 0: [1] }),
    ).toBe("new\nold\nnew");
  });

  it("ignores a changedIndex no line carries", () => {
    expect(selectedLinesToText(diff([hunk(1)]), { 0: [0, 99] })).toBe("old");
  });

  it("ignores a hunk index the diff does not have", () => {
    expect(selectedLinesToText(diff([hunk(1)]), { 7: [0] })).toBe("");
  });

  it("is empty when nothing is selected", () => {
    expect(selectedLinesToText(diff([hunk(1)]), {})).toBe("");
  });

  // A HunkHeader line is not a change, so it must not consume a changedIndex —
  // otherwise every selection in a commit diff copies the line below the one
  // the reader clicked.
  it("does not let a HunkHeader line shift the changedIndex numbering", () => {
    const h = hunk(1);
    h.lines.unshift({
      kind: { kind: "HunkHeader" },
      oldLineno: null,
      newLineno: null,
      content: "@@ -1,3 +1,3 @@\n",
    });
    expect(selectedLinesToText(diff([h]), { 0: [0] })).toBe("old");
  });
});
