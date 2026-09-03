// A textual diff with ZERO hunks still has to say something.
//
// Two everyday changes produce a `FileDiff` with no hunks at all: an empty added
// file (a `.gitkeep`), and a mode-only change (`chmod +x`) — git prints
// `old mode`/`new mode` and no `@@` range, so the delta reaches the frontend
// with `0 / 0` and an empty `hunks`. The file row is there, and before this the
// pane beside it was blank white space with nothing to read and nothing to
// click. This panel is what History, CommitDiff and Compare render, i.e. the
// screen the app launches on.
//
// The sentence is the one `CommitPanel` already prints for the same condition —
// `isTextualDiff`'s doc comment is explicit that the surfaces must agree, and a
// reader who sees one wording on the commit panel and another on a commit's
// diff learns the two panes disagree about the file.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CommitDiffPanel } from "./CommitDiffPanel";
import type { FileDiff } from "@/lib/types";

const props = {
  diffs: [] as FileDiff[],
  error: null,
  header: "abc1234 → HEAD",
  paneIdPrefix: "empty-hunks",
  loading: false,
};

/** What a `chmod +x` or an empty added file arrives as. */
const noHunks = (path: string): FileDiff => ({
  path,
  oldPath: null,
  binary: false,
  additions: 0,
  deletions: 0,
  hunks: [],
  lfs: null,
});

const withHunk: FileDiff = {
  path: "changed.ts",
  oldPath: null,
  binary: false,
  additions: 1,
  deletions: 0,
  hunks: [
    {
      header: "@@ -1,1 +1,2 @@",
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 2,
      lines: [
        { kind: { kind: "Context" }, oldLineno: 1, newLineno: 1, content: "kept" },
        {
          kind: { kind: "Addition" },
          oldLineno: null,
          newLineno: 2,
          content: "added line",
        },
      ],
    },
  ],
};

describe("CommitDiffPanel, a file with no hunks", () => {
  it("explains the empty pane instead of rendering nothing", () => {
    render(<CommitDiffPanel {...props} diffs={[noHunks("scripts/build.sh")]} />);
    expect(screen.getByText("No diff")).toBeInTheDocument();
    expect(
      screen.getByText("File is tracked but no hunks were produced."),
    ).toBeInTheDocument();
  });

  it("still lists the file, so the row and the pane agree", () => {
    render(<CommitDiffPanel {...props} diffs={[noHunks("scripts/build.sh")]} />);
    expect(document.querySelector('[data-path="scripts/build.sh"]')).not.toBeNull();
  });

  it("says nothing of the sort for a file that does have hunks", () => {
    render(<CommitDiffPanel {...props} diffs={[withHunk]} />);
    expect(screen.queryByText("No diff")).toBeNull();
  });

  it("leaves a binary file to its own notice, not this one", () => {
    // `isTextualDiff` is false there, and the branch above it already renders a
    // preview or "Binary file — no textual diff.". Two empty states at once
    // would be worse than the blank pane this replaces.
    render(
      <CommitDiffPanel
        {...props}
        diffs={[{ ...noHunks("logo.png"), binary: true }]}
      />,
    );
    expect(screen.queryByText("No diff")).toBeNull();
  });
});
