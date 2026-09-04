// "Binary file" is a LIE about a checked-in `bundle.min.js` (#385).
//
// The backend caps every diff path at `MAX_WORKDIR_BLOB`, and libgit2's answer
// to that cap is to flag the file BINARY — so a capped text file would arrive
// at the surfaces indistinguishable from a PNG and read as "Binary file — no
// textual diff." That tells the user the wrong thing about their file AND hides
// the one fact that would explain it: the size.
//
// The delta therefore carries `oversized: { size, limit }`, and every surface
// prints the same sentence off it (`oversizedDiffNotice`, `lib/derive.ts`) —
// same rule as the empty-hunks state next door: a file must not read
// differently depending on which pane you opened it in.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CommitDiffPanel } from "./CommitDiffPanel";
import { isTextualDiff, oversizedDiffNotice } from "@/lib/derive";
import type { FileDiff } from "@/lib/types";

const props = {
  diffs: [] as FileDiff[],
  error: null,
  header: "abc1234 → HEAD",
  paneIdPrefix: "oversized",
  loading: false,
};

/** What a blob over the ceiling arrives as: binary per libgit2, plus the why. */
const oversized = (path: string): FileDiff => ({
  path,
  oldPath: null,
  binary: true,
  additions: 0,
  deletions: 0,
  hunks: [],
  lfs: null,
  oversized: { size: 42_000_000, limit: 5 * 1024 * 1024 },
});

/** A real binary — no size story to tell, so the old sentence stands. */
const realBinary: FileDiff = {
  path: "logo.png",
  oldPath: null,
  binary: true,
  additions: 0,
  deletions: 0,
  hunks: [],
  lfs: null,
  oversized: null,
};

describe("a diff the backend was too big to read", () => {
  it("names the real reason and the size, not 'binary'", () => {
    render(<CommitDiffPanel {...props} diffs={[oversized("bundle.min.js")]} />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("File too large to diff");
    expect(text).toContain("40 MB");
    expect(text).toContain("5.0 MB");
    // The dishonest sentence is the whole point of the change.
    expect(text).not.toContain("Binary file");
  });

  it("still says 'binary' for a file that really is binary", () => {
    render(<CommitDiffPanel {...props} diffs={[realBinary]} />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Binary file — no textual diff.");
    expect(text).not.toContain("File too large to diff");
  });

  it("does not offer the no-hunks empty state as well", () => {
    // Both conditions are true at once — an oversized delta has no hunks — and
    // two empty states stacked in one pane is worse than either alone.
    render(<CommitDiffPanel {...props} diffs={[oversized("dump.csv")]} />);
    expect(screen.queryByText("No diff")).toBeNull();
  });
});

describe("oversizedDiffNotice / isTextualDiff", () => {
  it("is null for everything that is not over the ceiling", () => {
    expect(oversizedDiffNotice(null)).toBeNull();
    expect(oversizedDiffNotice(realBinary)).toBeNull();
    expect(oversizedDiffNotice({ ...realBinary, binary: false })).toBeNull();
  });

  it("builds the sentence from the limit ON THE WIRE, not a local constant", () => {
    // A frontend copy of the policy is free to drift from the one that was
    // applied; the number the user reads has to be the one the backend used.
    const notice = oversizedDiffNotice({
      ...realBinary,
      oversized: { size: 3 * 1024 * 1024, limit: 1024 * 1024 },
    });
    expect(notice?.detail).toContain("3.0 MB");
    expect(notice?.detail).toContain("1.0 MB");
  });

  it("keeps an oversized diff out of the text renderers", () => {
    expect(isTextualDiff(oversized("bundle.min.js"))).toBe(false);
    // Belt and braces: even if a future backend stopped flagging it binary.
    expect(isTextualDiff({ ...oversized("bundle.min.js"), binary: false })).toBe(false);
  });
});
