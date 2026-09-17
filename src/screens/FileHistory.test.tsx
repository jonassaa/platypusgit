// The file-history screen, and the three things a bounded search owes the
// reader (#474).
//
// The list itself was never the problem. What was missing is that the walk
// behind it has limits, and hitting one looked exactly like reaching the end of
// the file's history — so on a large repository the screen either showed a
// truncated answer as if it were complete, or sat on a spinner for minutes with
// nothing to stop it. This covers what it now says, the way past the cap, and
// that leaving does not leave a walk running.

import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { FileHistoryScreen } from "./FileHistory";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import type { CommitInfo, FileHistory, HistoryStop } from "@/lib/types";

const commit = (n: number): CommitInfo => ({
  oid: String(n).repeat(40).slice(0, 40),
  shortOid: `000000${n}`,
  summary: `change ${n}`,
  body: null,
  author: "Author",
  email: "author@example.com",
  timestamp: 1_700_000_000,
  parents: [],
  refs: [],
});

const history = (
  stoppedAt: HistoryStop,
  visited: number,
  matches = 2,
): FileHistory => ({
  commits: Array.from({ length: matches }, (_, i) => commit(i + 1)),
  visited,
  stoppedAt,
});

const historyCalls = () => getInvokeCalls().filter((c) => c.cmd === "file_history");
const cancelCalls = () => getInvokeCalls().filter((c) => c.cmd === "cancel_walk");

beforeEach(() => {
  resetInvokeMock();
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
    activity: {},
  } as never);
  useNavStore.setState({ intent: { kind: "file-history", path: "src/main.rs" } });
});

describe("a complete answer", () => {
  it("lists the commits and says nothing about limits", async () => {
    mockInvoke("file_history", () => history("Exhausted", 12));
    render(<FileHistoryScreen />);

    await waitFor(() => expect(screen.getByText("change 1")).toBeInTheDocument());
    expect(screen.queryByTestId("history-limit-notice")).toBeNull();
  });

  it("asks for the capped walk by default — the uncapped one is 135 s on the kernel", async () => {
    mockInvoke("file_history", () => history("Exhausted", 12));
    render(<FileHistoryScreen />);

    await waitFor(() => expect(historyCalls()).toHaveLength(1));
    expect(historyCalls()[0].args.searchAll).toBe(false);
  });
});

describe("a search that stopped at its own cap", () => {
  it("says how far it looked, and offers the rest", async () => {
    mockInvoke("file_history", () => history("VisitLimit", 50_000, 0));
    render(<FileHistoryScreen />);

    const notice = await screen.findByTestId("history-limit-notice");
    expect(notice.textContent).toContain("50,000");
    expect(screen.getByTestId("history-search-all")).toBeInTheDocument();
  });

  it("waives the cap on the second ask, and keeps the answer", async () => {
    mockInvoke("file_history", (args) =>
      args.searchAll ? history("Exhausted", 1_482_923, 3) : history("VisitLimit", 50_000, 0),
    );
    render(<FileHistoryScreen />);

    fireEvent.click(await screen.findByTestId("history-search-all"));

    await waitFor(() => expect(historyCalls()).toHaveLength(2));
    expect(historyCalls()[1].args.searchAll).toBe(true);
    // The notice goes because the claim it made is no longer true.
    await waitFor(() => expect(screen.getByText("change 3")).toBeInTheDocument());
    expect(screen.queryByTestId("history-limit-notice")).toBeNull();
  });

  // A full list is a different claim with no remedy: walking further finds more
  // matches and the list still holds `limit` of them.
  it("does not offer to search further when the LIST is what filled up", async () => {
    mockInvoke("file_history", () => history("MatchLimit", 9_000, 2));
    render(<FileHistoryScreen />);

    await screen.findByTestId("history-limit-notice");
    expect(screen.queryByTestId("history-search-all")).toBeNull();
  });
});

describe("while it runs, and when it is stopped", () => {
  it("joins RepoActivity, so the status bar can name it and stop it", async () => {
    // Initialised rather than `| null`: TypeScript does not narrow a `let`
    // assigned inside a callback, so an optional call on it is `never`.
    let release: (h: FileHistory) => void = () => {};
    mockInvoke("file_history", () => new Promise<FileHistory>((r) => (release = r)));
    render(<FileHistoryScreen />);

    await waitFor(() =>
      expect(useRepoStore.getState().activity.history?.label).toContain("src/main.rs"),
    );

    release(history("Exhausted", 4));
    // …and lets go of it afterwards, or the status bar never falls silent.
    await waitFor(() => expect(useRepoStore.getState().activity.history).toBeUndefined());
  });

  it("stops the walk when the screen goes away", async () => {
    mockInvoke("file_history", () => new Promise<FileHistory>(() => {}));
    mockInvoke("cancel_walk", () => 1);
    const view = render(<FileHistoryScreen />);

    await waitFor(() => expect(historyCalls()).toHaveLength(1));
    view.unmount();

    await waitFor(() => expect(cancelCalls()).toHaveLength(1));
    expect(cancelCalls()[0].args.repoId).toBe("r1");
    expect(useRepoStore.getState().activity.history).toBeUndefined();
  });

  it("does not signal a cancel for a walk that already finished", async () => {
    mockInvoke("file_history", () => history("Exhausted", 4));
    const view = render(<FileHistoryScreen />);

    await waitFor(() => expect(screen.getByText("change 1")).toBeInTheDocument());
    view.unmount();

    expect(cancelCalls()).toHaveLength(0);
  });

  // `cancel_walk` addresses the REPOSITORY, not one walk — so a cancel still in
  // flight would reach whatever is registered when it arrives, which after a
  // file switch is the walk for the file the user just opened. Switching files
  // would then cancel its own replacement, at random, depending on which IPC
  // call won.
  it("waits for a cancel to land before starting the next file's walk", async () => {
    let releaseCancel: (n: number) => void = () => {};
    mockInvoke("file_history", () => new Promise<FileHistory>(() => {}));
    mockInvoke("cancel_walk", () => new Promise<number>((r) => (releaseCancel = r)));
    render(<FileHistoryScreen />);

    await waitFor(() => expect(historyCalls()).toHaveLength(1));

    useNavStore.setState({ intent: { kind: "file-history", path: "src/other.rs" } });
    await waitFor(() => expect(cancelCalls()).toHaveLength(1));
    expect(historyCalls()).toHaveLength(1);

    releaseCancel(1);
    await waitFor(() => expect(historyCalls()).toHaveLength(2));
    expect(historyCalls()[1].args.path).toBe("src/other.rs");
  });

  // The user's own click must not come back as a red failure.
  it("reads a cancellation as a stop, not an error, and can try again", async () => {
    let attempts = 0;
    mockInvoke("file_history", () => {
      attempts += 1;
      if (attempts === 1) throw { kind: "Cancelled" };
      return history("Exhausted", 4);
    });
    render(<FileHistoryScreen />);

    const stopped = await screen.findByTestId("history-search-cancelled");
    expect(stopped.textContent).toContain("Search stopped");

    fireEvent.click(screen.getByTestId("history-search-again"));
    await waitFor(() => expect(screen.getByText("change 1")).toBeInTheDocument());
    expect(screen.queryByTestId("history-search-cancelled")).toBeNull();
  });
});
