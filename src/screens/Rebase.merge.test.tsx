import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import { RebaseScreen } from "./Rebase";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { mockInvoke } from "@/test/invokeMock";
import type { CommitInfo, RebaseStatus, RepoHandle } from "@/lib/types";
import { pgSelectTrigger, pgSelectValues } from "@/test/select";

const handle: RepoHandle = { id: "repo-1", path: "/tmp/fake-repo", head: "refs/heads/main" };
const SWEPT: RebaseStatus = { inProgress: false, nextIndex: 0, total: 0, pauseReason: null };

function mk(oid: string, summary: string, parents: string[]): CommitInfo {
  return {
    oid,
    shortOid: oid.slice(0, 7),
    summary,
    body: null,
    author: "Tester",
    email: "t@e.com",
    timestamp: 1_700_000_000,
    parents,
    refs: [],
  };
}

const M = "m".repeat(40);
const C = "c".repeat(40);
const F = "f".repeat(40);
const A = "a".repeat(40);

const commits = [
  mk(M, "Merge branch 'feature'", [C, F]),
  mk(C, "C on main", [A]),
  mk(F, "F on feature", [A]),
  mk(A, "A on main", ["0".repeat(40)]),
];

beforeEach(() => {
  useRepoStore.setState({
    current: handle,
    status: [],
    allFiles: [],
    branches: [],
    tags: [],
    stashes: [],
    remotes: [],
    commits,
    loading: false,
    error: null,
    repoState: "Clean",
    rebaseStatus: SWEPT,
    activity: {},
  });
  mockInvoke("rebase_status", () => SWEPT);
  useNavStore.setState({
    intent: {
      kind: "rebase-plan",
      plan: [
        { oid: F, action: "Pick", message: null },
        { oid: C, action: "Pick", message: null },
        { oid: M, action: "Drop", message: null },
      ],
    },
  });
});

describe("RebaseScreen with merge commits in the plan", () => {
  it("warns that the merge will be flattened, counting the merges", async () => {
    render(<RebaseScreen />);
    const warning = await screen.findByTestId("rebase-merge-warning");
    expect(warning.textContent).toContain("1 merge commit");
    expect(warning.textContent).toContain("linear");
  });

  it("badges the merge row and restricts its actions", async () => {
    render(<RebaseScreen />);
    const rows = await screen.findAllByTestId("rebase-row");
    const mergeRow = rows.find((r) => r.getAttribute("data-sha") === M.slice(0, 7));
    expect(mergeRow).toBeDefined();
    expect(
      mergeRow!.querySelector('[data-testid="rebase-badge"]')?.textContent,
    ).toBe("merge");
    expect(pgSelectValues(pgSelectTrigger(mergeRow!))).toEqual([
      "Drop",
      "MainlinePick",
    ]);
  });

  it("says nothing when the range has no merges", async () => {
    useNavStore.setState({
      intent: {
        kind: "rebase-plan",
        plan: [{ oid: C, action: "Pick", message: null }],
      },
    });
    render(<RebaseScreen />);
    await screen.findAllByTestId("rebase-row");
    expect(screen.queryByTestId("rebase-merge-warning")).toBeNull();
  });
});
