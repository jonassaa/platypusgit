import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RebaseScreen } from "./Rebase";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { mockInvoke } from "@/test/invokeMock";
import type { CommitInfo, RebaseStatus, RepoHandle } from "@/lib/types";

const handle: RepoHandle = { id: "repo-1", path: "/tmp/fake-repo", head: "refs/heads/main" };

/** What `rebase_status` reports once the engine has swept its RebaseState. */
const SWEPT_STATUS: RebaseStatus = {
  inProgress: false,
  nextIndex: 0,
  total: 0,
  pauseReason: null,
  lastCompleted: null,
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
    activity: {},
  });
  useNavStore.setState({ intent: null });
}

/**
 * The backend behaviour the summary depends on: RebaseState is swept the moment
 * a plan finishes (#28), but the completed-rebase summary is RETAINED until
 * acknowledged (#47) — so the swept poll still carries `lastCompleted`, and
 * `rebase_acknowledge` is what makes it stop.
 */
function wireRefreshAllMocks(retained: RebaseStatus["lastCompleted"] = null): {
  ackCalls: () => number;
} {
  let acked = 0;
  let held = retained;
  mockInvoke("get_status", () => []);
  mockInvoke("list_branches", () => []);
  mockInvoke("list_tags", () => []);
  mockInvoke("list_stashes", () => []);
  mockInvoke("list_remotes", () => []);
  mockInvoke("get_log_page", () => ({ commits, nextCursor: null }));
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("rebase_status", () => ({ ...SWEPT_STATUS, lastCompleted: held }));
  mockInvoke("rebase_acknowledge", () => {
    acked += 1;
    held = null;
    return null;
  });
  return { ackCalls: () => acked };
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
  });

  it("shows the summary from the retained backend value, not a frontend cache", async () => {
    wireRefreshAllMocks({ total: 2, completed: 2 });
    mockInvoke("rebase_start", () => ({
      inProgress: false,
      nextIndex: 2,
      total: 2,
      pauseReason: null,
      lastCompleted: { total: 2, completed: 2 },
    }));

    seedPlanIntent();
    render(<RebaseScreen />);

    await userEvent.click(screen.getByTestId("rebase-start"));

    await waitFor(() => {
      expect(screen.getByTestId("rebase-last-summary")).toHaveTextContent(
        "Last rebase: 2 steps completed.",
      );
    });

    // refreshAll really did re-poll a swept rebase_status — total is back to 0…
    const state = useRepoStore.getState();
    expect(state.rebaseStatus.total).toBe(0);
    expect(state.rebaseStatus.inProgress).toBe(false);
    // …and the summary survived because the BACKEND kept it, not the store.
    expect(state.rebaseStatus.lastCompleted).toEqual({ total: 2, completed: 2 });

    // Still there after any later refresh cycle: nothing has acknowledged it.
    await useRepoStore.getState().refreshAll();
    expect(screen.getByTestId("rebase-last-summary")).toHaveTextContent(
      "Last rebase: 2 steps completed.",
    );
  });

  it("acknowledges the summary when the screen goes away, and does not show it again", async () => {
    const { ackCalls } = wireRefreshAllMocks({ total: 3, completed: 3 });
    useRepoStore.setState({
      rebaseStatus: { ...SWEPT_STATUS, lastCompleted: { total: 3, completed: 3 } },
    });

    const view = render(<RebaseScreen />);
    expect(screen.getByTestId("rebase-last-summary")).toHaveTextContent(
      "Last rebase: 3 steps completed.",
    );
    expect(ackCalls()).toBe(0);

    view.unmount();
    await waitFor(() => expect(ackCalls()).toBe(1));

    // A later visit finds nothing retained — the notice is spent.
    await useRepoStore.getState().refreshAll();
    render(<RebaseScreen />);
    expect(screen.queryByTestId("rebase-last-summary")).not.toBeInTheDocument();
  });

  it("shows no summary once a new rebase starts and pauses", async () => {
    // The engine drops the summary at rebase_start, so no frontend clearing is
    // involved — the very next status read simply has nothing to report.
    wireRefreshAllMocks({ total: 2, completed: 2 });
    useRepoStore.setState({
      rebaseStatus: { ...SWEPT_STATUS, lastCompleted: { total: 2, completed: 2 } },
    });
    const paused: RebaseStatus = {
      inProgress: true,
      nextIndex: 1,
      total: 2,
      pauseReason: "conflict",
      lastCompleted: null,
    };
    mockInvoke("rebase_start", () => paused);
    mockInvoke("rebase_status", () => paused);

    seedPlanIntent();
    render(<RebaseScreen />);

    await userEvent.click(screen.getByTestId("rebase-start"));

    await waitFor(() => {
      expect(screen.queryByTestId("rebase-last-summary")).not.toBeInTheDocument();
    });
    expect(useRepoStore.getState().rebaseStatus.lastCompleted).toBeNull();
  });

  it("reports a paused rebase completing via continue, and an abort clears it", async () => {
    wireRefreshAllMocks({ total: 3, completed: 3 });
    useRepoStore.setState({
      rebaseStatus: {
        inProgress: true,
        nextIndex: 1,
        total: 3,
        pauseReason: "conflict",
        lastCompleted: null,
      },
    });
    mockInvoke("rebase_continue", () => ({
      inProgress: false,
      nextIndex: 3,
      total: 3,
      pauseReason: null,
      lastCompleted: { total: 3, completed: 3 },
    }));

    render(<RebaseScreen />);

    await userEvent.click(screen.getByTestId("rebase-continue"));

    await waitFor(() => {
      expect(screen.getByTestId("rebase-last-summary")).toHaveTextContent(
        "Last rebase: 3 steps completed.",
      );
    });

    // Abort must not leave a stale "completed" line: the engine clears the
    // summary too, and the store's reset carries that through immediately.
    mockInvoke("rebase_abort", () => null);
    mockInvoke("rebase_status", () => SWEPT_STATUS);
    await useRepoStore.getState().rebaseAbort();
    expect(useRepoStore.getState().rebaseStatus.lastCompleted).toBeFalsy();
    await waitFor(() => {
      expect(screen.queryByTestId("rebase-last-summary")).not.toBeInTheDocument();
    });
  });
});
