// The status bar's Cancel affordance says which signal the next click sends
// (#263).
//
// The backend cancels a stalled fetch/pull/push with SIGTERM first — that is
// what lets git run `remove_lock_file_on_signal` and NOT strand
// `.git/FETCH_HEAD.lock` — and escalates to SIGKILL only on a second cancel of
// the same op. That design makes the second click load-bearing, which only
// works if the first one visibly changed something. Before this, the status
// line still read "Fetching origin…" next to a button still reading "Cancel",
// so the honest reading was "nothing happened" and the natural response was to
// click again immediately: SIGKILL within a few hundred milliseconds, and the
// stranded lock file back.

import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AppStatusBar } from "./AppShell";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { emptySlice } from "@/features/repo/repoSlice";
import { mockInvoke, resetInvokeMock } from "@/test/invokeMock";

beforeEach(() => {
  resetInvokeMock();
  useRepoStore.setState({
    ...emptySlice(),
    current: { id: "repo-1", path: "/tmp/repo-1", head: "refs/heads/main" },
    activity: { fetch: "Fetching origin…" },
  });
  mockInvoke("cancel_network_op", () => 1);
});

describe("the Cancel item on a running network op", () => {
  it("offers a plain Cancel beside the label that says what is stuck", () => {
    render(<AppStatusBar />);

    expect(screen.getByText("Fetching origin…")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("turns into Force stop once the polite signal has been sent", async () => {
    render(<AppStatusBar />);

    fireEvent.click(screen.getByText("Cancel"));

    // Both halves move: the label the user is staring at, and the button they
    // are about to click again.
    await waitFor(() =>
      expect(screen.getByText("Force stop")).toBeInTheDocument(),
    );
    expect(screen.getByText("Cancelling…")).toBeInTheDocument();
    expect(screen.queryByText("Fetching origin…")).not.toBeInTheDocument();
  });

  it("stays clickable, because the second click is the escalation", async () => {
    let cancels = 0;
    mockInvoke("cancel_network_op", () => {
      cancels += 1;
      return 1;
    });
    render(<AppStatusBar />);

    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => expect(cancels).toBe(1));
    fireEvent.click(screen.getByText("Force stop"));

    // A disabled-after-first-click button would leave a git that ignored
    // SIGTERM unkillable — the dead end #234 existed to remove.
    await waitFor(() => expect(cancels).toBe(2));
  });

  it("goes back to Cancel when the op unwinds", async () => {
    render(<AppStatusBar />);
    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() =>
      expect(screen.getByText("Force stop")).toBeInTheDocument(),
    );

    // The op's `finally` drops the last activity label.
    useRepoStore.setState({ activity: {}, cancelRequested: false });
    useRepoStore.setState({ activity: { fetch: "Fetching origin…" } });

    // The NEXT stalled fetch must start from the polite signal again.
    await waitFor(() => expect(screen.getByText("Cancel")).toBeInTheDocument());
  });
});
