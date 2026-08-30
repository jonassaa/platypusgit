// The Rider-style loading indicator: a summary line that opens upward (#296
// gap 8).
//
// Two things carry most of the value and are easy to regress. The **delay** is
// what makes a status-bar indicator tolerable at all — a refresh runs on every
// tab switch and usually finishes in under 100 ms, so without it the corner of
// the screen strobes. And the **collapsed summary** is the whole feature for
// anyone who never clicks: it has to name one read and count the rest.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { LoadingStatus, SHOW_AFTER_MS } from "./LoadingStatus";
import { useRepoStore } from "./useRepoStore";
import { emptySlice } from "./repoSlice";
import type { LoadingTask } from "./loadingTasks";
import { resetInvokeMock } from "@/test/invokeMock";

const NOW = 1_700_000_000_000;

const task = (id: string, label: string, ageMs = 0): LoadingTask => ({
  id,
  label,
  startedAt: NOW - ageMs,
});

function show(tasks: LoadingTask[], loading = false) {
  useRepoStore.setState({
    ...emptySlice(),
    current: { id: "repo-1", path: "/tmp/repo-1", head: "main" },
    loadingTasks: tasks,
    loading,
  });
  return render(<LoadingStatus />);
}

/** Push past the flicker floor so the indicator is actually on screen. */
function settle() {
  act(() => {
    vi.advanceTimersByTime(SHOW_AFTER_MS + 50);
  });
}

beforeEach(() => {
  resetInvokeMock();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the flicker floor", () => {
  it("shows nothing at all when nothing is loading", () => {
    const { container } = show([]);
    settle();
    expect(container).toBeEmptyDOMElement();
  });

  it("stays hidden for a refresh that finishes quickly", () => {
    // The common case, many times a minute. If this ever renders, the status
    // bar flashes on every tab switch and every commit.
    show([task("status", "reading status")]);
    act(() => {
      vi.advanceTimersByTime(SHOW_AFTER_MS - 50);
    });
    expect(screen.queryByTestId("loading-status")).toBeNull();
  });

  it("appears once a refresh has been running long enough", () => {
    show([task("status", "reading status")]);
    settle();
    expect(screen.getByTestId("loading-summary")).toHaveTextContent(
      "Loading: reading status",
    );
  });
});

describe("the collapsed summary", () => {
  it("names the longest-running read and counts the rest", () => {
    show([
      task("remotes", "fetching remotes", 5000),
      task("status", "reading status", 200),
      task("tags", "listing tags", 100),
    ]);
    settle();
    expect(screen.getByTestId("loading-summary")).toHaveTextContent(
      "Loading: fetching remotes + 2 others",
    );
  });

  it("falls back to a bare label when the flag is up with no named reads", () => {
    // Opening a repository sets `loading` before there is a repository to
    // attribute reads to. Reporting nothing there would be a regression on the
    // old "syncing…".
    show([], true);
    settle();
    expect(screen.getByTestId("loading-summary")).toHaveTextContent("Loading…");
    // Nothing to expand into, so no affordance offering an empty box.
    expect(screen.queryByRole("group", { name: "Loading" })).toBeNull();
    fireEvent.click(screen.getByTestId("loading-summary"));
    expect(screen.queryByTestId("loading-panel")).toBeNull();
  });
});

describe("expanding", () => {
  const three = () => [
    task("remotes", "fetching remotes", 5000),
    task("status", "reading status", 1200),
    task("tags", "listing tags", 300),
  ];

  it("lists every read, longest-running first, with its own clock", () => {
    show(three());
    settle();
    fireEvent.click(screen.getByTestId("loading-summary"));

    const rows = screen.getAllByTestId("loading-task");
    expect(rows.map((r) => r.getAttribute("data-task-id"))).toEqual([
      "remotes",
      "status",
      "tags",
    ]);
    // The elapsed column is the point: it says which read is the slow one even
    // when the summary has already named it.
    expect(rows[0]).toHaveTextContent("fetching remotes");
    expect(rows[0]).toHaveTextContent("5s");
    expect(rows[2]).toHaveTextContent("0s");
  });

  it("opens from the keyboard", () => {
    // The status bar has no other tab stop, so without a real button this
    // panel would be mouse-only — the app's own rule for drag targets.
    show(three());
    settle();
    const trigger = screen.getByRole("button", { expanded: false });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(screen.getByTestId("loading-panel")).toBeInTheDocument();
    expect(screen.getByRole("button", { expanded: true })).toBeInTheDocument();
  });

  it("toggles shut on a second click", () => {
    show(three());
    settle();
    fireEvent.click(screen.getByTestId("loading-summary"));
    expect(screen.getByTestId("loading-panel")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("loading-summary"));
    expect(screen.queryByTestId("loading-panel")).toBeNull();
  });

  it("closes on Escape", () => {
    show(three());
    settle();
    fireEvent.click(screen.getByTestId("loading-summary"));
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(screen.queryByTestId("loading-panel")).toBeNull();
  });

  it("closes when the pointer goes down outside it", () => {
    show(three());
    settle();
    fireEvent.click(screen.getByTestId("loading-summary"));
    act(() => {
      fireEvent.mouseDown(document.body);
    });
    expect(screen.queryByTestId("loading-panel")).toBeNull();
  });

  it("does not come back already-open on the next slow refresh", () => {
    // The panel would otherwise reappear expanded over a completely different
    // set of reads than the one the user opened it for.
    const { rerender } = show(three());
    settle();
    fireEvent.click(screen.getByTestId("loading-summary"));
    expect(screen.getByTestId("loading-panel")).toBeInTheDocument();

    act(() => {
      useRepoStore.setState({ loadingTasks: [], loading: false });
    });
    rerender(<LoadingStatus />);
    expect(screen.queryByTestId("loading-status")).toBeNull();

    act(() => {
      useRepoStore.setState({ loadingTasks: three() });
    });
    settle();
    expect(screen.getByTestId("loading-summary")).toBeInTheDocument();
    expect(screen.queryByTestId("loading-panel")).toBeNull();
  });
});
