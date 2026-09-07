// The history view says when it is waiting on something (#431).
//
// Before this, a checkout that took four seconds left the commit list sitting
// there showing the branch you had just left, and the only hint anything was
// happening was a small line at the very bottom edge of the window. These tests
// pin that the strip lands in the history view, above the rows it is warning
// you about, on BOTH of the screen's render paths — the populated list and the
// one that has no commits to show yet.
import { describe, expect, it, beforeEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { HistoryScreen } from "./History";
import { setActivity, useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { useKeymapStore, useFocusStore } from "@/features/keymap";
import type { CommitInfo } from "@/lib/types";

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

const COMMITS = [mk("a", [oid("b")]), mk("b", [oid("c")]), mk("c")];

function primeStore(over: Record<string, unknown> = {}) {
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
    commits: COMMITS,
    searchResults: null,
    searching: false,
    searchCommits: async () => {},
    branches: [
      {
        name: "main",
        isHead: true,
        isRemote: false,
        upstream: null,
        ahead: 0,
        behind: 0,
        tip: oid("a"),
      },
    ],
    status: [],
    loading: false,
    activity: {},
    ...over,
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
}

/** The strip has a flicker floor in front of it, so every wait is a real one. */
const strip = () =>
  waitFor(() => screen.getByTestId("activity-strip"), { timeout: 2000 });

beforeEach(() => {
  cleanup();
});

describe("a long operation on a populated log", () => {
  it("names what it is waiting on", async () => {
    primeStore({ activity: { branch: { label: "Switching to feat/x…", startedAt: Date.now() } } });
    render(<HistoryScreen />);

    expect(await strip()).toBeInTheDocument();
    expect(screen.getByTestId("activity-strip-label")).toHaveTextContent(
      "Switching to feat/x…",
    );
  });

  it("sits above the rows it is warning you about", async () => {
    // Below the list it would be off-screen on any repository with more than a
    // window's worth of history — which is the case this exists for.
    primeStore({ activity: { pull: { label: "Pulling origin/main…", startedAt: Date.now() } } });
    render(<HistoryScreen />);

    const el = await strip();
    const firstRow = screen.getAllByTestId("commit-row")[0];
    expect(
      el.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("says nothing while the repository is idle", async () => {
    primeStore();
    render(<HistoryScreen />);
    await waitFor(() => expect(screen.getAllByTestId("commit-row").length).toBe(3));

    // Long enough for the floor to have elapsed twice over, so this is
    // "deliberately silent", not "not yet shown".
    await new Promise((r) => setTimeout(r, 900));
    expect(screen.queryByTestId("activity-strip")).toBeNull();
  });

  it("appears when an operation starts after the screen is already up", async () => {
    primeStore();
    render(<HistoryScreen />);
    await waitFor(() => expect(screen.getAllByTestId("commit-row").length).toBe(3));

    setActivity("r1", "rebase", "Continuing rebase…");

    expect(await strip()).toBeInTheDocument();
    expect(screen.getByTestId("activity-strip-label")).toHaveTextContent(
      "Continuing rebase…",
    );
  });
});

describe("a long operation with no commits on screen", () => {
  it("still reports the wait beside the skeleton", async () => {
    // The path a checkout to an unborn branch lands on, and the one a cold
    // repository open sits in for as long as the first log read takes. The
    // early return in `History.tsx` renders its own toolbar, so a strip mounted
    // only in the populated branch would be invisible in exactly the slowest
    // case the app has.
    primeStore({
      commits: [],
      loading: true,
      activity: { branch: { label: "Switching to feat/x…", startedAt: Date.now() } },
    });
    render(<HistoryScreen />);

    expect(await strip()).toBeInTheDocument();
    expect(screen.getByLabelText("Loading commits")).toBeInTheDocument();
  });
});
