// Tree ⇄ flat toggle for both change views (#61 A6).
//
// The contract that makes this cheap: both modes emit the SAME row keys, so
// selection, staging and context menus need no per-mode branches. These tests
// pin that — a folder row appears/disappears, but file rows keep working.

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";

import { RepoBrowserScreen } from "./RepoBrowser";
import { CommitPanelScreen } from "./CommitPanel";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useKeymapStore, useFocusStore } from "@/features/keymap";
import { mockInvoke } from "@/test/invokeMock";
import type { FileStatus } from "@/lib/types";

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
const modified = (p: string) => file(p, { worktree: { kind: "Modified" } });

const stageCalls: string[][] = [];

function baseStore(over: Record<string, unknown> = {}) {
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
    status: [modified("src/a.ts"), modified("src/b.ts"), modified("z.txt")],
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
    unstage: async () => {},
    ...over,
  } as never);
}

function wireMocks() {
  mockInvoke("list_all_files", () => []);
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

const rowFor = (path: string) =>
  document.querySelector(`[data-pg-row][data-path="${path}"]`);

const toFlat = () =>
  fireEvent.click(screen.getByTitle("Tree view — switch to flat list"));
const toTree = () =>
  fireEvent.click(screen.getByTitle("Flat list — switch to tree view"));

beforeEach(() => {
  stageCalls.length = 0;
  localStorage.clear();
  baseStore();
  wireMocks();
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

describe("RepoBrowser tree ⇄ flat (#61 A6)", () => {
  it("drops the folder rows in flat mode and keeps the same file rows", async () => {
    render(<RepoBrowserScreen />);
    await waitFor(() => expect(rowFor("src")).not.toBeNull());
    expect(rowFor("src/a.ts")).not.toBeNull();

    toFlat();

    // No nesting left…
    expect(rowFor("src")).toBeNull();
    // …but every file is still there, under its unchanged row key.
    expect(rowFor("src/a.ts")).not.toBeNull();
    expect(rowFor("src/b.ts")).not.toBeNull();
    expect(rowFor("z.txt")).not.toBeNull();
  });

  it("keeps staging working in flat mode", async () => {
    render(<RepoBrowserScreen />);
    await waitFor(() => expect(rowFor("src")).not.toBeNull());
    toFlat();

    const toggle = rowFor("src/a.ts")!.querySelector<HTMLInputElement>(
      '[data-testid="tree-row-toggle"] input',
    );
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle!);

    await waitFor(() => expect(stageCalls).toEqual([["src/a.ts"]]));
  });

  it("hides expand/collapse-all in flat mode — there is nothing to fold", async () => {
    render(<RepoBrowserScreen />);
    await waitFor(() => expect(rowFor("src")).not.toBeNull());
    expect(screen.queryByTitle("Expand all")).not.toBeNull();

    toFlat();
    expect(screen.queryByTitle("Expand all")).toBeNull();
    expect(screen.queryByTitle("Collapse all")).toBeNull();
  });

  it("remembers the choice", async () => {
    const view = render(<RepoBrowserScreen />);
    await waitFor(() => expect(rowFor("src")).not.toBeNull());
    toFlat();
    expect(localStorage.getItem("pg-repo-view-mode")).toBe("flat");

    // A fresh mount comes back flat.
    view.unmount();
    render(<RepoBrowserScreen />);
    await waitFor(() => expect(rowFor("src/a.ts")).not.toBeNull());
    expect(rowFor("src")).toBeNull();
  });
});

describe("CommitPanel tree ⇄ flat (#61 A6)", () => {
  it("groups changes under folders in tree mode", async () => {
    render(<CommitPanelScreen />);
    // Defaults to the flat list this screen has always shown.
    await waitFor(() => expect(rowFor("src/a.ts")).not.toBeNull());
    expect(rowFor("src")).toBeNull();

    toTree();

    expect(rowFor("src")).not.toBeNull();
    expect(rowFor("src/a.ts")).not.toBeNull();
    expect(localStorage.getItem("pg-commit-view-mode")).toBe("tree");
  });

  it("stages a whole folder from its checkbox in tree mode", async () => {
    render(<CommitPanelScreen />);
    await waitFor(() => expect(rowFor("src/a.ts")).not.toBeNull());
    toTree();

    const toggle = rowFor("src")!.querySelector<HTMLInputElement>(
      '[data-testid="tree-row-toggle"] input',
    );
    expect(toggle).not.toBeNull();
    // Unstaged section → unchecked, so clicking means "stage everything here".
    expect(toggle!.checked).toBe(false);
    fireEvent.click(toggle!);

    await waitFor(() => expect(stageCalls).toEqual([["src/a.ts", "src/b.ts"]]));
  });

  it("gives a folder row the batch context menu", async () => {
    render(<CommitPanelScreen />);
    await waitFor(() => expect(rowFor("src/a.ts")).not.toBeNull());
    toTree();

    fireEvent.contextMenu(rowFor("src")!);

    const menu = await waitFor(() => {
      const m = document.querySelector("[data-pg-menu]");
      if (!m) throw new Error("no context menu");
      return m as HTMLElement;
    });
    expect(within(menu).getByText("2 files selected")).toBeInTheDocument();
    expect(within(menu).getByText("Stage 2 files")).toBeInTheDocument();
  });

  it("stages a single file from a tree row, same as the flat row", async () => {
    render(<CommitPanelScreen />);
    await waitFor(() => expect(rowFor("src/a.ts")).not.toBeNull());
    toTree();

    const toggle = rowFor("src/a.ts")!.querySelector<HTMLInputElement>(
      '[data-testid="tree-row-toggle"] input',
    );
    fireEvent.click(toggle!);

    await waitFor(() => expect(stageCalls).toEqual([["src/a.ts"]]));
  });
});
