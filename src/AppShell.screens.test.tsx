// Opening a repo mounts a screen with empty state and re-renders it when the
// data lands. Both renders must run the same hooks: React aborts the entire
// root on a mismatch, and the window then shows nothing at all.
//
// Screen-level tests seed a fully populated store before rendering, so they
// only ever exercise the second render. This one starts empty on purpose.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";

import App from "./App";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useRecentsStore } from "@/features/repo/useRecentsStore";
import { mockInvoke } from "@/test/invokeMock";
import type { CommitInfo, FileDiff, FileStatus, RepoHandle } from "@/lib/types";

const handle: RepoHandle = {
  id: "repo-1",
  path: "/tmp/fake-repo",
  head: "refs/heads/main",
};

const COMMITS: CommitInfo[] = Array.from({ length: 3 }, (_, i) => ({
  oid: `${i}`.repeat(40),
  shortOid: `${i}`.repeat(7),
  summary: `commit ${i}`,
  body: i === 0 ? "a body\nover two lines" : null,
  author: "Dev",
  email: "dev@example.com",
  timestamp: 1_700_000_000 - i * 3600,
  parents: i < 2 ? [`${i + 1}`.repeat(40)] : [],
  refs: i === 0 ? ["refs/heads/main"] : [],
}));

const STATUS: FileStatus[] = [
  {
    path: "src/a.ts",
    worktree: { kind: "Modified" },
    index: { kind: "Unmodified" },
    additions: 1,
    deletions: 0,
    embedded: false,
  },
];

/** `get_diff` returns one file's diff, not a list. */
const FILE_DIFF: FileDiff = {
  path: "src/a.ts",
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

/** "All files" listings reuse FileStatus with everything unmodified. */
const ALL_FILES: FileStatus[] = ["src/a.ts", "src/b.ts"].map((path) => ({
  path,
  worktree: { kind: "Unmodified" },
  index: { kind: "Unmodified" },
  additions: 0,
  deletions: 0,
  embedded: false,
}));

function wireAll(): void {
  mockInvoke("get_status", () => STATUS);
  mockInvoke("list_all_files", () => ALL_FILES);
  mockInvoke("list_branches", () => []);
  mockInvoke("list_tags", () => []);
  mockInvoke("list_stashes", () => []);
  mockInvoke("list_remotes", () => []);
  mockInvoke("get_log_page", () => ({ commits: COMMITS, nextCursor: null }));
  mockInvoke("get_log", () => COMMITS);
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("rebase_status", () => ({
    inProgress: false,
    nextIndex: 0,
    total: 0,
    pauseReason: null,
  }));
  mockInvoke("get_reflog", () => []);
  mockInvoke("get_diff", () => FILE_DIFF);
  mockInvoke("diff_commit", () => []);
  mockInvoke("diff_commits", () => []);
  mockInvoke("conflict_sides", () => null);
  mockInvoke("take_launch_intent", () => null);
  mockInvoke("cli_shim_status", () => ({
    installed: false,
    shimPath: "",
    target: "",
    source: "none",
    pathState: "offPath",
  }));
  mockInvoke("open_repo", () => handle);
  mockInvoke("default_init_branch", () => "main");
}

/** Every screen reachable from the activity bar. Launch lands on History, so
 *  each of these is entered by clicking its activity-bar slot — the click
 *  happens while the store is still empty, which is the render pair under
 *  test. */
const SCREENS = [
  "repo",
  "commit",
  "history",
  "branches",
  "rebase",
  "remote",
  "diff",
  "reflog",
  "settings",
];

describe("restoring a screen while a repo's data is still loading", () => {
  beforeEach(() => {
    localStorage.clear();
    useRecentsStore.setState({ recents: [] });
    wireAll();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  for (const s of SCREENS) {
    it(`keeps the shell mounted on "${s}" when data arrives after mount`, async () => {
      // The store as it is the instant `openRepo` resolves: repo set, every
      // per-repo slice still empty.
      useRepoStore.setState({
        current: handle,
        status: [],
        allFiles: [],
        branches: [],
        tags: [],
        stashes: [],
        remotes: [],
        commits: [],
        loading: true,
        error: null,
        repoState: "Clean",
        rebaseStatus: {
          inProgress: false,
          nextIndex: 0,
          total: 0,
          pauseReason: null,
        },
        activity: {},
      } as never);

      const errors: string[] = [];
      vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
        errors.push(args.map(String).join(" "));
      });

      const { container } = render(<App />);

      // Switch to the screen under test while every slice is still empty, so
      // it mounts on empty state exactly as a restored session used to.
      if (s !== "history") {
        const slot = container.querySelector<HTMLElement>(`[data-activity="${s}"]`);
        expect(slot, `no activity-bar slot for "${s}"`).not.toBeNull();
        await act(async () => {
          fireEvent.click(slot!);
        });
      }

      // …and now the data lands, re-rendering the same screen.
      await act(async () => {
        useRepoStore.setState({
          commits: COMMITS,
          status: STATUS,
          allFiles: ALL_FILES,
          loading: false,
        } as never);
      });

      expect(
        errors.filter((e) => /Rendered more hooks|#310/.test(e)),
      ).toEqual([]);
      // A hook-order violation empties the root outright.
      expect(container.textContent?.trim()).not.toBe("");
    });
  }

  // Screen restore is gone: launch always lands on History. That also retires
  // the hazard this case was written for — an install upgrading across #108 has
  // "conflict" in localStorage, and restoring that id would render `undefined`.
  // The stale value is now simply never read, and never rewritten either.
  it("ignores a saved screen — including a retired id — and lands on History", async () => {
    localStorage.setItem("pg-screen", "conflict");
    useRepoStore.setState({
      current: handle,
      status: STATUS,
      allFiles: ALL_FILES,
      branches: [],
      tags: [],
      stashes: [],
      remotes: [],
      commits: COMMITS,
      loading: false,
      error: null,
      repoState: "Clean",
      rebaseStatus: {
        inProgress: false,
        nextIndex: 0,
        total: 0,
        pauseReason: null,
      },
      activity: {},
    } as never);

    const { container } = await act(async () => render(<App />));

    // History mounted (its commit rows are there), and the dead key was left
    // exactly as it was — nothing writes it any more.
    expect(container.querySelectorAll('[data-testid="commit-row"]').length).toBeGreaterThan(0);
    expect(localStorage.getItem("pg-screen")).toBe("conflict");
    expect(container.querySelector('input[placeholder="Find in tree…"]')).toBeNull();
  });
});
