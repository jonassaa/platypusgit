import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RebaseScreen } from "./Rebase";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { mockInvoke } from "@/test/invokeMock";
import type { CommitInfo, RebaseStatus, RepoHandle } from "@/lib/types";

const handle: RepoHandle = { id: "repo-1", path: "/tmp/fake-repo", head: "refs/heads/main" };

const SWEPT_STATUS: RebaseStatus = {
  inProgress: false,
  nextIndex: 0,
  total: 0,
  pauseReason: null,
};

function makeCommit(oid: string, summary: string, parent: string): CommitInfo {
  return {
    oid,
    shortOid: oid.slice(0, 7),
    summary,
    body: null,
    author: "Tester",
    email: "tester@example.com",
    timestamp: 1_700_000_000,
    parents: [parent],
    refs: [],
  };
}

const commits = [
  makeCommit("b".repeat(40), "feat: second", "a".repeat(40)),
  makeCommit("a".repeat(40), "feat: first", "0".repeat(40)),
];

function resetStores() {
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
    rebaseStatus: SWEPT_STATUS,
    lastRebaseSummary: null,
    activity: {},
  });
  useNavStore.setState({ intent: null });
}

function wireRefreshAllMocks(): void {
  mockInvoke("get_status", () => []);
  mockInvoke("list_branches", () => []);
  mockInvoke("list_tags", () => []);
  mockInvoke("list_stashes", () => []);
  mockInvoke("list_remotes", () => []);
  mockInvoke("get_log", () => commits);
  mockInvoke("repo_state", () => "Clean");
  // Post-#28 backend behavior: RebaseState is swept on completion, so the
  // status poll right after a finished rebase reports total: 0.
  mockInvoke("rebase_status", () => SWEPT_STATUS);
}

function seedPlanIntent(): void {
  useNavStore.setState({
    intent: {
      kind: "rebase-plan",
      plan: commits.map((c) => ({ oid: c.oid, action: "Pick", message: null })),
    },
  });
}

describe("RebaseScreen completion summary", () => {
  beforeEach(() => {
    resetStores();
    wireRefreshAllMocks();
  });

  it("shows the summary after a completed rebase even though refreshAll re-polls a swept rebase_status", async () => {
    mockInvoke("rebase_start", () => ({
      inProgress: false,
      nextIndex: 2,
      total: 2,
      pauseReason: null,
    }));

    seedPlanIntent();
    render(<RebaseScreen />);

    await userEvent.click(screen.getByTestId("rebase-start"));

    await waitFor(() => {
      expect(screen.getByTestId("rebase-last-summary")).toHaveTextContent(
        "Last rebase: 2 steps completed.",
      );
    });

    // refreshAll really did clobber rebaseStatus with the swept poll…
    const state = useRepoStore.getState();
    expect(state.rebaseStatus).toEqual(SWEPT_STATUS);
    // …but the summary survived frontend-side.
    expect(state.lastRebaseSummary).toEqual({
      inProgress: false,
      nextIndex: 2,
      total: 2,
      pauseReason: null,
    });

    // Summary also survives any later refresh cycle (poll still swept).
    await useRepoStore.getState().refreshAll();
    expect(screen.getByTestId("rebase-last-summary")).toHaveTextContent(
      "Last rebase: 2 steps completed.",
    );
  });

  it("clears the summary when a new rebase starts and pauses", async () => {
    useRepoStore.setState({
      lastRebaseSummary: { inProgress: false, nextIndex: 2, total: 2, pauseReason: null },
    });
    mockInvoke("rebase_start", () => ({
      inProgress: true,
      nextIndex: 1,
      total: 2,
      pauseReason: "conflict",
    }));
    mockInvoke("rebase_status", () => ({
      inProgress: true,
      nextIndex: 1,
      total: 2,
      pauseReason: "conflict",
    }));

    seedPlanIntent();
    render(<RebaseScreen />);

    await userEvent.click(screen.getByTestId("rebase-start"));

    await waitFor(() => {
      expect(screen.queryByTestId("rebase-last-summary")).not.toBeInTheDocument();
    });
    expect(useRepoStore.getState().lastRebaseSummary).toBeNull();
  });

  it("sets the summary when a paused rebase completes via continue, and abort clears it", async () => {
    useRepoStore.setState({
      rebaseStatus: { inProgress: true, nextIndex: 1, total: 3, pauseReason: "conflict" },
    });
    mockInvoke("rebase_continue", () => ({
      inProgress: false,
      nextIndex: 3,
      total: 3,
      pauseReason: null,
    }));

    render(<RebaseScreen />);

    await userEvent.click(screen.getByTestId("rebase-continue"));

    await waitFor(() => {
      expect(screen.getByTestId("rebase-last-summary")).toHaveTextContent(
        "Last rebase: 3 steps completed.",
      );
    });

    // Abort of a later rebase must not leave a stale "completed" summary.
    mockInvoke("rebase_abort", () => null);
    await useRepoStore.getState().rebaseAbort();
    expect(useRepoStore.getState().lastRebaseSummary).toBeNull();
  });
});
