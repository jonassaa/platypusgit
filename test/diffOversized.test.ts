/**
 * @vitest-environment node
 */
// "A file too large to diff says so, on every surface." (#385)
//
// Same shape, and the same reasoning, as `diffCaretSurfaces.test.ts`,
// `diffFindSurfaces.test.ts` and `diffCopyMenu.test.ts` next door.
//
// The backend caps every diff path at `MAX_WORKDIR_BLOB`, and libgit2's answer
// to that cap is to flag the delta BINARY — so a capped `bundle.min.js` arrives
// at the surfaces indistinguishable from a PNG and, without this, reads as
// "Binary file". That is not true about a text file, and it hides the one fact
// that explains the pane: the size.
//
// The seam is `oversizedDiffNotice` (`lib/derive.ts`), which turns the delta's
// `oversized: { size, limit }` into the sentence. A surface that renders the
// binary empty state and does NOT consult it prints the dishonest one — and
// `isTextualDiff`'s doc comment is explicit that a file must not read
// differently depending on which pane you opened it in.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Every file that renders diff rows — the same four as the caret/find guards. */
const DIFF_SURFACES = [
  "src/screens/CommitPanel.tsx",
  "src/screens/DiffViewer.tsx",
  "src/screens/RepoBrowser.tsx",
  "src/features/diff/CommitDiffPanel.tsx",
];

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("the honest 'too large to diff' answer reaches every diff surface", () => {
  it.each(DIFF_SURFACES)("%s asks why the delta has no text", (file) => {
    expect(read(file)).toContain("oversizedDiffNotice(");
  });

  it.each(DIFF_SURFACES)("%s does not hardcode the ceiling", (file) => {
    // The limit the user reads comes off the wire — a frontend copy of the
    // policy is free to drift from the one `libgit2.rs` actually applied.
    expect(read(file)).not.toMatch(/5\s*\*\s*1024\s*\*\s*1024/);
  });

  // The complement: "Binary file" must still be reachable, or a real PNG would
  // start claiming it is too large. Every surface keeps it as the fallback.
  it.each(DIFF_SURFACES)("%s keeps the binary wording for a real binary", (file) => {
    expect(read(file)).toContain("Binary file");
  });
});

describe("the backend applies one ceiling, not one capped path and three uncapped", () => {
  // The bug this fixes was a POLICY split, not a rendering one: `max_size` was
  // set at exactly one of the diff builders. Counting the call sites is the
  // cheapest way to keep a new diff op from quietly inheriting libgit2's 512 MB
  // default — bump the number when you add one, deliberately.
  it("sets max_size at every diff-options site in libgit2.rs", () => {
    const src = read("src-tauri/src/git/libgit2.rs");
    const caps = src.match(/max_size\(MAX_WORKDIR_BLOB\)/g) ?? [];
    expect(caps.length).toBe(6);
  });
});
