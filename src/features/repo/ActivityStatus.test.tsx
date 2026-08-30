// The status bar's answer to "what is running, how far along, how long, and can
// I stop it" (#296).
//
// The Cancel gating is the load-bearing part. The button calls
// `cancel_network_op`, which reaches exactly the ops that run as a git
// subprocess through `run_git_authenticated`. Offering it for a rebase replay —
// which cannot be interrupted at all yet — would be a button that does nothing,
// which is worse than no button. Offering it for LFS and submodule updates,
// which the backend could always cancel, is the whole point of them joining
// `activity` in the first place.

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { ActivityStatus, ELAPSED_AFTER_MS } from "./ActivityStatus";
import { formatElapsed } from "./elapsed";
import { useRepoStore } from "./useRepoStore";
import { emptySlice } from "./repoSlice";
import type { RepoActivity } from "./repoActivity";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";

const NOW = 1_700_000_000_000;

function show(activity: RepoActivity) {
  useRepoStore.setState({
    ...emptySlice(),
    current: { id: "repo-1", path: "/tmp/repo-1", head: "main" },
    activity,
  });
  return render(<ActivityStatus />);
}

const running = (label: string, extra: Partial<RepoActivity["fetch"]> = {}) => ({
  label,
  startedAt: NOW,
  ...extra,
});

beforeEach(() => {
  resetInvokeMock();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("what it shows", () => {
  it("shows nothing at all when nothing is running", () => {
    const { container } = show({});
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the label with no bar until git reports a percentage", () => {
    // Most ops never report one — a bar stuck at 0% would read as "wedged".
    show({ fetch: running("Fetching origin…") });
    expect(screen.getByTestId("activity-label")).toHaveTextContent("Fetching origin…");
    expect(screen.queryByTestId("activity-bar")).toBeNull();
  });

  it("shows a determinate bar once a tick has landed", () => {
    show({ fetch: running("Fetching origin…", { phase: "Receiving objects", percent: 62 }) });
    expect(screen.getByTestId("activity-bar")).toHaveAttribute("data-percent", "62");
    expect(screen.getByTestId("activity-percent")).toHaveTextContent("62%");
  });

  it("picks the op the user is most likely waiting on, and counts the rest", () => {
    show({
      push: running("Pushing origin/main…"),
      submodule: running("Updating submodules…"),
      lfs: running("Fetching LFS objects…"),
    });
    expect(screen.getByTestId("activity-label")).toHaveTextContent("Pushing origin/main…");
    // Silently hiding the other two would misreport what the app is doing.
    expect(screen.getByText("+2 more")).toBeInTheDocument();
  });
});

describe("the elapsed clock", () => {
  it("stays hidden for a fast operation", () => {
    // The reason to show elapsed time is "this is taking longer than expected".
    // A number that flashes up on every 200 ms fetch is noise.
    show({ fetch: running("Fetching origin…") });
    expect(screen.queryByTestId("activity-elapsed")).toBeNull();
  });

  it("appears once the operation has run long enough", () => {
    show({ fetch: running("Fetching origin…") });
    // `act` because the readout advances from the component's own 1 Hz interval,
    // not from a store write.
    act(() => {
      vi.advanceTimersByTime(ELAPSED_AFTER_MS + 1000);
    });
    expect(screen.getByTestId("activity-elapsed")).toHaveTextContent("4s");
  });

  it("formats past a minute", () => {
    expect(formatElapsed(42_000)).toBe("42s");
    expect(formatElapsed(80_000)).toBe("1m 20s");
    expect(formatElapsed(120_000)).toBe("2m 0s");
  });
});

describe("Cancel", () => {
  it.each([
    ["fetch", "Fetching origin…"],
    ["pull", "Pulling origin/main…"],
    ["push", "Pushing origin/main…"],
    // The three that were cancellable in the backend all along and had no button.
    ["lfs", "Fetching LFS objects…"],
    ["submodule", "Updating submodules…"],
    ["forge", "Checking out #42…"],
  ] as const)("is offered for %s", (key, label) => {
    show({ [key]: running(label) });
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it.each([
    // A rebase replay runs inside one blocking libgit2 call with nothing to
    // signal — see #296 gap 6. The others are over before a click could land.
    ["rebase", "Rebasing 12 of 200: fix a thing"],
    ["stash", "Stashing changes…"],
    ["branch", "Switching to main…"],
  ] as const)("is NOT offered for %s", (key, label) => {
    show({ [key]: running(label) });
    expect(screen.getByTestId("activity-label")).toHaveTextContent(label);
    expect(screen.queryByText("Cancel")).toBeNull();
  });

  it("cancels the repository's network ops when clicked", async () => {
    mockInvoke("cancel_network_op", () => 1);
    show({ fetch: running("Fetching origin…") });

    fireEvent.click(screen.getByText("Cancel"));
    await vi.waitFor(() =>
      expect(getInvokeCalls().filter((c) => c.cmd === "cancel_network_op")).toHaveLength(1),
    );
  });
});
