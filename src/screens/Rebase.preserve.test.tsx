import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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
  localStorage.clear();
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

describe("RebaseScreen preserve mode", () => {
  it("switching to preserve turns the merge row into a Merge step", async () => {
    render(<RebaseScreen />);
    await screen.findAllByTestId("rebase-row");

    await userEvent.click(screen.getByTestId("rebase-merge-mode-preserve"));

    const rows = screen.getAllByTestId("rebase-row");
    const mergeRow = rows.find((r) => r.getAttribute("data-sha") === M.slice(0, 7))!;
    expect(mergeRow.getAttribute("data-action")).toBe("Merge");
    expect(pgSelectValues(pgSelectTrigger(mergeRow))).toEqual(["Merge", "Drop"]);
  });

  it("states the cost of preserving and disables reordering", async () => {
    render(<RebaseScreen />);
    await screen.findAllByTestId("rebase-row");
    await userEvent.click(screen.getByTestId("rebase-merge-mode-preserve"));

    const warning = screen.getByTestId("rebase-merge-warning");
    expect(warning.textContent).toContain("recreated");
    expect(warning.textContent).toContain("not preserved");
    expect(warning.textContent).toContain("Reordering is disabled");

    expect(screen.queryAllByTestId("rebase-move-up")).toHaveLength(0);
    expect(screen.queryAllByTestId("rebase-move-down")).toHaveLength(0);
  });

  it("remembers the mode across mounts", async () => {
    const first = render(<RebaseScreen />);
    await screen.findAllByTestId("rebase-row");
    await userEvent.click(screen.getByTestId("rebase-merge-mode-preserve"));
    first.unmount();

    render(<RebaseScreen />);
    expect(await screen.findByTestId("rebase-merge-mode-preserve")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("flatten stays the default and keeps reordering", async () => {
    render(<RebaseScreen />);
    await screen.findAllByTestId("rebase-row");
    expect(screen.getByTestId("rebase-merge-mode-flatten")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryAllByTestId("rebase-move-up").length).toBeGreaterThan(0);
  });
});
