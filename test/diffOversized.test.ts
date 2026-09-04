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

/**
 * Source with its comments removed.
 *
 * These files explain themselves at length, and several of the assertions below
 * forbid SHIPPING a string, not mentioning it — a guard that cannot tell the
 * two apart makes the prose the thing you have to work around.
 */
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

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

describe("the honest 'we shortened this' answer reaches every diff surface", () => {
  // The other end of the escape hatch (#396). Waiving the ceiling gets the blob
  // READ; it does not make a million rows something a diff pane can lay out, so
  // the backend caps the lines. A surface that renders the rows and never
  // mentions the cap shows a diff that appears to simply end — the silent wrong
  // answer this whole area exists to avoid.
  it.each(DIFF_SURFACES)("%s says when the diff was shortened", (file) => {
    expect(read(file)).toContain("TruncatedDiffNotice");
  });

  it.each(DIFF_SURFACES)("%s does not hardcode the line cap", (file) => {
    // Same reasoning as the ceiling above: the numbers the user reads come off
    // the wire, because the cap is the backend's policy.
    expect(read(file)).not.toMatch(/100[_,]?000/);
  });
});

describe("'Diff it anyway' is offered by every diff surface, and owned by none", () => {
  // #385 left the notice NAMING a limit with no way to act on it, which is the
  // shape that invites the question. The action is shared for exactly the reason
  // the sentence is (see `isTextualDiff`'s doc comment): a surface that grows
  // its own button is how the same file comes to behave differently depending
  // on which pane you opened it in.
  it.each(DIFF_SURFACES)("%s offers the shared action", (file) => {
    // `OversizedDiffEmpty` is the whole pane — sentence, copy and the shared
    // `OversizedDiffAction` inside it. The surfaces render THAT rather than
    // assembling the three themselves, and it deliberately takes precedence
    // over the image-preview branch: the preview ceiling is BELOW the diff one,
    // so an over-ceiling blob always reports `tooLarge`, which suppressed the
    // fallback the #385 sentence used to live in.
    expect(read(file)).toContain("OversizedDiffEmpty");
  });

  it.each(DIFF_SURFACES)("%s puts it ahead of the image preview", (file) => {
    // The regression that made the #385 sentence unreachable. Rendering the
    // image shell first means `tooLarge` wins and the user reads "Too large to
    // preview" — which says less and offers nothing to click.
    const src = read(file);
    const oversizedAt = src.indexOf("OversizedDiffEmpty\n");
    const imageAt = src.search(/<ImageDiff(OrEmpty|View)\n/);
    expect(oversizedAt).toBeGreaterThan(-1);
    if (imageAt > -1) expect(oversizedAt).toBeLessThan(imageAt);
  });

  it.each(DIFF_SURFACES)("%s does not build its own", (file) => {
    // A local button would drift in label, in disabled state, and in whether it
    // is offered a second time for a blob over even the raised ceiling. Read
    // past the comments — naming the feature in prose is how these files
    // explain themselves; SHIPPING the label is the thing being forbidden.
    expect(codeOnly(read(file))).not.toMatch(/Diff it anyway/);
  });

  // `CommitDiffPanel` is presentational — its caller fetches the diffs, so its
  // caller is the only thing that can answer a waived re-read. A screen that
  // mounts the panel without wiring this shows the notice with nothing under
  // it, which is exactly the pre-#396 dead end.
  const COMMIT_DIFF_OWNERS = [
    "src/screens/CommitDiff.tsx",
    "src/screens/History.tsx",
    "src/screens/Compare.tsx",
  ];
  it.each(COMMIT_DIFF_OWNERS)("%s gives the panel somewhere to send it", (file) => {
    expect(read(file)).toContain("onDiffAnyway=");
  });
});

describe("the backend applies one ceiling, not one capped path and three uncapped", () => {
  // The bug this fixes was a POLICY split, not a rendering one: `max_size` was
  // set at exactly one of the diff builders. Counting the call sites is the
  // cheapest way to keep a new diff op from quietly inheriting libgit2's 512 MB
  // default — bump the number when you add one, deliberately.
  //
  // Since #396 the ceiling is a FUNCTION of whether the user waived it, so what
  // this counts is that every site still goes through that one decision:
  // `ceiling` (the value the op computed once) or a direct `blob_ceiling(..)`.
  // A site naming a constant again would be a second policy.
  it("routes every diff-options site through the one ceiling function", () => {
    const src = read("src-tauri/src/git/libgit2.rs");
    const sites = src.match(/\.max_size\([^)]*\)?\)/g) ?? [];
    expect(sites.length).toBe(6);
    for (const site of sites) {
      expect(site).toMatch(/\.max_size\((ceiling|blob_ceiling\()/);
    }
  });

  it("scopes a raised ceiling to the waived paths, at every multi-file diff", () => {
    const src = read("src-tauri/src/git/libgit2.rs");
    // A raised ceiling with no pathspec would waive it for EVERY blob in the
    // diff — so "show me that 40 MB CSV" would also read the 60 MB bundle in
    // the same commit, which is the footgun a per-file escape hatch exists to
    // avoid (#396). Every builder that can see more than one delta pairs the
    // two; `diff` is exempt because it pathspecs its single path already.
    const scoped = src.match(/scope_to_raised\(&mut \w+, raise_for\)/g) ?? [];
    expect(scoped.length).toBe(5);
  });

  it("keeps the override a different ceiling, not the absence of one", () => {
    // The thing #385 removed was an uncapped diff path. `blob_ceiling` returns
    // one of two constants, so there is no way to ask for "no limit" — a
    // regression here would most likely look like an `Option<u64>` straight off
    // the wire, which is why the wire carries paths instead.
    const src = read("src-tauri/src/git/libgit2.rs");
    expect(src).toMatch(/fn blob_ceiling\(raise: bool\) -> i64/);
    expect(src).toContain("MAX_BLOB_OVERRIDE");
  });
});
