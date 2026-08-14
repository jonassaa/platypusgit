// Clicking an activity-bar entry moves DOM focus to that button. When it names
// the screen you are already on, the screen doesn't change — so a `[screen]`
// effect cannot fire, and focus stayed stranded on the bar with every list
// chord going nowhere (it broke Shift+ArrowDown multi-select in History).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";

import App from "./App";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useRecentsStore } from "@/features/repo/useRecentsStore";
import { useFocusStore } from "@/features/keymap";
import { mockInvoke } from "@/test/invokeMock";
import type { CommitInfo, RepoHandle } from "@/lib/types";

const handle: RepoHandle = { id: "r1", path: "/repo", head: "refs/heads/main" };

const COMMITS: CommitInfo[] = [0, 1, 2].map((i) => ({
  oid: `${i}`.repeat(40),
  shortOid: `${i}`.repeat(7),
  summary: `commit ${i}`,
  body: null,
  author: "Dev",
  email: "dev@example.com",
  timestamp: 1_700_000_000 - i,
  parents: i < 2 ? [`${i + 1}`.repeat(40)] : [],
  refs: [],
}));

function wire() {
  for (const cmd of [
    "get_status",
    "list_all_files",
    "list_branches",
    "list_tags",
    "list_stashes",
    "list_remotes",
    "get_reflog",
    "diff_commit",
    "diff_commits",
  ]) {
    mockInvoke(cmd, () => []);
  }
  mockInvoke("get_log_page", () => ({ commits: COMMITS, nextCursor: null }));
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("rebase_status", () => ({
    inProgress: false,
    nextIndex: 0,
    total: 0,
    pauseReason: null,
  }));
  mockInvoke("take_launch_intent", () => null);
  mockInvoke("cli_shim_status", () => ({ installed: false, path: null }));
  mockInvoke("get_diff", () => null);
}

const focused = () => useFocusStore.getState().focused;

describe("entering a screen from the activity bar", () => {
  beforeEach(() => {
    localStorage.clear();
    useRecentsStore.setState({ recents: [] });
    useFocusStore.setState({
      focused: null,
      panes: new Map(),
      order: [],
      barId: null,
      primaryId: null,
      pendingContentFocus: false,
    });
    wire();
    useRepoStore.setState({
      current: handle,
      status: [],
      allFiles: [],
      branches: [],
      tags: [],
      stashes: [],
      remotes: [],
      commits: COMMITS,
      loading: false,
      error: null,
      repoState: "Clean",
      rebaseStatus: { inProgress: false, nextIndex: 0, total: 0, pauseReason: null },
      activity: {},
    } as never);
  });

  it("lands on History's list at startup", async () => {
    render(<App />);
    await waitFor(() => expect(focused()).toBe("history.list"));
  });

  it("returns focus to the screen when its own bar entry is clicked again", async () => {
    const { container } = render(<App />);
    await waitFor(() => expect(focused()).toBe("history.list"));

    const historySlot = container.querySelector<HTMLElement>('[data-activity="history"]')!;
    // Clicking the bar focuses the bar — as any click on it should.
    await act(async () => {
      fireEvent.focus(historySlot);
      fireEvent.click(historySlot);
    });

    // …and entering the screen puts the keyboard back in the screen.
    await waitFor(() => expect(focused()).toBe("history.list"));
  });

  it("focuses the target screen's primary pane when switching screens", async () => {
    const { container } = render(<App />);
    await waitFor(() => expect(focused()).toBe("history.list"));

    const filesSlot = container.querySelector<HTMLElement>('[data-activity="repo"]')!;
    await act(async () => {
      fireEvent.focus(filesSlot);
      fireEvent.click(filesSlot);
    });

    await waitFor(() => expect(focused()).toBe("repo.tree"));
  });

  it("focuses a pane when a click inside it arrives without a mousedown", async () => {
    const { container } = render(<App />);
    await waitFor(() => expect(focused()).toBe("history.list"));
    useFocusStore.getState().focus("activitybar");
    expect(focused()).toBe("activitybar");

    const row = container.querySelector<HTMLElement>('[data-testid="commit-row"]')!;
    await act(async () => {
      fireEvent.click(row); // click only — no mousedown, as the e2e driver does
    });

    expect(focused()).toBe("history.list");
  });
});

afterEach(() => vi.restoreAllMocks());
