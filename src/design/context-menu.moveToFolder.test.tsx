// "Move to folder…" on a branch's context menu (#244).
//
// This is the KEYBOARD equivalent of dragging a branch onto a folder row, which
// the drag-and-drop rules require every drag to have. It routes through the same
// `resolveBranchMoveDrop` the drop does, so the two gestures can never disagree
// about what is legal — that shared path is the thing worth pinning here.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";

import { branchMenuItems, type ContextMenuItem } from "./context-menu";
import { useRepoStore } from "@/features/repo/useRepoStore";
import {
  WithDialogs,
  acceptDialog,
  dialogBody,
  dismissDialog,
  resetDialogs,
} from "@/test/dialog";
import type { BranchInfo } from "@/lib/types";

const LABEL = "Move to folder…";

const entry = (items: ContextMenuItem[]) =>
  items.find((i) => typeof i.label === "string" && i.label === LABEL);

const branch = (over: Partial<BranchInfo> & { name: string }): BranchInfo => ({
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

let renameBranch: ReturnType<typeof vi.fn>;

/** Open the entry's prompt, then answer it with `folder` (or dismiss). */
async function move(
  name: string,
  folder: string | null,
  opts: { current?: boolean } = {},
) {
  const item = entry(branchMenuItems({ name, current: opts.current, upstream: null }));
  let pending: unknown;
  act(() => {
    pending = item?.onClick?.();
  });
  await waitFor(() => expect(document.querySelector("[data-pg-dialog]")).toBeTruthy());
  if (folder === null) await dismissDialog();
  else await acceptDialog(folder);
  await act(async () => {
    await pending;
  });
}

beforeEach(() => {
  resetDialogs();
  renameBranch = vi.fn();
  useRepoStore.setState({
    current: { id: "repo-1", path: "/repo", head: "refs/heads/main" },
    branches: [
      branch({ name: "main", isDefault: true, isHead: true }),
      branch({ name: "bugfix" }),
      branch({ name: "feat/alpha" }),
      branch({ name: "feat/beta" }),
      branch({ name: "origin/feat/alpha", isRemote: true }),
      branch({ name: "origin/feat/beta", isRemote: true }),
    ],
    renameBranch,
  } as never);
  render(<WithDialogs>{null}</WithDialogs>);
});

describe("branchMenuItems move-to-folder entry", () => {
  it("renames the branch into the folder that was typed", async () => {
    await move("bugfix", "feat");
    expect(renameBranch).toHaveBeenCalledWith("bugfix", "feat/bugfix");
  });

  it("moves a branch to the top level on an empty answer", async () => {
    await move("feat/alpha", "");
    expect(renameBranch).toHaveBeenCalledWith("feat/alpha", "alpha");
  });

  // Dismissal is never an answer — it is not "move it to the top level".
  it("does nothing when the prompt is dismissed", async () => {
    await move("feat/alpha", null);
    expect(renameBranch).not.toHaveBeenCalled();
  });

  it("tolerates stray slashes around the folder", async () => {
    await move("bugfix", "/feat/");
    expect(renameBranch).toHaveBeenCalledWith("bugfix", "feat/bugfix");
  });

  it("does nothing when the branch already sits there", async () => {
    await move("feat/alpha", "feat");
    expect(renameBranch).not.toHaveBeenCalled();
  });

  // The same rejection the drop shows on its ghost, from the same resolver.
  it("refuses a destination name that is taken", async () => {
    await move("feat/beta", "");
    expect(renameBranch).toHaveBeenCalledWith("feat/beta", "beta");
    renameBranch.mockClear();

    useRepoStore.setState({
      branches: [
        ...useRepoStore.getState().branches,
        branch({ name: "beta" }),
      ],
    } as never);
    await move("feat/beta", "");
    expect(renameBranch).not.toHaveBeenCalled();
  });

  it("names the folders the repository already has, so the answer is guessable", async () => {
    const item = entry(branchMenuItems({ name: "bugfix", upstream: null }));
    let pending: unknown;
    act(() => {
      pending = item?.onClick?.();
    });
    await waitFor(() => expect(document.querySelector("[data-pg-dialog]")).toBeTruthy());
    // Local folders only: a remote-tracking ref is not somewhere a branch can
    // be moved to.
    expect(dialogBody()).toContain("feat");
    expect(dialogBody()).not.toContain("origin/feat");
    await dismissDialog();
    await act(async () => {
      await pending;
    });
  });

  it("offers the current branch the same move — a rename is a rename", async () => {
    await move("main", "release", { current: true });
    expect(renameBranch).toHaveBeenCalledWith("main", "release/main");
  });
});
