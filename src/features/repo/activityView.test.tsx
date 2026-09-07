// The anti-drift test for the two activity surfaces (#431).
//
// `ActivityStatus.tsx` has said since #296 that it is "the only place in the app
// that answers all four of the questions a waiting user has — what is running,
// how far along, how long it has been, and can I stop it — and those answers
// should not drift apart across surfaces." Adding the history strip made that
// sentence a promise about two components instead of a description of one.
//
// `useActivityView` is how the promise is kept: it decides WHICH op is named,
// what its label says, and whether Cancel is honourable. The two surfaces lay
// that out differently — a status-bar item versus a strip with a full-width bar
// — but they may not disagree about it. This renders both against the same
// store and asserts they say the same thing.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { ActivityStatus } from "./ActivityStatus";
import { ActivityStrip, SHOW_AFTER_MS } from "./ActivityStrip";
import { useRepoStore } from "./useRepoStore";
import { emptySlice } from "./repoSlice";
import type { ActivityKey, RepoActivity } from "./repoActivity";
import { mockInvoke, resetInvokeMock } from "@/test/invokeMock";

const NOW = 1_700_000_000_000;

/** One case per activity kind, so a kind added later cannot skip this test. */
const CASES: Record<ActivityKey, string> = {
  push: "Pushing origin/main…",
  pull: "Pulling origin/main…",
  fetch: "Fetching origin…",
  rebase: "Rebasing 12 of 200: fix a thing",
  stash: "Stashing changes…",
  branch: "Switching to feat/loading-ui…",
  forge: "Checking out #42…",
  difftool: "Opening kdiff3 on src/main.rs…",
  action: "Running Format all…",
  lfs: "Fetching LFS objects…",
  submodule: "Updating submodules…",
};

function prime(activity: RepoActivity) {
  useRepoStore.setState({
    ...emptySlice(),
    current: { id: "repo-1", path: "/tmp/repo-1", head: "main" },
    activity,
  });
}

/** Both surfaces, mounted over one store, past the strip's flicker floor. */
function renderBoth(activity: RepoActivity) {
  prime(activity);
  const view = render(
    <>
      <ActivityStrip />
      <ActivityStatus />
    </>,
  );
  act(() => {
    vi.advanceTimersByTime(SHOW_AFTER_MS + 1);
  });
  return view;
}

const text = (id: string) => screen.getByTestId(id).textContent ?? "";

beforeEach(() => {
  resetInvokeMock();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the two surfaces agree", () => {
  it.each(Object.entries(CASES) as [ActivityKey, string][])(
    "name the same operation for %s",
    (key, label) => {
      renderBoth({ [key]: { label, startedAt: NOW } });
      expect(text("activity-strip-label")).toBe(text("activity-label"));
      expect(text("activity-label")).toBe(label);
    },
  );

  it.each(Object.entries(CASES) as [ActivityKey, string][])(
    "agree on whether %s can be cancelled",
    (key, label) => {
      renderBoth({ [key]: { label, startedAt: NOW } });
      const inBar = screen.queryByTestId("activity-cancel") !== null;
      const inStrip = screen.queryByTestId("activity-strip-cancel") !== null;
      expect(inStrip).toBe(inBar);
    },
  );

  it("pick the same op out of several, and count the rest the same way", () => {
    renderBoth({
      // Priority order is the hook's, not each surface's: a background
      // submodule fetch must not outrank the push the user just started in one
      // place and lose in the other.
      submodule: { label: CASES.submodule, startedAt: NOW },
      push: { label: CASES.push, startedAt: NOW },
      lfs: { label: CASES.lfs, startedAt: NOW },
    });
    expect(text("activity-strip-label")).toBe(text("activity-label"));
    expect(text("activity-label")).toBe(CASES.push);
    expect(text("activity-strip-others")).toContain("+2 more");
    // One reading of the count per surface, and the same reading in both.
    expect(screen.getAllByText("+2 more")).toHaveLength(2);
  });

  it("both switch to the cancellation wording on one click", () => {
    mockInvoke("cancel_network_op", () => 1);
    renderBoth({ fetch: { label: CASES.fetch, startedAt: NOW, percent: 61 } });

    // Clicking EITHER surface must change BOTH, because the escalation to
    // SIGKILL is on the second click and the user may well click the other one.
    fireEvent.click(screen.getByTestId("activity-strip-cancel"));

    expect(text("activity-strip-label")).toBe("Cancelling…");
    expect(text("activity-label")).toBe("Cancelling…");
    expect(screen.queryByTestId("activity-strip-percent")).toBeNull();
    expect(screen.queryByTestId("activity-percent")).toBeNull();
  });

  it("both fall silent together when the operation ends", () => {
    const { container } = renderBoth({ fetch: { label: CASES.fetch, startedAt: NOW } });
    expect(screen.getByTestId("activity-strip-label")).toBeInTheDocument();

    act(() => {
      prime({});
    });
    expect(container).toBeEmptyDOMElement();
  });
});
