// The History detail panel must stay usable for a commit with a very long
// message: the message scrolls in its own region, the action row stays
// pinned outside that region, and the diff keeps its own space rather than
// being pushed out of the fixed-height panel.

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { HistoryScreen } from "./History";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { useKeymapStore, useFocusStore } from "@/features/keymap";
import { mockInvoke } from "@/test/invokeMock";
import type { CommitInfo, FileDiff } from "@/lib/types";

const LONG_BODY = Array.from(
  { length: 120 },
  (_, i) => `body line ${i} — lorem ipsum dolor sit amet consectetur`,
).join("\n");

const commit: CommitInfo = {
  oid: "a".repeat(40),
  shortOid: "a".repeat(7),
  summary: "commit with a novel for a body",
  body: LONG_BODY,
  author: "Dev",
  email: "dev@example.com",
  timestamp: 1_700_000_000,
  parents: ["b".repeat(40)],
  refs: [],
};

const fileDiff: FileDiff = {
  path: "src/foo.ts",
  oldPath: null,
  binary: false,
  additions: 1,
  deletions: 0,
  hunks: [
    {
      header: "@@ -0,0 +1,1 @@",
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: 1,
      lines: [
        {
          kind: { kind: "Addition" },
          oldLineno: null,
          newLineno: 1,
          content: "added line\n",
        },
      ],
    },
  ],
};

const setLayout = (layout: "below" | "beside") =>
  localStorage.setItem("pg-history-diff-layout", layout);

describe("History detail panel with a long commit message", () => {
  beforeEach(() => {
    localStorage.clear();
    useRepoStore.setState({
      current: { id: "r1", path: "/repo", head: "main" },
      commits: [commit],
      searchResults: null,
      searching: false,
      searchCommits: async () => {},
      branches: [],
      status: [],
      loading: false,
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
    mockInvoke("diff_commit", () => [fileDiff]);
  });

  it("scrolls the message in the below layout and keeps the diff beside it", async () => {
    setLayout("below");
    render(<HistoryScreen />);

    const message = await screen.findByTestId("history-detail-message");
    // Own scroll region — a 120-line body scrolls here, it does not grow the panel.
    expect(getComputedStyle(message).overflow).toBe("auto");
    expect(message.textContent).toContain("body line 119");

    // Diff renders as a sibling of the message column, not stacked under it.
    await waitFor(() => {
      expect(screen.getByText(/@@ -0,0 \+1,1 @@/)).toBeInTheDocument();
    });
    const diffRow = document.querySelector('[data-path="src/foo.ts"]');
    expect(diffRow).not.toBeNull();
    expect(message.contains(diffRow)).toBe(false);

    // Actions sit outside the scrolling message, so they can't scroll away.
    const cherryPick = screen.getByTestId("commit-cherry-pick");
    expect(message.contains(cherryPick)).toBe(false);

    // Both live inside the detail panel.
    const detail = screen.getByTestId("history-detail");
    expect(detail.contains(message)).toBe(true);
    expect(detail.contains(diffRow)).toBe(true);
    expect(detail.contains(cherryPick)).toBe(true);
  });

  it("caps and scrolls the message in the beside layout", async () => {
    setLayout("beside");
    render(<HistoryScreen />);

    const message = await screen.findByTestId("history-detail-message");
    expect(getComputedStyle(message).overflow).toBe("auto");
    // Capped block wrapping the message + actions leaves room for the diff.
    const capped = message.parentElement as HTMLElement;
    expect(capped.style.maxHeight).toBe("50%");
    expect(capped.contains(screen.getByTestId("commit-cherry-pick"))).toBe(true);

    await waitFor(() => {
      expect(screen.getByText(/@@ -0,0 \+1,1 @@/)).toBeInTheDocument();
    });
    expect(message.contains(document.querySelector('[data-path="src/foo.ts"]'))).toBe(
      false,
    );
  });
});
