// The History screen renders the selected commit's own diff inline (issue #53):
// selecting a commit fetches diff_commit and shows its changed files + hunks
// without leaving the screen.

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { HistoryScreen } from "./History";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { useKeymapStore, useFocusStore } from "@/features/keymap";
import { mockInvoke, getInvokeCalls } from "@/test/invokeMock";
import type { CommitInfo, FileDiff } from "@/lib/types";

const mkCommit = (oid: string, summary: string, parents: string[] = []): CommitInfo => ({
  oid,
  shortOid: oid.slice(0, 7),
  summary,
  body: null,
  author: "Dev",
  email: "dev@example.com",
  timestamp: 1_700_000_000,
  parents,
  refs: [],
});

const fileDiff = (path: string): FileDiff => ({
  path,
  oldPath: null,
  binary: false,
  additions: 2,
  deletions: 0,
  hunks: [
    {
      header: "@@ -0,0 +1,2 @@",
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: 2,
      lines: [
        { kind: { kind: "Addition" }, oldLineno: null, newLineno: 1, content: "added line\n" },
        { kind: { kind: "Addition" }, oldLineno: null, newLineno: 2, content: "more\n" },
      ],
    },
  ],
});

describe("History inline commit diff", () => {
  beforeEach(() => {
    useRepoStore.setState({
      current: { id: "r1", path: "/repo", head: "main" },
      commits: [
        mkCommit("a".repeat(40), "second commit", ["b".repeat(40)]),
        mkCommit("b".repeat(40), "first commit"),
      ],
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
  });

  it("fetches and renders the selected commit's changed files inline", async () => {
    mockInvoke("diff_commit", () => [fileDiff("src/foo.ts"), fileDiff("README.md")]);

    render(<HistoryScreen />);

    // The changed-file list + the first file's hunk appear inline (no screen
    // switch — the nav intent stays null).
    await waitFor(() => {
      expect(screen.getByText(/@@ -0,0 \+1,2 @@/)).toBeInTheDocument();
    });
    expect(screen.getByText("src/foo.ts")).toBeInTheDocument();
    expect(screen.getByText("README.md")).toBeInTheDocument();

    // Diff was fetched for the top (default-selected) commit.
    const call = getInvokeCalls().find((c) => c.cmd === "diff_commit");
    expect(call?.args.oid).toBe("a".repeat(40));
    // Selecting a commit does not navigate away.
    expect(useNavStore.getState().intent).toBeNull();
  });
});
