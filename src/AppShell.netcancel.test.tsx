// The Stop button, and the auto-fetch timer that no longer stacks (#234).
//
// Two halves of the same issue: a stalled fetch/pull/push needs a visible way
// out, and the one op nobody is watching — the auto-fetch timer — needs both a
// guard against piling up and a deadline of its own.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import App from "./App";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useRecentsStore } from "@/features/repo/useRecentsStore";
import { useTabsStore } from "@/features/repo/useTabsStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { emptySlice } from "@/features/repo/repoSlice";
import { newTab } from "@/features/repo/tabs";
import { useFocusStore } from "@/features/keymap";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import type { RepoHandle } from "@/lib/types";

const API: RepoHandle = { id: "r-api", path: "/dev/api", head: "refs/heads/main" };

function calls(cmd: string) {
  return getInvokeCalls().filter((c) => c.cmd === cmd);
}

function wire() {
  for (const cmd of [
    "get_status",
    "list_all_files",
    "list_branches",
    "list_tags",
    "list_stashes",
    "list_remotes",
    "get_reflog",
  ]) {
    mockInvoke(cmd, () => []);
  }
  mockInvoke("open_repo", () => API);
  mockInvoke("close_repo", () => undefined);
  mockInvoke("get_log_page", () => ({ commits: [], nextCursor: null }));
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("rebase_status", () => ({
    inProgress: false,
    nextIndex: 0,
    total: 0,
    pauseReason: null,
  }));
  mockInvoke("take_launch_intent", () => null);
  mockInvoke("cli_shim_status", () => ({
    installed: false,
    shimPath: "",
    target: "",
    source: "none",
    pathState: "offPath",
  }));
  mockInvoke("get_diff", () => null);
  mockInvoke("check_for_update", () => null);
  mockInvoke("get_update_capability", () => ({ canSelfUpdate: false }));
  mockInvoke("cancel_operation", () => true);
  mockInvoke("fetch_all", () => undefined);
}

function seedOpenRepo(patch: Partial<ReturnType<typeof emptySlice>> = {}) {
  useRepoStore.setState({ ...emptySlice(), current: API, ...patch } as never);
  useTabsStore.setState({
    tabs: [newTab("/dev/api", { status: "open", repoId: "r-api" })],
    activePath: "/dev/api",
    activationSeq: 0,
    activating: null,
  });
}

beforeEach(() => {
  localStorage.clear();
  resetInvokeMock();
  useSettingsStore.getState().reset();
  useRecentsStore.setState({ recents: [] });
  useFocusStore.setState({
    focused: null,
    panes: new Map(),
    order: [],
    barId: null,
    primaryId: null,
    pendingContentFocus: false,
  });
  useTabsStore.setState({
    tabs: [],
    activePath: null,
    activationSeq: 0,
    activating: null,
  });
  useRepoStore.setState(emptySlice() as never);
  wire();
});

describe("the Stop button", () => {
  it("is absent while nothing cancellable is running", async () => {
    seedOpenRepo();
    render(<App />);

    // Waits for the shell rather than asserting on an empty document.
    await waitFor(() => expect(screen.getByText("Fetch")).toBeInTheDocument());
    expect(screen.queryByTestId("net-cancel")).toBeNull();
  });

  it("appears while a fetch is in flight and stops it by id", async () => {
    seedOpenRepo({
      activity: { fetch: "Fetching origin…" },
      netOps: { fetch: "fetch-7" },
    });
    render(<App />);

    const stop = await screen.findByTestId("net-cancel");
    fireEvent.click(stop);

    await waitFor(() => expect(calls("cancel_operation")).toHaveLength(1));
    expect(calls("cancel_operation")[0].args.opId).toBe("fetch-7");
  });

  it("names the op it will stop, so Stop is never ambiguous", async () => {
    seedOpenRepo({
      activity: { push: "Pushing origin/main…" },
      netOps: { push: "push-3" },
    });
    render(<App />);

    const stop = await screen.findByTestId("net-cancel");
    expect(stop.getAttribute("title")).toContain("push");
  });

  it("addresses the same op the status bar names, when two overlap", async () => {
    // Both fields use the push → pull → fetch precedence, so the label and the
    // button can never disagree about which op is "the" running one.
    seedOpenRepo({
      activity: { fetch: "Fetching origin…", push: "Pushing origin/main…" },
      netOps: { fetch: "fetch-1", push: "push-2" },
    });
    render(<App />);

    fireEvent.click(await screen.findByTestId("net-cancel"));

    await waitFor(() => expect(calls("cancel_operation")).toHaveLength(1));
    expect(calls("cancel_operation")[0].args.opId).toBe("push-2");
  });

  it("disappears once the op clears", async () => {
    seedOpenRepo({
      activity: { fetch: "Fetching origin…" },
      netOps: { fetch: "fetch-7" },
    });
    render(<App />);
    await screen.findByTestId("net-cancel");

    act(() => {
      useRepoStore.setState({ activity: {}, netOps: {} } as never);
    });

    await waitFor(() => expect(screen.queryByTestId("net-cancel")).toBeNull());
  });
});

describe("the auto-fetch timer", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not stack a second fetch on top of a stalled one", async () => {
    // The failure this prevents: a host that accepts the connection and stalls
    // used to collect another git process every interval, none of them visible.
    seedOpenRepo({ activity: { fetch: "Fetching origin…" } });
    useSettingsStore.setState({ autoFetchEnabled: true, autoFetchMinutes: 1 });
    render(<App />);
    await waitFor(() => expect(screen.getByText("Fetch")).toBeInTheDocument());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * 60_000);
    });

    expect(calls("fetch_all")).toHaveLength(0);
  });

  it("fires when no fetch is running", async () => {
    seedOpenRepo();
    useSettingsStore.setState({ autoFetchEnabled: true, autoFetchMinutes: 1 });
    render(<App />);
    await waitFor(() => expect(screen.getByText("Fetch")).toBeInTheDocument());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(calls("fetch_all").length).toBeGreaterThan(0);
  });

  it("cancels its own fetch when it is still running two minutes later", async () => {
    // ONLY the timer's fetches get a deadline: nobody is watching this one, so a
    // stall is indistinguishable from a hang. An interactive fetch is never
    // yanked away — the user is right there.
    seedOpenRepo();
    useSettingsStore.setState({ autoFetchEnabled: true, autoFetchMinutes: 1 });
    // Never resolves: exactly the stall the deadline exists for.
    mockInvoke("fetch_all", () => new Promise<void>(() => {}));
    render(<App />);
    await waitFor(() => expect(screen.getByText("Fetch")).toBeInTheDocument());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(calls("cancel_operation")).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });

    await waitFor(() => expect(calls("cancel_operation")).toHaveLength(1));
    expect(calls("cancel_operation")[0].args.opId).toMatch(/^fetch-/);
  });
});
