// Opening a repo mounts a screen with empty state and re-renders it when the
// data lands. Both renders must run the same hooks: React aborts the entire
// root on a mismatch, and the window then shows nothing at all.
//
// Screen-level tests seed a fully populated store before rendering, so they
// only ever exercise the second render. This one starts empty on purpose.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render } from "@testing-library/react";

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
  mockInvoke("cli_shim_status", () => ({ installed: false, path: null }));
  mockInvoke("open_repo", () => handle);
  mockInvoke("default_init_branch", () => "main");
}

/** Every screen reachable from the activity bar, i.e. every value `pg-screen`
 *  can legitimately hold when the app restores a session. */
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
      localStorage.setItem("pg-screen", s);
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

  // An install upgrading across #108 has "conflict" in localStorage and there
  // is no such screen any more — restoring it would render `undefined`.
  it("falls back to Files when the saved screen no longer exists", async () => {
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

    // Files is what mounted, and the key is rewritten so the dead value does
    // not survive the next launch either.
    expect(localStorage.getItem("pg-screen")).toBe("repo");
    expect(
      container.querySelector('input[placeholder="Find in tree…"]'),
    ).not.toBeNull();
  });
});
