// "Delete file…" for untracked files, single and multi-select (#245).
//
// Three things are pinned here, and each has already been got wrong somewhere:
//
//  1. **It is `delete_untracked_files`, never `discard_paths`.** Discard restores
//     a tracked path from the index; an entry labelled "Delete file…" that
//     restored a file instead would be the worst surprise available on a
//     destructive action.
//  2. **`pgConfirm`, and the confirm decides.** A guard test bans
//     `window.confirm` outright; what this asserts is the FLOW — declining
//     dispatches nothing, and the body says the file is untracked and has no
//     copy in the index or in history (the #67 wording).
//  3. **Discard steps aside** when every unstaged path in a multi-selection is
//     untracked, because "discard changes" is then a lie about what happens.
//     A mixed selection keeps both entries.
//
// The backend rules (untracked-only, inside the worktree, no directories) are
// NOT frontend concerns and are tested in `src-tauri/tests/delete_untracked.rs`.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

import {
  fileMenuItems,
  multiFileMenuItems,
  type ContextMenuItem,
} from "./context-menu";
import { useRepoStore } from "@/features/repo/useRepoStore";
import {
  WithDialogs,
  acceptDialog,
  dialogBody,
  dialogTitle,
  dismissDialog,
  resetDialogs,
} from "@/test/dialog";
import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";

const labels = (items: ContextMenuItem[]) =>
  items.filter((i) => !i.divider && !i.__menuTitle).map((i) => String(i.label));

function labeled(items: ContextMenuItem[], match: RegExp): ContextMenuItem {
  const found = items.find((i) => typeof i.label === "string" && match.test(i.label));
  expect(found, `no menu item matching ${match}`).toBeTruthy();
  return found!;
}

const calls = (cmd: string) => getInvokeCalls().filter((c) => c.cmd === cmd);

/** Open the confirm, answer it, and let the dispatched op settle. */
async function clickAndAnswer(item: ContextMenuItem, accept: boolean) {
  void item.onClick?.();
  await waitFor(() => expect(dialogTitle()).not.toBeNull());
  if (accept) await acceptDialog();
  else await dismissDialog();
}

beforeEach(() => {
  resetDialogs();
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
    status: [],
    commits: [],
    branches: [],
    stashes: [],
    loading: false,
  } as never);
  mockInvoke("delete_untracked_files", () => []);
  mockInvoke("discard_paths", () => null);
  mockInvoke("get_status", () => []);
  mockInvoke("list_branches", () => []);
  mockInvoke("list_tags", () => []);
  mockInvoke("list_stashes", () => []);
  mockInvoke("list_remotes", () => []);
  mockInvoke("get_log_page", () => ({ commits: [], nextCursor: null }));
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("head_info", () => ({ branch: "main", oid: null, detached: false }));
  mockInvoke("rebase_status", () => ({
    inProgress: false,
    nextIndex: 0,
    total: 0,
    pauseReason: null,
  }));
});

afterEach(() => vi.restoreAllMocks());

describe("the single untracked file row", () => {
  it("offers Delete instead of Discard changes", () => {
    const l = labels(fileMenuItems({ path: "loose.txt", untracked: true }, "macos"));
    expect(l).toContain("Delete file…");
    expect(l).not.toContain("Discard changes");
  });

  it("dispatches delete_untracked_files, never discard_paths", async () => {
    render(
      <WithDialogs>
        <div />
      </WithDialogs>,
    );
    const items = fileMenuItems({ path: "src/loose.txt", untracked: true }, "macos");

    await clickAndAnswer(labeled(items, /^Delete file…$/), true);

    await waitFor(() => expect(calls("delete_untracked_files").length).toBe(1));
    expect(calls("delete_untracked_files")[0].args).toEqual({
      repoId: "r1",
      paths: ["src/loose.txt"],
    });
    expect(calls("discard_paths")).toEqual([]);
  });

  it("says the file is untracked and has no copy anywhere git can reach", async () => {
    render(
      <WithDialogs>
        <div />
      </WithDialogs>,
    );
    const items = fileMenuItems({ path: "loose.txt", untracked: true }, "macos");

    void labeled(items, /^Delete file…$/).onClick?.();

    await waitFor(() => expect(dialogTitle()).toBe("Delete loose.txt?"));
    // The #67 wording — the reason this confirm exists at all.
    expect(dialogBody()).toContain("untracked");
    expect(dialogBody()).toContain("no copy in the index or in history");
    await dismissDialog();
  });

  it("deletes nothing when the confirm is declined", async () => {
    render(
      <WithDialogs>
        <div />
      </WithDialogs>,
    );
    const items = fileMenuItems({ path: "loose.txt", untracked: true }, "macos");

    await clickAndAnswer(labeled(items, /^Delete file…$/), false);

    expect(calls("delete_untracked_files")).toEqual([]);
  });

  it("keeps Discard changes, and no Delete, for a tracked row", () => {
    const l = labels(fileMenuItems({ path: "a.txt" }, "macos"));
    expect(l).toContain("Discard changes");
    expect(l).not.toContain("Delete file…");
  });
});

describe("the multi-file selection menu", () => {
  it("replaces Discard with Delete when every unstaged path is untracked", () => {
    const l = labels(
      multiFileMenuItems({
        stagedPaths: [],
        unstagedPaths: ["a.tmp", "b.tmp", "c.tmp"],
        untrackedPaths: ["a.tmp", "b.tmp", "c.tmp"],
      }),
    );
    expect(l).toContain("Delete 3 files…");
    expect(l.filter((x) => x.startsWith("Discard"))).toEqual([]);
  });

  it("offers both when the selection is mixed, each acting on its own bucket", async () => {
    render(
      <WithDialogs>
        <div />
      </WithDialogs>,
    );
    const sel = {
      stagedPaths: [],
      unstagedPaths: ["tracked.txt", "loose.tmp"],
      untrackedPaths: ["loose.tmp"],
    };
    const l = labels(multiFileMenuItems(sel));
    // Discard still counts every unstaged path — it restores the tracked one and
    // deletes the untracked one, which is a different op from Delete.
    expect(l).toContain("Discard changes in 2 files…");
    expect(l).toContain("Delete 1 file…");

    await clickAndAnswer(labeled(multiFileMenuItems(sel), /^Delete 1 file…$/), true);

    await waitFor(() => expect(calls("delete_untracked_files").length).toBe(1));
    expect(calls("delete_untracked_files")[0].args).toEqual({
      repoId: "r1",
      paths: ["loose.tmp"],
    });
  });

  it("offers no Delete at all with nothing untracked selected", () => {
    const l = labels(
      multiFileMenuItems({
        stagedPaths: ["s.txt"],
        unstagedPaths: ["a.txt"],
      }),
    );
    expect(l).toContain("Discard changes in 1 file…");
    expect(l.filter((x) => x.startsWith("Delete"))).toEqual([]);
  });

  it("ignores untracked paths that are not in the selection", () => {
    // Same filtering `promptStashPaths` does: the caller's bucket can be wider
    // than what is actually selected, and a Delete counting phantom rows would
    // put the wrong number in a destructive confirm.
    const l = labels(
      multiFileMenuItems({
        stagedPaths: [],
        unstagedPaths: ["a.tmp"],
        untrackedPaths: ["a.tmp", "not-selected.tmp"],
      }),
    );
    expect(l).toContain("Delete 1 file…");
  });

  it("says the files are untracked, in the plural", async () => {
    render(
      <WithDialogs>
        <div />
      </WithDialogs>,
    );
    void labeled(
      multiFileMenuItems({
        stagedPaths: [],
        unstagedPaths: ["a.tmp", "b.tmp"],
        untrackedPaths: ["a.tmp", "b.tmp"],
      }),
      /^Delete 2 files…$/,
    ).onClick?.();

    await waitFor(() => expect(dialogTitle()).toBe("Delete 2 files?"));
    expect(dialogBody()).toContain("They are untracked");
    expect(dialogBody()).toContain("no copy in the index or in history");
    await dismissDialog();
    expect(calls("delete_untracked_files")).toEqual([]);
  });
});

describe("the folder row's file-manager entries", () => {
  const FOLDER = {
    stagedPaths: [],
    unstagedPaths: ["src/a.txt"],
    paths: ["src/a.txt"],
    directoryPath: "src",
  };

  it("reveals and opens a terminal on the FOLDER, not on the files beneath it", () => {
    mockInvoke("reveal_in_file_manager", () => null);
    mockInvoke("open_in_terminal", () => null);
    const items = multiFileMenuItems(FOLDER, "macos");

    labeled(items, /^Reveal in Finder$/).onClick?.();
    labeled(items, /^Open in terminal$/).onClick?.();

    expect(calls("reveal_in_file_manager")).toEqual([
      { cmd: "reveal_in_file_manager", args: { repoId: "r1", relativePath: "src" } },
    ]);
    expect(calls("open_in_terminal")).toEqual([
      { cmd: "open_in_terminal", args: { repoId: "r1", relativePath: "src" } },
    ]);
  });

  it("labels the reveal entry per platform, like the file row does", () => {
    expect(labeled(multiFileMenuItems(FOLDER, "windows"), /^Show in Explorer$/)).toBeTruthy();
    expect(
      labeled(multiFileMenuItems(FOLDER, "linux"), /^Show in file manager$/),
    ).toBeTruthy();
  });

  it("has exactly one file-manager entry — no 'Open containing folder' synonym", () => {
    // Same reasoning as the file row (see context-menu.copyPath.test.tsx):
    // revealing a directory opens a window on it, and the only variant that
    // differs is its PARENT, which is not what "reveal this folder" means.
    const l = labels(multiFileMenuItems(FOLDER, "linux"));
    expect(l.filter((x) => /folder|file manager|Finder|Explorer/i.test(x))).toEqual([
      "Show in file manager",
    ]);
  });

  it("offers neither for a multi-row selection, which has no single target", () => {
    const l = labels(
      multiFileMenuItems(
        { stagedPaths: [], unstagedPaths: ["a.txt", "b.txt"] },
        "macos",
      ),
    );
    expect(l).not.toContain("Reveal in Finder");
    expect(l).not.toContain("Open in terminal");
  });
});
