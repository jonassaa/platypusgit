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

function file(path: string, over: Partial<FileStatus> = {}): FileStatus {
  return {
    path,
    worktree: { kind: "Unmodified" },
    index: { kind: "Unmodified" },
    additions: 0,
    deletions: 0,
    embedded: false,
    ...over,
  };
}

/** Unstaged change. */
const modified = (p: string) => file(p, { worktree: { kind: "Modified" } });
/** Staged-only change: index modified, worktree clean. */
const staged = (p: string) => file(p, { index: { kind: "Modified" } });
/** Both sides dirty — a single file that is itself "partial". */
const bothSides = (p: string) =>
  file(p, { worktree: { kind: "Modified" }, index: { kind: "Modified" } });
/** libgit2 reports an embedded repo as one entry with a trailing slash. */
const embedded = (p: string) =>
  file(p, { worktree: { kind: "Untracked" }, embedded: true });

const stageCalls: string[][] = [];
const unstageCalls: string[][] = [];

function resetStore(over: Record<string, unknown> = {}) {
  useRepoStore.setState({
    current: repo,
    status: [modified("src/a.txt"), staged("src/b.txt"), embedded("vendor/lib/")],
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
    stage: async (paths: string[]) => {
      stageCalls.push(paths);
    },
    unstage: async (paths: string[]) => {
      unstageCalls.push(paths);
    },
    ...over,
  } as never);
}

function wireMocks() {
  mockInvoke("list_all_files", () => [
    modified("src/a.txt"),
    staged("src/b.txt"),
    file("src/untouched.txt"),
  ]);
  mockInvoke("get_diff", (args) => ({
    path: args.path as string,
    oldPath: null,
    binary: false,
    additions: 0,
    deletions: 0,
    hunks: [],
  }));
  mockInvoke("read_file_content", (args) => ({
    path: args.path as string,
    text: "content",
    binary: false,
    fromHead: false,
  }));
}

function treeRow(path: string): HTMLElement {
  const row = document.querySelector(`[data-pg-row][data-path="${path}"]`);
  if (!row) throw new Error(`no tree row for ${path}`);
  return row as HTMLElement;
}

function toggleOf(path: string): HTMLInputElement | null {
  return treeRow(path).querySelector<HTMLInputElement>(
    '[data-testid="tree-row-toggle"] input',
  );
}

function contextMenu(): HTMLElement {
  const menu = document.querySelector("[data-pg-menu]");
  if (!menu) throw new Error("no context menu open");
  return menu as HTMLElement;
}

describe("RepoBrowser tree staging (#61 A5)", () => {
  beforeEach(() => {
    stageCalls.length = 0;
    unstageCalls.length = 0;
    resetStore();
    wireMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stages a file straight from its tree checkbox", async () => {
    render(<RepoBrowserScreen />);
    await waitFor(() => treeRow("src/a.txt"));

    const toggle = toggleOf("src/a.txt");
    expect(toggle).not.toBeNull();
    expect(toggle!.checked).toBe(false);
    fireEvent.click(toggle!);

    await waitFor(() => expect(stageCalls).toEqual([["src/a.txt"]]));
  });

  it("unstages a fully-staged file from its checkbox", async () => {
    render(<RepoBrowserScreen />);
    await waitFor(() => treeRow("src/b.txt"));

    const toggle = toggleOf("src/b.txt");
    expect(toggle!.checked).toBe(true);
    fireEvent.click(toggle!);

    await waitFor(() => expect(unstageCalls).toEqual([["src/b.txt"]]));
  });

  it("a partially-staged folder stages only its unstaged descendants", async () => {
    render(<RepoBrowserScreen />);
    const folder = await waitFor(() => treeRow("src"));

    // src holds one unstaged and one staged file → tri-state, so unchecked,
    // and clicking means "stage the rest".
    const toggle = folder.querySelector<HTMLInputElement>(
      '[data-testid="tree-row-toggle"] input',
    );
    expect(toggle).not.toBeNull();
    expect(toggle!.checked).toBe(false);
    fireEvent.click(toggle!);

    // Already-staged src/b.txt is not re-sent.
    await waitFor(() => expect(stageCalls).toEqual([["src/a.txt"]]));
  });

  it("a fully-staged folder reads as checked and unstages every descendant", async () => {
    resetStore({ status: [staged("src/a.txt"), staged("src/b.txt")] });
    render(<RepoBrowserScreen />);
    const folder = await waitFor(() => treeRow("src"));

    const toggle = folder.querySelector<HTMLInputElement>(
      '[data-testid="tree-row-toggle"] input',
    );
    expect(toggle!.checked).toBe(true);
    fireEvent.click(toggle!);

    await waitFor(() =>
      expect(unstageCalls).toEqual([["src/a.txt", "src/b.txt"]]),
    );
  });

  it("treats a file dirty on both sides as partial, not staged", async () => {
    resetStore({ status: [bothSides("src/a.txt")] });
    render(<RepoBrowserScreen />);
    await waitFor(() => treeRow("src/a.txt"));

    // Checked would claim the whole file is staged when half of it isn't.
    expect(toggleOf("src/a.txt")!.checked).toBe(false);
    fireEvent.click(toggleOf("src/a.txt")!);

    await waitFor(() => expect(stageCalls).toEqual([["src/a.txt"]]));
  });

  it("toggling a row's checkbox does not move the selection", async () => {
    render(<RepoBrowserScreen />);
    await waitFor(() => treeRow("src/a.txt"));

    fireEvent.click(treeRow("src/b.txt"));
    await waitFor(() =>
      expect(treeRow("src/b.txt").getAttribute("data-selected")).toBe("true"),
    );

    fireEvent.click(toggleOf("src/a.txt")!);

    expect(treeRow("src/b.txt").getAttribute("data-selected")).toBe("true");
    expect(treeRow("src/a.txt").getAttribute("data-selected")).toBeNull();
  });

  it("offers no checkbox for an embedded repo or an unmodified file", async () => {
    render(<RepoBrowserScreen />);
    await waitFor(() => treeRow("vendor/lib"));

    // Staging an embedded repo would write a bare gitlink — no affordance.
    expect(toggleOf("vendor/lib")).toBeNull();

    fireEvent.click(screen.getByText("All"));
    await waitFor(() => treeRow("src/untouched.txt"));
    expect(toggleOf("src/untouched.txt")).toBeNull();
    // …but the changed sibling in the same tree still has one.
    expect(toggleOf("src/a.txt")).not.toBeNull();
  });

  it("gives a folder the batch stage/discard menu instead of nothing", async () => {
    render(<RepoBrowserScreen />);
    const folder = await waitFor(() => treeRow("src"));

    fireEvent.contextMenu(folder);

    const menu = await waitFor(contextMenu);
    expect(within(menu).getByText("2 files selected")).toBeInTheDocument();
    expect(within(menu).getByText("Stage 1 file")).toBeInTheDocument();
    expect(within(menu).getByText("Unstage 1 file")).toBeInTheDocument();
  });
});
