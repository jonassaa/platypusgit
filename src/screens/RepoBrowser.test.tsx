import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";

import { RepoBrowserScreen } from "./RepoBrowser";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";
import {
  WithDialogs,
  acceptDialog,
  dialogTitle,
  dismissDialog,
  resetDialogs,
} from "@/test/dialog";
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

/**
 * Deleting an untracked file is final — git holds no copy to restore from, so
 * unlike "restore this modified file from the index" there is no way back. The
 * menu says so, never fires on a single click, and goes to `deleteUntracked`
 * rather than `discard` (#245): discard would RESTORE the path if it had become
 * tracked since the right-click, which is the last thing an entry labelled
 * "Delete file…" may do.
 */
describe("RepoBrowser discarding untracked files", () => {
  const discardCalls: string[][] = [];
  const deleteCalls: string[][] = [];

  function untracked(path: string): FileStatus {
    return {
      path,
      worktree: { kind: "Untracked" },
      index: { kind: "Unmodified" },
      additions: 0,
      deletions: 0,
      embedded: false,
    };
  }

  beforeEach(() => {
    discardCalls.length = 0;
    deleteCalls.length = 0;
    resetDialogs();
    resetStore({
      status: [modified("a.txt"), untracked("loose.txt")],
      discard: async (paths: string[]) => {
        discardCalls.push(paths);
      },
      deleteUntracked: async (paths: string[]) => {
        deleteCalls.push(paths);
      },
    } as never);
    wireMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("offers Delete, not Discard changes, for an untracked file", async () => {
    render(<RepoBrowserScreen />);
    const row = await waitFor(() => treeRow("loose.txt"));

    fireEvent.contextMenu(row);

    const menu = await waitFor(contextMenu);
    expect(within(menu).getByText("Delete file…")).toBeInTheDocument();
    expect(within(menu).queryByText("Discard changes")).toBeNull();
  });

  it("confirms before deleting an untracked file", async () => {
    render(
      <WithDialogs>
        <RepoBrowserScreen />
      </WithDialogs>,
    );
    const row = await waitFor(() => treeRow("loose.txt"));

    fireEvent.contextMenu(row);
    fireEvent.click(within(await waitFor(contextMenu)).getByText("Delete file…"));

    await waitFor(() => expect(dialogTitle()).toBe("Delete loose.txt?"));
    expect(screen.getByTestId("dialog-title").parentElement?.textContent).toContain(
      "cannot be undone",
    );
    await dismissDialog();
    expect(deleteCalls).toEqual([]);

    fireEvent.contextMenu(treeRow("loose.txt"));
    fireEvent.click(within(await waitFor(contextMenu)).getByText("Delete file…"));
    await waitFor(() => expect(dialogTitle()).toBe("Delete loose.txt?"));
    await acceptDialog();

    await waitFor(() => expect(deleteCalls).toEqual([["loose.txt"]]));
    // Never the restoring op, whatever the row's state turned out to be.
    expect(discardCalls).toEqual([]);
  });

  it("keeps Discard changes for a tracked modification", async () => {
    render(<RepoBrowserScreen />);
    const row = await waitFor(() => treeRow("a.txt"));

    fireEvent.contextMenu(row);

    const menu = await waitFor(contextMenu);
    expect(within(menu).getByText("Discard changes")).toBeInTheDocument();
    expect(within(menu).queryByText("Delete file…")).toBeNull();
  });

  it("warns that untracked files are deleted permanently in a multi-file discard", async () => {
    render(
      <WithDialogs>
        <RepoBrowserScreen />
      </WithDialogs>,
    );
    await waitFor(() => treeRow("loose.txt"));

    fireEvent.click(treeRow("a.txt"));
    fireEvent.click(treeRow("loose.txt"), { ctrlKey: true });
    fireEvent.contextMenu(treeRow("loose.txt"));

    const menu = await waitFor(contextMenu);
    fireEvent.click(within(menu).getByText("Discard changes in 2 files…"));

    await waitFor(() =>
      expect(dialogTitle()).toBe("Discard changes in 2 files?"),
    );
    expect(screen.getByTestId("dialog-title").parentElement?.textContent).toContain(
      "1 file is untracked and will be deleted permanently.",
    );

    await dismissDialog();
    expect(discardCalls).toEqual([]);
  });
});

describe("RepoBrowser conflicted files", () => {
  function conflicted(path: string): FileStatus {
    return {
      path,
      worktree: { kind: "Conflicted" },
      index: { kind: "Conflicted" },
      additions: 0,
      deletions: 0,
      embedded: false,
    } as FileStatus;
  }

  beforeEach(() => {
    resetStore({ status: [conflicted("clash.txt")], repoState: "Merge" });
    wireMocks();
    resetDialogs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // With the Conflicts screen gone (#108) this row is where a conflicted file
  // is listed in the main window, so resolving it has to be reachable here.
  it("offers the resolution actions instead of Stage", async () => {
    render(
      <WithDialogs>
        <RepoBrowserScreen />
      </WithDialogs>,
    );
    const row = await waitFor(() => treeRow("clash.txt"));

    fireEvent.contextMenu(row);

    const menu = await waitFor(contextMenu);
    expect(within(menu).getByText("Open merge editor")).toBeInTheDocument();
    expect(within(menu).getByText("Accept ours")).toBeInTheDocument();
    expect(within(menu).getByText("Accept theirs")).toBeInTheDocument();
    expect(within(menu).queryByText("Stage")).toBeNull();
  });
});

/**
 * A DIRECTORY row (#245). The issue asked for reveal "on a file row, a directory
 * row, and the repository itself", and the folder row was the one that had no
 * file-manager entry at all: it goes to `multiFileMenuItems`, which is handed
 * the files BENEATH the folder and, until `directoryPath`, had no idea which
 * folder it was looking at.
 */
describe("RepoBrowser folder rows", () => {
  beforeEach(() => {
    resetStore({ status: [modified("src/nested/a.txt")] });
    wireMocks();
    mockInvoke("reveal_in_file_manager", () => null);
    mockInvoke("open_in_terminal", () => null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reveals the FOLDER itself, not the files inside it", async () => {
    render(<RepoBrowserScreen />);
    const row = await waitFor(() => treeRow("src/nested"));

    fireEvent.contextMenu(row);
    const menu = await waitFor(contextMenu);
    // The label is platform-dependent (`fileManagerLabel`); the entry is not.
    fireEvent.click(within(menu).getByText(/Finder|Explorer|file manager/));

    await waitFor(() => {
      const call = getInvokeCalls().find((c) => c.cmd === "reveal_in_file_manager");
      expect(call).toBeDefined();
      // The backend reads is-it-a-directory off the filesystem, so this opens a
      // window ON the folder rather than selecting it in its parent.
      expect(call!.args).toEqual({ repoId: "repo-1", relativePath: "src/nested" });
    });
  });

  it("opens a terminal in the folder", async () => {
    render(<RepoBrowserScreen />);
    const row = await waitFor(() => treeRow("src/nested"));

    fireEvent.contextMenu(row);
    fireEvent.click(within(await waitFor(contextMenu)).getByText("Open in terminal"));

    await waitFor(() => {
      const call = getInvokeCalls().find((c) => c.cmd === "open_in_terminal");
      expect(call).toBeDefined();
      expect(call!.args).toEqual({ repoId: "repo-1", relativePath: "src/nested" });
    });
  });
});
