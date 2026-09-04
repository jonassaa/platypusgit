// Pinned branches on the Branches screen (#238).
//
// The comparator's pin tier is tested in `orderBranches.test.ts`; this covers
// the part it cannot see — that a pin is HOISTED OUT of the folder tree rather
// than merely sorted to the front of the folder it lives in, which is the whole
// point when that folder is collapsed.

import { describe, it, expect, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { BranchesScreen } from "./Branches";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useKeymapStore, useFocusStore } from "@/features/keymap";
import { mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { WithDialogs, resetDialogs } from "@/test/dialog";
import {
  BRANCH_FOLDERS_KEY,
  reloadCollapsedFolders,
} from "@/features/branches/useBranchFolders";
import { useBranchPins } from "@/features/branches/useBranchPins";
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

// `feat` and `rel` hold more than one branch each, so both are real folders.
// `chore/deps` is alone and therefore ONE row reading `chore/deps` — a prefix
// that groups nothing is not a folder (#244), which is exactly the compression
// a hoist has to respect when it empties a folder out.
const BRANCHES = [
  mkBranch({ name: "main", tipTime: 10, isDefault: true }),
  mkBranch({ name: "feat/alpha", tipTime: 900 }),
  mkBranch({ name: "feat/beta", tipTime: 800 }),
  mkBranch({ name: "feat/gamma", tipTime: 700 }),
  mkBranch({ name: "rel/x", tipTime: 600 }),
  mkBranch({ name: "rel/y", tipTime: 500 }),
  mkBranch({ name: "chore/deps", tipTime: 400, isHead: true }),
];

const branchNames = () =>
  Array.from(document.querySelectorAll('[data-testid="branch-row"]')).map(
    (el) => el.querySelector("[data-branch-label]")?.textContent ?? "",
  );

const folderPaths = () =>
  Array.from(
    document.querySelectorAll('[data-testid="branch-folder-row"]'),
  ).map((el) => el.getAttribute("data-folder") ?? "");

function setup(branches = BRANCHES) {
  useRepoStore.setState({
    current: { id: "repo-1", path: "/repo", head: "refs/heads/chore/deps" },
    status: [],
    branches,
    remotes: [],
    tags: [],
    stashes: [],
    commits: [],
    loading: false,
    checkoutBranch: async () => {},
  } as never);
  mockInvoke("get_status", () => []);
  mockInvoke("list_branches", () => branches);
  render(
    <WithDialogs>
      <BranchesScreen />
    </WithDialogs>,
  );
  useFocusStore.setState({ focused: "branches.list" });
}

beforeEach(() => {
  resetInvokeMock();
  resetDialogs();
  localStorage.clear();
  // The folds are a shared store (two surfaces render the tree), so clearing
  // the key is not enough to keep one case's folds out of the next.
  reloadCollapsedFolders();
  useBranchPins.setState({ byRepo: {} });
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

describe("pinned branches on the Branches screen", () => {
  it("hoists a pinned branch out of its folder, under its full name", () => {
    useBranchPins.setState({ byRepo: { "/repo": ["feat/beta"] } });
    setup();

    // First row, above the default branch and above every folder.
    expect(branchNames()[0]).toBe("feat/beta");
    // And gone from the tree — hoisted, not duplicated.
    expect(branchNames().filter((n) => n === "feat/beta")).toHaveLength(1);
  });

  it("keeps a pin visible while its folder is collapsed", () => {
    // The case pinning exists for: without the hoist the row would be the first
    // one INSIDE `feat`, and a collapsed `feat` would hide it entirely.
    localStorage.setItem(BRANCH_FOLDERS_KEY, JSON.stringify({ "/repo": ["feat"] }));
    reloadCollapsedFolders();
    useBranchPins.setState({ byRepo: { "/repo": ["feat/beta"] } });
    setup();

    expect(folderPaths()).toContain("feat");
    expect(branchNames()).toContain("feat/beta");
    expect(branchNames()).not.toContain("feat/alpha");
  });

  it("leaves the folder behind when it still holds other branches", () => {
    useBranchPins.setState({ byRepo: { "/repo": ["feat/beta"] } });
    setup();
    expect(folderPaths()).toContain("feat");
  });

  it("drops a folder the pins emptied out", () => {
    useBranchPins.setState({ byRepo: { "/repo": ["rel/x", "rel/y"] } });
    setup();
    // Hoisting every branch out of `rel` leaves no folder to draw — and no
    // empty one either.
    expect(folderPaths()).not.toContain("rel");
    expect(branchNames().slice(0, 2)).toEqual(["rel/x", "rel/y"]);
  });

  it("orders several pins among themselves by the ordinary rules", () => {
    useBranchPins.setState({ byRepo: { "/repo": ["feat/beta", "chore/deps"] } });
    setup();
    // feat/beta tipTime 800 > chore/deps 400 — newest first, as everywhere.
    expect(branchNames().slice(0, 2)).toEqual(["feat/beta", "chore/deps"]);
  });

  it("changes nothing when the repository has no pins", () => {
    setup();
    expect(branchNames()[0]).toBe("main");
    expect(folderPaths()).toEqual(["feat", "rel"]);
  });

  it("keeps another repository's pins out of this one", () => {
    useBranchPins.setState({ byRepo: { "/elsewhere": ["feat/beta"] } });
    setup();
    expect(branchNames()[0]).toBe("main");
  });
});

describe("the branch menu's pin verb", () => {
  const rowFor = (label: string) =>
    Array.from(
      document.querySelectorAll('[data-testid="branch-row"]'),
    ).find(
      (el) => el.querySelector("[data-branch-label]")?.textContent === label,
    ) as HTMLElement;

  it("pins from the context menu and persists it for this repository", async () => {
    setup();
    // Unpinned it lives inside the expanded `feat` folder, where the row is
    // labelled by its SEGMENT; only a hoisted row carries the full name.
    fireEvent.contextMenu(rowFor("beta"));
    await act(async () => {
      fireEvent.click(screen.getByText("Pin to top"));
    });

    expect(useBranchPins.getState().byRepo["/repo"]).toEqual(["feat/beta"]);
    expect(branchNames()[0]).toBe("feat/beta");
  });

  it("offers Unpin for a branch already pinned, and unpins it", async () => {
    useBranchPins.setState({ byRepo: { "/repo": ["feat/beta"] } });
    setup();
    fireEvent.contextMenu(rowFor("feat/beta"));
    await act(async () => {
      fireEvent.click(screen.getByText("Unpin"));
    });

    expect(useBranchPins.getState().byRepo["/repo"]).toBeUndefined();
    expect(branchNames()[0]).toBe("main");
  });
});
