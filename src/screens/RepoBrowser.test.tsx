import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";

import { RepoBrowserScreen } from "./RepoBrowser";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { mockInvoke } from "@/test/invokeMock";
import type { FileStatus, RepoHandle } from "@/lib/types";

const repo: RepoHandle = {
  id: "repo-1",
  path: "/tmp/fake-repo",
  head: "refs/heads/main",
};

function modified(path: string): FileStatus {
  return {
    path,
    worktree: { kind: "Modified" },
    index: { kind: "Unmodified" },
    additions: 0,
    deletions: 0,
    embedded: false,
  };
}

function unmodified(path: string): FileStatus {
  return {
    path,
    worktree: { kind: "Unmodified" },
    index: { kind: "Unmodified" },
    additions: 0,
    deletions: 0,
    embedded: false,
  };
}

/**
 * libgit2 reports an untracked directory that is itself a git repo as ONE
 * status entry with a TRAILING SLASH, because it won't recurse across the
 * nested `.git`. The file tree splits paths on "/", so the row key loses that
 * slash — which is how the slashless path used to reach stage() and write a
 * silent gitlink.
 */
function embeddedRepo(path: string): FileStatus {
  return {
    path,
    worktree: { kind: "Untracked" },
    index: { kind: "Unmodified" },
    additions: 0,
    deletions: 0,
    embedded: true,
  };
}

const status = [modified("a.txt")];
const allFiles = [modified("a.txt"), unmodified("u1.txt"), unmodified("u2.txt")];

function resetStore(over: Partial<Parameters<typeof useRepoStore.setState>[0]> = {}) {
  useRepoStore.setState({
    current: repo,
    status,
    allFiles: [],
    branches: [],
    tags: [],
    stashes: [],
    remotes: [],
    commits: [],
    loading: false,
    error: null,
    repoState: "Clean",
    rebaseStatus: { inProgress: false, nextIndex: 0, total: 0, pauseReason: null },
    activity: {},
    ...over,
  });
}

function wireMocks() {
  mockInvoke("list_all_files", () => allFiles);
  mockInvoke("get_diff", (args) => ({
    path: args.path,
    oldPath: null,
    binary: false,
    additions: 0,
    deletions: 0,
    hunks: [],
  }));
  mockInvoke("read_file_content", (args) => ({
    path: args.path,
    text: "content",
    binary: false,
    fromHead: false,
  }));
}

/** The open context menu, so assertions don't collide with the preview pane. */
function contextMenu(): HTMLElement {
  const menu = document.querySelector("[data-pg-menu]");
  if (!menu) throw new Error("no context menu open");
  return menu as HTMLElement;
}

function treeRow(path: string): HTMLElement {
  const row = document.querySelector(`[data-pg-row][data-path="${path}"]`);
  if (!row) throw new Error(`no tree row for ${path}`);
  return row as HTMLElement;
}

describe("RepoBrowser multi-file selection (all-files mode)", () => {
  beforeEach(() => {
    resetStore();
    wireMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("multi-select of unmodified files shows the real count, not 0", async () => {
    render(<RepoBrowserScreen />);

    fireEvent.click(screen.getByText("All"));
    await waitFor(() => treeRow("u1.txt"));

    fireEvent.click(treeRow("u1.txt"));
    fireEvent.click(treeRow("u2.txt"), { ctrlKey: true });
    fireEvent.contextMenu(treeRow("u2.txt"));

    expect(await screen.findByText("2 files selected")).toBeInTheDocument();
    expect(screen.queryByText("0 files selected")).toBeNull();
  });

  it("mixed selection keeps stage actions for the changed subset and counts every file", async () => {
    render(<RepoBrowserScreen />);

    fireEvent.click(screen.getByText("All"));
    await waitFor(() => treeRow("u1.txt"));

    fireEvent.click(treeRow("a.txt"));
    fireEvent.click(treeRow("u1.txt"), { ctrlKey: true });
    fireEvent.contextMenu(treeRow("u1.txt"));

    expect(await screen.findByText("2 files selected")).toBeInTheDocument();
    expect(screen.getByText("Stage 1 file")).toBeInTheDocument();
  });
});

describe("RepoBrowser embedded git repositories", () => {
  const stageCalls: string[][] = [];

  beforeEach(() => {
    stageCalls.length = 0;
    resetStore({
      status: [modified("a.txt"), embeddedRepo("vendor/lib/")],
      stage: async (paths: string[]) => {
        stageCalls.push(paths);
      },
    } as never);
    wireMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves the trailing-slash entry from the slashless tree key", async () => {
    render(<RepoBrowserScreen />);

    // The tree row exists under the slashless path...
    const row = await waitFor(() => treeRow("vendor/lib"));
    fireEvent.click(row);

    // ...and still resolves to its FileStatus, so the preview knows what it is
    // instead of asking for a diff that comes back empty.
    expect(await screen.findByText("Embedded git repository")).toBeInTheDocument();
    expect(screen.getByTestId("embedded-repo-panel")).toBeInTheDocument();
  });

  it("offers .gitignore instead of Stage in the row's context menu", async () => {
    render(<RepoBrowserScreen />);
    const row = await waitFor(() => treeRow("vendor/lib"));

    fireEvent.contextMenu(row);

    const menu = await waitFor(contextMenu);
    expect(within(menu).getByText("Add to .gitignore")).toBeInTheDocument();
    expect(within(menu).queryByText("Stage")).toBeNull();
    expect(within(menu).queryByText("Discard changes")).toBeNull();
  });

  it("keeps the embedded repo out of a multi-selection's Stage action", async () => {
    render(<RepoBrowserScreen />);
    await waitFor(() => treeRow("vendor/lib"));

    fireEvent.click(treeRow("a.txt"));
    fireEvent.click(treeRow("vendor/lib"), { ctrlKey: true });
    fireEvent.contextMenu(treeRow("vendor/lib"));

    // Both rows count, but only the real file is stageable — this used to hard
    // error the whole batch instead.
    const menu = await waitFor(contextMenu);
    expect(within(menu).getByText("2 files selected")).toBeInTheDocument();
    expect(
      within(menu).getByText("Add 1 embedded repo to .gitignore"),
    ).toBeInTheDocument();

    fireEvent.click(within(menu).getByText("Stage 1 file"));
    await waitFor(() => expect(stageCalls).toEqual([["a.txt"]]));
  });

  it("keeps the trailing slash when ignoring, so .gitignore gets directory syntax", async () => {
    const ignored: string[] = [];
    resetStore({
      status: [embeddedRepo("vendor/lib/")],
      appendGitignore: async (p: string) => {
        ignored.push(p);
      },
    } as never);
    render(<RepoBrowserScreen />);
    const row = await waitFor(() => treeRow("vendor/lib"));

    fireEvent.contextMenu(row);
    const menu = await waitFor(contextMenu);
    fireEvent.click(within(menu).getByText("Add to .gitignore"));

    await waitFor(() => expect(ignored).toEqual(["vendor/lib/"]));
  });
});
