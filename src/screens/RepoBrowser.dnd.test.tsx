// Drag to stage / unstage from the Files tree (#91).
//
// The Files screen has one tree and no staged/unstaged sections, so the targets
// are `StageDropBar` — two zones that exist only while a files drag is in flight.
// Both directions must work: the first cut routed them through
// `resolveStagingDrop`, whose same-side no-op rule silently killed the Unstage
// zone (it highlighted, read "Unstage", and did nothing). Hence the pair of
// direction tests below.
//
// jsdom has no PointerEvent; a MouseEvent typed as one keeps clientX/clientY.

import { describe, it, expect, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

import { RepoBrowserScreen } from "./RepoBrowser";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useDragStore } from "@/features/dnd";
import { mockInvoke } from "@/test/invokeMock";
import type { FileStatus, RepoHandle } from "@/lib/types";

const repo: RepoHandle = { id: "repo-1", path: "/tmp/fake-repo", head: "refs/heads/main" };

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
const staged = (p: string) => file(p, { index: { kind: "Modified" } });
/** Both sides dirty — one row that is itself "partial". */
const bothSides = (p: string) =>
  file(p, { worktree: { kind: "Modified" }, index: { kind: "Modified" } });
/** libgit2 reports an embedded repo as one entry with a trailing slash. */
const embedded = (p: string) =>
  file(p, { worktree: { kind: "Untracked" }, embedded: true });

const stageCalls: string[][] = [];
const unstageCalls: string[][] = [];

function setup(status: FileStatus[]) {
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
    stage: async (paths: string[]) => {
      stageCalls.push(paths);
    },
    unstage: async (paths: string[]) => {
      unstageCalls.push(paths);
    },
  } as never);
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
  mockInvoke("list_all_files", () => status);
  render(<RepoBrowserScreen />);
}

function pointer(type: string, x: number, y: number): MouseEvent {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
}

const treeRow = (path: string) =>
  document.querySelector(`[data-pg-row][data-path="${path}"]`) as HTMLElement;

/** Arm the drag so the bar mounts, then hover and release on `zoneTestId`. */
function dragToZone(from: HTMLElement, zoneTestId: string) {
  act(() => {
    from.dispatchEvent(pointer("pointerdown", 10, 10));
    // First move arms the drag; the bar only exists from here on.
    from.dispatchEvent(pointer("pointermove", 60, 90));
  });
  const zone = screen.getByTestId(zoneTestId);
  act(() => {
    zone.dispatchEvent(pointer("pointermove", 61, 91));
    zone.dispatchEvent(pointer("pointerup", 61, 91));
  });
}

describe("RepoBrowser drag staging (#91)", () => {
  beforeEach(() => {
    stageCalls.length = 0;
    unstageCalls.length = 0;
    useDragStore.setState({ payload: null, overId: null });
  });

  // The bar is drag-only: it must not take a strip of the tree pane when idle.
  it("shows no drop bar until a drag is in flight", async () => {
    setup([modified("src/a.txt")]);
    await waitFor(() => expect(treeRow("src/a.txt")).toBeTruthy());
    expect(screen.queryByTestId("stage-drop-bar")).toBeNull();

    act(() => {
      treeRow("src/a.txt").dispatchEvent(pointer("pointerdown", 10, 10));
      treeRow("src/a.txt").dispatchEvent(pointer("pointermove", 60, 90));
    });
    expect(screen.getByTestId("stage-drop-bar")).toBeTruthy();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(screen.queryByTestId("stage-drop-bar")).toBeNull();
    expect(stageCalls).toEqual([]);
  });

  it("stages a file dropped on the Stage zone", async () => {
    setup([modified("src/a.txt"), staged("src/b.txt")]);
    await waitFor(() => expect(treeRow("src/a.txt")).toBeTruthy());

    dragToZone(treeRow("src/a.txt"), "drop-stage");

    await waitFor(() => expect(stageCalls).toEqual([["src/a.txt"]]));
    expect(unstageCalls).toEqual([]);
  });

  // The regression case: routing this zone through resolveStagingDrop's
  // same-side guard made it a silent no-op.
  it("unstages a file dropped on the Unstage zone", async () => {
    setup([modified("src/a.txt"), staged("src/b.txt")]);
    await waitFor(() => expect(treeRow("src/b.txt")).toBeTruthy());

    dragToZone(treeRow("src/b.txt"), "drop-unstage");

    await waitFor(() => expect(unstageCalls).toEqual([["src/b.txt"]]));
    expect(stageCalls).toEqual([]);
  });

  // A folder row acts on everything beneath it, exactly as its tri-state
  // checkbox and its context menu do — all three go through `splitFileSelection`.
  it("stages every file beneath a dragged folder row", async () => {
    setup([modified("src/a.txt"), modified("src/nested/c.txt"), modified("top.txt")]);
    await waitFor(() => expect(treeRow("src")).toBeTruthy());

    dragToZone(treeRow("src"), "drop-stage");

    await waitFor(() => expect(stageCalls.length).toBe(1));
    expect(stageCalls[0].sort()).toEqual(["src/a.txt", "src/nested/c.txt"]);
  });

  // A partially-staged row (worktree AND index dirty) is the case that makes the
  // whole-file key space different from the commit panel's two-sided one: it has
  // no single side, so `splitFileSelection` puts it in BOTH buckets and BOTH
  // directions are live. This is exactly where reusing the commit panel's
  // same-side no-op rule would kill one zone, so both are asserted.
  it("stages AND unstages a partially-staged row, in either direction", async () => {
    setup([bothSides("src/both.txt")]);
    await waitFor(() => expect(treeRow("src/both.txt")).toBeTruthy());

    dragToZone(treeRow("src/both.txt"), "drop-stage");
    await waitFor(() => expect(stageCalls).toEqual([["src/both.txt"]]));

    dragToZone(treeRow("src/both.txt"), "drop-unstage");
    await waitFor(() => expect(unstageCalls).toEqual([["src/both.txt"]]));
  });

  // Only what is actionable in that direction may be sent: dropping a
  // staged-only file on Stage has nothing to stage.
  it("sends nothing when the drop direction has no actionable path", async () => {
    setup([staged("src/b.txt")]);
    await waitFor(() => expect(treeRow("src/b.txt")).toBeTruthy());

    dragToZone(treeRow("src/b.txt"), "drop-stage");

    expect(stageCalls).toEqual([]);
    expect(unstageCalls).toEqual([]);
  });

  // An embedded repo would be written to the index as a bare gitlink;
  // splitFileSelection excludes it, so no drag ever starts and no bar appears.
  it("never starts a drag from an embedded repository", async () => {
    setup([embedded("vendor/lib/")]);
    await waitFor(() => expect(treeRow("vendor")).toBeTruthy());

    act(() => {
      treeRow("vendor").dispatchEvent(pointer("pointerdown", 10, 10));
      treeRow("vendor").dispatchEvent(pointer("pointermove", 60, 90));
    });
    expect(screen.queryByTestId("stage-drop-bar")).toBeNull();
    expect(stageCalls).toEqual([]);
  });
});
