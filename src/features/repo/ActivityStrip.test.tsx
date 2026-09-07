// The history view's "something is running" strip (#431).
//
// The status bar has answered "what is running, how far along, how long, can I
// stop it" since #296 — but it answers it at the very bottom edge of the
// window, and the thing a user stares at while a checkout or a rebase runs is
// the commit list. These tests pin the two properties that make the strip worth
// having rather than noise: it says the same thing the status bar says, and it
// says nothing at all about an operation that was over before you could read it.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { ActivityStrip, SHOW_AFTER_MS } from "./ActivityStrip";
import { ELAPSED_AFTER_MS } from "./activityView";
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
  return render(<ActivityStrip />);
}

const running = (label: string, extra: Partial<RepoActivity["fetch"]> = {}) => ({
  label,
  startedAt: NOW,
  ...extra,
});

/** Push past the flicker floor, the way a slow operation does. */
function waitOut(ms = SHOW_AFTER_MS + 1) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

const bar = () => screen.queryByTestId("activity-strip-bar");

beforeEach(() => {
  resetInvokeMock();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the flicker floor", () => {
  it("shows nothing at all while the app is idle", () => {
    const { container } = show({});
    waitOut();
    expect(container).toBeEmptyDOMElement();
  });

  it("stays silent through an operation that finishes quickly", () => {
    // The strip sits IN the layout, above the commit list. With no floor, every
    // 80 ms checkout and every background refresh would shove the rows the user
    // is reading down and back up again — which is worse than saying nothing,
    // because the ops worth reporting are exactly the slow ones.
    const { container } = show({ branch: running("Switching to main…") });
    waitOut(SHOW_AFTER_MS - 1);
    expect(container).toBeEmptyDOMElement();
  });

  it("names the operation once it has run long enough to notice", () => {
    show({ branch: running("Switching to feat/loading-ui…") });
    waitOut();
    expect(screen.getByTestId("activity-strip-label")).toHaveTextContent(
      "Switching to feat/loading-ui…",
    );
  });
});

describe("what it shows", () => {
  it("runs an indeterminate bar when the operation reports no percentage", () => {
    // A checkout, a rebase replay and a stash have no progress protocol to
    // read. The bar still moves, because "working" is the fact being reported;
    // it just must not imply a position.
    show({ branch: running("Switching to feat/loading-ui…") });
    waitOut();
    expect(bar()).toHaveAttribute("data-indeterminate", "true");
    expect(screen.queryByTestId("activity-strip-percent")).toBeNull();
  });

  it("switches to a determinate bar once a progress tick has landed", () => {
    show({
      fetch: running("Fetching origin…", { phase: "Receiving objects", percent: 62 }),
    });
    waitOut();
    expect(bar()).toHaveAttribute("data-percent", "62");
    expect(bar()).not.toHaveAttribute("data-indeterminate", "true");
    expect(screen.getByTestId("activity-strip-percent")).toHaveTextContent("62%");
  });

  it("counts the operations it is not naming", () => {
    show({
      push: running("Pushing origin/main…"),
      submodule: running("Updating submodules…"),
      lfs: running("Fetching LFS objects…"),
    });
    waitOut();
    expect(screen.getByTestId("activity-strip-label")).toHaveTextContent(
      "Pushing origin/main…",
    );
    expect(screen.getByTestId("activity-strip-others")).toHaveTextContent("+2 more");
  });

  it("holds the elapsed clock back until the wait is worth reporting", () => {
    show({ rebase: running("Rebasing 40 commits…") });
    waitOut();
    expect(screen.queryByTestId("activity-strip-elapsed")).toBeNull();

    waitOut(ELAPSED_AFTER_MS);
    expect(screen.getByTestId("activity-strip-elapsed")).toHaveTextContent("3s");
  });

  it("reads as a live region, so the wait is announced rather than just drawn", () => {
    show({ branch: running("Switching to main…") });
    waitOut();
    expect(screen.getByTestId("activity-strip")).toHaveAttribute("aria-live", "polite");
  });
});

describe("Cancel", () => {
  it.each([
    ["fetch", "Fetching origin…"],
    ["pull", "Pulling origin/main…"],
    ["push", "Pushing origin/main…"],
    ["lfs", "Fetching LFS objects…"],
    ["submodule", "Updating submodules…"],
    ["forge", "Checking out #42…"],
  ] as const)("is offered for %s", (key, label) => {
    show({ [key]: running(label) });
    waitOut();
    expect(screen.getByTestId("activity-strip-cancel")).toBeInTheDocument();
  });

  it.each([
    // Same gate as the status bar, for the same reason: a rebase replay runs
    // inside one blocking libgit2 call with nothing to signal, and the rest are
    // over before a click could land. A button that cannot honour itself is
    // worse than no button.
    ["rebase", "Rebasing 12 of 200: fix a thing"],
    ["stash", "Stashing changes…"],
    ["branch", "Switching to main…"],
  ] as const)("is NOT offered for %s", (key, label) => {
    show({ [key]: running(label) });
    waitOut();
    expect(screen.getByTestId("activity-strip-label")).toHaveTextContent(label);
    expect(screen.queryByTestId("activity-strip-cancel")).toBeNull();
  });

  it("cancels the repository's network ops when clicked", async () => {
    mockInvoke("cancel_network_op", () => 1);
    show({ fetch: running("Fetching origin…") });
    waitOut();

    fireEvent.click(screen.getByTestId("activity-strip-cancel"));
    await vi.waitFor(() =>
      expect(getInvokeCalls().filter((c) => c.cmd === "cancel_network_op")).toHaveLength(1),
    );
  });

  it("escalates on the second click, and says so first", () => {
    mockInvoke("cancel_network_op", () => 1);
    show({ fetch: running("Fetching origin…", { percent: 61 }) });
    waitOut();

    fireEvent.click(screen.getByTestId("activity-strip-cancel"));

    // Every part of #263's contract, because the strip is now a second place
    // the first click has to visibly change something: the label says what is
    // happening, the climbing percentage goes, and the button names the
    // escalation instead of repeating itself.
    expect(screen.getByTestId("activity-strip-label")).toHaveTextContent("Cancelling…");
    expect(screen.queryByTestId("activity-strip-percent")).toBeNull();
    expect(screen.getByTestId("activity-strip-cancel")).toHaveTextContent("Force stop");
  });
});

// `cancel.e2e.ts` waits on `activity-label` and CLICKS `activity-cancel`.
// WebdriverIO's `$` takes the first match in document order, and the strip
// renders above the status bar — so reusing those hooks would silently
// re-point a passing spec at a surface with a 400 ms delay in front of it.
describe("the status bar's hooks stay unambiguous", () => {
  it("carries its own test hooks rather than the status bar's", () => {
    show({ fetch: running("Fetching origin…") });
    waitOut();

    expect(screen.getByTestId("activity-strip-label")).toBeInTheDocument();
    expect(screen.getByTestId("activity-strip-cancel")).toBeInTheDocument();
    expect(screen.queryByTestId("activity-label")).toBeNull();
    expect(screen.queryByTestId("activity-cancel")).toBeNull();
  });
});
