// Skeleton loading state for the shared commit-diff panel (#61 B6).

import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { CommitDiffPanel } from "./CommitDiffPanel";
import type { FileDiff } from "@/lib/types";

const props = {
  diffs: [],
  error: null,
  header: "abc1234 → HEAD",
  paneIdPrefix: "test",
};

describe("CommitDiffPanel loading state", () => {
  it("shows skeleton placeholders while loading", () => {
    render(<CommitDiffPanel {...props} loading />);
    expect(screen.getAllByTestId("pg-skeleton").length).toBeGreaterThan(0);
  });

  it("shows no placeholders once loaded", () => {
    render(<CommitDiffPanel {...props} loading={false} />);
    expect(screen.queryAllByTestId("pg-skeleton")).toHaveLength(0);
  });

  it("shows the empty label, not placeholders, for an empty diff", () => {
    render(
      <CommitDiffPanel {...props} loading={false} emptyLabel="Nothing here." />,
    );
    expect(screen.getByText("Nothing here.")).toBeTruthy();
    expect(screen.queryAllByTestId("pg-skeleton")).toHaveLength(0);
  });
});

// Every caller still HOLDS the previous target's diffs while the next fetch is
// in flight — History debounces and leaves `inlineDiffs` alone until the new
// ones land — so `loading` and a non-empty `diffs` are true together on every
// commit step. The skeleton then sat directly above the previous commit's file
// rows, and its diff still filled the view pane.
const previous: FileDiff[] = [
  {
    path: "previous-commit-file.ts",
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
          {
            kind: { kind: "Context" },
            oldLineno: 1,
            newLineno: 1,
            content: "kept line",
          },
          {
            kind: { kind: "Addition" },
            oldLineno: null,
            newLineno: 2,
            content: "previous commit line",
          },
        ],
      },
    ],
  },
];

describe("CommitDiffPanel loading over a previous diff", () => {
  it("renders no stale file rows under the skeleton", () => {
    render(<CommitDiffPanel {...props} diffs={previous} loading />);
    expect(screen.getAllByTestId("pg-skeleton").length).toBeGreaterThan(0);
    expect(screen.queryByText(/previous-commit-file/)).toBeNull();
    expect(document.querySelector("[data-path]")).toBeNull();
  });

  it("renders no stale diff body while loading", () => {
    render(<CommitDiffPanel {...props} diffs={previous} loading />);
    expect(screen.queryByText(/previous commit line/)).toBeNull();
    expect(screen.queryByText(/kept line/)).toBeNull();
  });

  it("renders the file rows and body again once the new diff lands", async () => {
    render(<CommitDiffPanel {...props} diffs={previous} loading={false} />);
    await waitFor(() =>
      expect(screen.getByText(/previous commit line/)).toBeInTheDocument(),
    );
    expect(
      document.querySelector('[data-path="previous-commit-file.ts"]'),
    ).not.toBeNull();
  });
});
