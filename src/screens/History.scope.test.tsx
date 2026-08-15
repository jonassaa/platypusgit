// The All / This branch group scopes the BACKEND walk: "All" walks every
// branch (LOG_REF_ALL), "This branch" walks HEAD alone. It used to approximate
// "this branch" client-side by slicing the top `ahead` commits.
import { describe, expect, it, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { HistoryScreen } from "./History";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { useKeymapStore, useFocusStore } from "@/features/keymap";
import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";
import { LOG_REF_ALL, type CommitInfo } from "@/lib/types";

const oid = (label: string) => label.repeat(40).slice(0, 40);

const mk = (label: string, parents: string[] = []): CommitInfo => ({
  oid: oid(label),
  shortOid: oid(label).slice(0, 7),
  summary: `subject ${label}`,
  body: null,
  author: "Dev",
  email: "dev@example.com",
  timestamp: 1_700_000_000,
  parents,
  refs: [],
});

const LINEAR = [mk("a", [oid("b")]), mk("b", [oid("c")]), mk("c")];

function primeStore() {
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
    commits: LINEAR,
    searchResults: null,
    searching: false,
    searchCommits: async () => {},
    branches: [
      {
        name: "main",
        isHead: true,
        isRemote: false,
        upstream: "origin/main",
        ahead: 1,
        behind: 0,
        tip: oid("a"),
      },
    ],
    status: [],
    loading: false,
    logRef: LOG_REF_ALL,
    commitCursor: null,
  } as never);
  useNavStore.setState({ intent: null });
  useKeymapStore.setState({ handlers: new Map(), lastShiftAt: 0 });
  useKeymapStore.getState().setPreset("rider");
  useFocusStore.setState({
    focused: null,
    panes: new Map(),
    order: [],
    barId: null,
    pendingContentFocus: false,
  });
  mockInvoke("get_log_page", () => ({ commits: LINEAR, nextCursor: null }));
  mockInvoke("get_status", () => []);
  mockInvoke("list_branches", () => []);
  mockInvoke("list_tags", () => []);
  mockInvoke("list_stashes", () => []);
  mockInvoke("list_remotes", () => []);
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("rebase_status", () => ({
    inProgress: false,
    nextIndex: 0,
    total: 0,
    pauseReason: null,
  }));
}

const logRefspecs = () =>
  getInvokeCalls()
    .filter((c) => c.cmd === "get_log_page")
    .map((c) => c.args.refspec);

describe("History scope selector", () => {
  beforeEach(primeStore);

  it("starts on every branch and does not refetch to say so", async () => {
    render(<HistoryScreen />);
    await waitFor(() =>
      expect(screen.getAllByTestId("commit-row").length).toBeGreaterThan(0),
    );
    expect(useRepoStore.getState().logRef).toBe(LOG_REF_ALL);
    expect(logRefspecs()).toEqual([]);
  });

  it('rescopes the walk to HEAD for "This branch" and back for "All"', async () => {
    render(<HistoryScreen />);
    await waitFor(() =>
      expect(screen.getAllByTestId("commit-row").length).toBeGreaterThan(0),
    );

    fireEvent.click(screen.getByText("This branch"));
    await waitFor(() => expect(useRepoStore.getState().logRef).toBeNull());
    expect(logRefspecs()).toEqual([null]);

    fireEvent.click(screen.getByText("All"));
    await waitFor(() => expect(useRepoStore.getState().logRef).toBe(LOG_REF_ALL));
    expect(logRefspecs()).toEqual([null, LOG_REF_ALL]);
  });

  it("keeps a hand-picked ref instead of dragging the log back to all branches", async () => {
    render(<HistoryScreen />);
    await waitFor(() =>
      expect(screen.getAllByTestId("commit-row").length).toBeGreaterThan(0),
    );

    fireEvent.change(screen.getByTestId("history-ref-select"), {
      target: { value: "main" },
    });
    await waitFor(() => expect(useRepoStore.getState().logRef).toBe("main"));

    // The scope group still reads "All"; the effect must not fight the pick.
    await new Promise((r) => setTimeout(r, 20));
    expect(useRepoStore.getState().logRef).toBe("main");
  });

  it("offers no author-scoped option", async () => {
    render(<HistoryScreen />);
    await waitFor(() =>
      expect(screen.getAllByTestId("commit-row").length).toBeGreaterThan(0),
    );

    expect(screen.queryByText("Mine")).toBeNull();
  });
});
