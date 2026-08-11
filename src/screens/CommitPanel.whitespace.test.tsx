// Whitespace-ignore toggle (#61 D2). The interesting part is not the flag
// reaching the backend — it's that hunk staging is DISABLED while it's on.
// libgit2's IGNORE_WHITESPACE rewrites whitespace-only changes into context
// lines, so the hunks on screen neither line up with the indices stage_hunk
// expects nor describe a patch that would apply (see the backend test
// src-tauri/tests/whitespace_diff.rs). That desync is what got the first
// attempt at this setting removed.

import { describe, it, expect, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CommitPanelScreen } from "./CommitPanel";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import type { FileStatus } from "@/lib/types";

const unstaged = (path: string): FileStatus => ({
  path,
  worktree: { kind: "Modified" },
  index: { kind: "Unmodified" },
  additions: 1,
  deletions: 1,
  embedded: false,
});

const diffWithOneHunk = (path: string) => ({
  path,
  oldPath: null,
  binary: false,
  additions: 1,
  deletions: 1,
  hunks: [
    {
      header: "@@ -1,2 +1,2 @@",
      oldStart: 1,
      oldLines: 2,
      newStart: 1,
      newLines: 2,
      lines: [
        { kind: { kind: "Deletion" }, oldLineno: 1, newLineno: null, content: "a\n" },
        { kind: { kind: "Addition" }, oldLineno: null, newLineno: 1, content: "b\n" },
      ],
    },
  ],
});

const lastDiffCall = () =>
  [...getInvokeCalls()].reverse().find((c) => c.cmd === "get_diff");

describe("CommitPanel whitespace-ignore (#61 D2)", () => {
  beforeEach(() => {
    resetInvokeMock();
    useSettingsStore.setState({ ignoreWhitespaceInDiff: false });
    useRepoStore.setState({
      current: { id: "repo-1", path: "/repo", head: "refs/heads/main" },
      status: [unstaged("a.ts")],
      branches: [],
      remotes: [],
      commits: [],
      loading: false,
    } as never);
    mockInvoke("get_diff", (args) => diffWithOneHunk(args.path as string));
    render(<CommitPanelScreen />);
  });

  it("sends ignoreWhitespace=false by default and allows hunk staging", async () => {
    await waitFor(() => expect(lastDiffCall()).toBeDefined());
    expect(lastDiffCall()!.args.ignoreWhitespace).toBe(false);
    expect(await screen.findByTestId("hunk-stage")).toBeEnabled();
  });

  it("re-fetches with the flag and disables hunk staging when toggled on", async () => {
    await waitFor(() => expect(lastDiffCall()).toBeDefined());

    fireEvent.click(screen.getByTitle("Ignore whitespace-only changes"));

    await waitFor(() =>
      expect(lastDiffCall()!.args.ignoreWhitespace).toBe(true),
    );

    const stage = await screen.findByTestId("hunk-stage");
    expect(stage).toBeDisabled();
    expect(stage.getAttribute("title")).toContain("not the ones git would apply");
  });

  it("re-enables hunk staging when toggled back off", async () => {
    await waitFor(() => expect(lastDiffCall()).toBeDefined());

    fireEvent.click(screen.getByTitle("Ignore whitespace-only changes"));
    await waitFor(async () =>
      expect(await screen.findByTestId("hunk-stage")).toBeDisabled(),
    );

    fireEvent.click(
      screen.getByTitle(
        "Ignoring whitespace — click to show whitespace-only changes (re-enables hunk staging)",
      ),
    );

    await waitFor(() =>
      expect(lastDiffCall()!.args.ignoreWhitespace).toBe(false),
    );
    expect(await screen.findByTestId("hunk-stage")).toBeEnabled();
  });
});
