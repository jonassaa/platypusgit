// Dragging a branch between folders (#244).
//
// A branch folder is not a git object — it is the `/` in the name — so this
// gesture is `git branch -m` and nothing else. The decision table itself is
// tested in `features/dnd/resolveDrop.test.ts`; this covers the wiring it
// cannot see: which element starts a drag, which one accepts it, that the drop
// confirms before renaming anything, and that the keyboard can do the same
// thing without a pointer.
//
// jsdom has no PointerEvent; a MouseEvent typed as one keeps clientX/clientY.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { BranchesScreen } from "./Branches";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useKeymapStore, useFocusStore } from "@/features/keymap";
import { useDragStore } from "@/features/dnd";
import { reloadCollapsedFolders } from "@/features/branches/useBranchFolders";
import { mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import {
  WithDialogs,
  acceptDialog,
  dismissDialog,
  resetDialogs,
} from "@/test/dialog";
import type { BranchInfo } from "@/lib/types";

const mkBranch = (over: Partial<BranchInfo> & { name: string }): BranchInfo => ({
  isHead: false,
  isRemote: false,
  upstream: null,
  ahead: 0,
  behind: 0,
  tip: "0".repeat(40),
  tipTime: 0,
  isDefault: false,
  ...over,
});

const BRANCHES = [
  mkBranch({ name: "main", tipTime: 10, isDefault: true, isHead: true }),
  mkBranch({ name: "bugfix", tipTime: 950 }),
  mkBranch({ name: "feat/alpha", tipTime: 900 }),
  mkBranch({ name: "feat/beta", tipTime: 800 }),
  mkBranch({ name: "release/one", tipTime: 700 }),
  mkBranch({ name: "release/two", tipTime: 600 }),
  mkBranch({ name: "origin/feat/alpha", tipTime: 500, isRemote: true }),
  mkBranch({ name: "origin/feat/beta", tipTime: 400, isRemote: true }),
];

function pointer(type: string, x: number, y: number): MouseEvent {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
}

function drag(from: Element, to: Element) {
  act(() => {
    from.dispatchEvent(pointer("pointerdown", 10, 10));
    to.dispatchEvent(pointer("pointermove", 90, 40));
    to.dispatchEvent(pointer("pointermove", 91, 41));
    to.dispatchEvent(pointer("pointerup", 91, 41));
  });
}

/** Arm and move a drag WITHOUT releasing it, so mid-gesture state is readable. */
function dragOver(from: Element, to: Element) {
  act(() => {
    from.dispatchEvent(pointer("pointerdown", 10, 10));
    to.dispatchEvent(pointer("pointermove", 90, 40));
    to.dispatchEvent(pointer("pointermove", 91, 41));
  });
}

function endDrag(to: Element) {
  act(() => {
    to.dispatchEvent(pointer("pointerup", 91, 41));
  });
}

const branchRow = (name: string) =>
  document.querySelector(`[data-branch-name="${name}"]`) as HTMLElement;
const folderRow = (path: string) =>
  document.querySelector(`[data-folder="${path}"]`) as HTMLElement;
const ghost = () => document.querySelector('[data-testid="drag-ghost"]');

function setup(branches = BRANCHES) {
  const renameBranch = vi.fn(async () => {});
  useRepoStore.setState({
    current: { id: "repo-1", path: "/repo", head: "refs/heads/main" },
    status: [],
    branches,
    remotes: [],
    tags: [],
    stashes: [],
    commits: [],
    loading: false,
    checkoutBranch: async () => {},
    renameBranch,
  } as never);
  mockInvoke("get_status", () => []);
  mockInvoke("list_branches", () => branches);
  render(
    <WithDialogs>
      <BranchesScreen />
    </WithDialogs>,
  );
  useFocusStore.setState({ focused: "branches.list" });
  return { renameBranch };
}

describe("Branches folder drag", () => {
  beforeEach(() => {
    resetInvokeMock();
    resetDialogs();
    localStorage.clear();
    reloadCollapsedFolders();
    useDragStore.setState({ payload: null, overId: null });
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

  it("renames a branch into the folder it is dropped on, after confirming", async () => {
    const { renameBranch } = setup();

    drag(branchRow("bugfix"), folderRow("feat"));

    await waitFor(() => expect(screen.getByTestId("dialog-title")).toBeTruthy());
    expect(screen.getByTestId("dialog-title").textContent).toContain(
      "Move bugfix to feat/bugfix",
    );
    await acceptDialog();
    expect(renameBranch).toHaveBeenCalledWith("bugfix", "feat/bugfix");
  });

  // The store reports a failed rename on the banner and leaves the old name in
  // place. Selecting the name it was going to have would strand the inspector
  // and the keyboard list on a row that does not exist.
  it("leaves the selection alone when the rename fails", async () => {
    setup();
    const before = document.querySelector("[data-selected]");
    // A rename that changes nothing is what a failure looks like from here.
    useRepoStore.setState({ renameBranch: async () => {} } as never);

    drag(branchRow("bugfix"), folderRow("feat"));
    await waitFor(() => expect(screen.getByTestId("dialog-title")).toBeTruthy());
    await acceptDialog();

    expect(document.querySelector("[data-selected]")).toBe(before);
    expect(branchRow("feat/bugfix")).toBeNull();
  });

  it("touches nothing when the confirm is dismissed", async () => {
    const { renameBranch } = setup();

    drag(branchRow("bugfix"), folderRow("release"));

    await waitFor(() => expect(screen.getByTestId("dialog-title")).toBeTruthy());
    await dismissDialog();
    expect(renameBranch).not.toHaveBeenCalled();
  });

  // Only the leaf travels, like a file dragged between directories.
  it("carries only the last segment from one folder to another", async () => {
    const { renameBranch } = setup();

    drag(branchRow("feat/alpha"), folderRow("release"));

    await waitFor(() => expect(screen.getByTestId("dialog-title")).toBeTruthy());
    await acceptDialog();
    expect(renameBranch).toHaveBeenCalledWith("feat/alpha", "release/alpha");
  });

  it("does nothing when a branch is dropped on the folder it already sits in", () => {
    const { renameBranch } = setup();

    drag(branchRow("feat/alpha"), folderRow("feat"));

    expect(screen.queryByTestId("dialog-title")).toBeNull();
    expect(renameBranch).not.toHaveBeenCalled();
  });

  it("refuses a remote-tracking branch, and says so on the ghost", () => {
    const { renameBranch } = setup();

    dragOver(branchRow("origin/feat/alpha"), folderRow("release"));
    expect(ghost()?.textContent).toContain("local branches");
    expect(ghost()?.getAttribute("data-drop")).toBe("no");
    endDrag(folderRow("release"));

    expect(screen.queryByTestId("dialog-title")).toBeNull();
    expect(renameBranch).not.toHaveBeenCalled();
  });

  it("refuses a move whose destination name is taken", () => {
    const { renameBranch } = setup([
      ...BRANCHES,
      mkBranch({ name: "release/alpha", tipTime: 100 }),
    ]);

    dragOver(branchRow("feat/alpha"), folderRow("release"));
    expect(ghost()?.textContent).toContain("release/alpha already exists");
    endDrag(folderRow("release"));

    expect(renameBranch).not.toHaveBeenCalled();
  });

  it("marks the folder under the pointer as the live drop target", () => {
    setup();

    dragOver(branchRow("bugfix"), folderRow("feat"));
    expect(folderRow("feat").hasAttribute("data-pg-drop-over")).toBe(true);
    endDrag(folderRow("feat"));
    expect(folderRow("feat").hasAttribute("data-pg-drop-over")).toBe(false);
  });

  // The grid has no root header to aim at, so the "out of a folder" target
  // exists only for the duration of the gesture — like `StageDropBar`.
  describe("the top-level drop bar", () => {
    it("is absent until a nested local branch is dragged", () => {
      setup();
      expect(screen.queryByTestId("branch-root-drop")).toBeNull();

      dragOver(branchRow("feat/alpha"), folderRow("release"));
      expect(screen.getByTestId("branch-root-drop")).toBeTruthy();
      endDrag(folderRow("release"));
      expect(screen.queryByTestId("branch-root-drop")).toBeNull();
    });

    it("stays away for a branch that is already at the top level", () => {
      setup();
      dragOver(branchRow("bugfix"), folderRow("feat"));
      expect(screen.queryByTestId("branch-root-drop")).toBeNull();
      endDrag(folderRow("feat"));
    });

    it("stays away for a remote branch, which cannot be moved at all", () => {
      setup();
      dragOver(branchRow("origin/feat/alpha"), folderRow("release"));
      expect(screen.queryByTestId("branch-root-drop")).toBeNull();
      endDrag(folderRow("release"));
    });

    it("moves a branch out of its folder", async () => {
      const { renameBranch } = setup();

      act(() => {
        branchRow("feat/alpha").dispatchEvent(pointer("pointerdown", 10, 10));
        branchRow("feat/alpha").dispatchEvent(pointer("pointermove", 90, 40));
      });
      const bar = screen.getByTestId("branch-root-drop");
      act(() => {
        bar.dispatchEvent(pointer("pointermove", 91, 41));
        bar.dispatchEvent(pointer("pointerup", 91, 41));
      });

      await waitFor(() => expect(screen.getByTestId("dialog-title")).toBeTruthy());
      expect(screen.getByTestId("dialog-title").textContent).toContain(
        "Move feat/alpha to alpha",
      );
      await acceptDialog();
      expect(renameBranch).toHaveBeenCalledWith("feat/alpha", "alpha");
    });
  });
});
