// Skeleton loading state for the shared commit-diff panel (#61 B6).

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CommitDiffPanel } from "./CommitDiffPanel";

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
