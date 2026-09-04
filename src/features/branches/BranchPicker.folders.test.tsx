// Folders in the titlebar branch picker (#244).
//
// The grouping itself is tested in `branchTree.test.ts`; this covers what the
// popover adds on top of it — that a folder row is not checkout-able, where the
// resting cursor lands when HEAD is folded away (Enter acts on that row, so it
// is a correctness question), and that the folds are the SAME per-repository
// set the Branches screen writes.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BranchPicker } from "./BranchPicker";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useBranchPins } from "./useBranchPins";
import {
  BRANCH_FOLDERS_KEY,
  reloadCollapsedFolders,
} from "./useBranchFolders";
import { resetInvokeMock } from "@/test/invokeMock";
import type { BranchInfo } from "@/lib/types";

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

const BRANCHES = [
  branch({ name: "main", tipTime: 10, isDefault: true }),
  branch({ name: "feat/alpha", tipTime: 900, isHead: true }),
  branch({ name: "feat/beta", tipTime: 800 }),
  branch({ name: "chore/deps", tipTime: 700 }),
  branch({ name: "release/1.0/rc", tipTime: 600 }),
  branch({ name: "origin/feat/alpha", tipTime: 500, isRemote: true }),
  branch({ name: "origin/feat/beta", tipTime: 400, isRemote: true }),
];

let anchor: HTMLElement;
let checkoutBranch: ReturnType<typeof vi.fn>;

function setup(branches = BRANCHES) {
  checkoutBranch = vi.fn();
  useRepoStore.setState({
    current: { id: "repo-1", path: "/repo", head: "refs/heads/feat/alpha" },
    branches,
    checkoutBranch,
  } as never);
  return render(<BranchPicker anchor={anchor} open onClose={() => {}} />);
}

/** Every rendered row, in order: a folder as `path/`, a branch as its name. */
const rows = () =>
  Array.from(document.querySelectorAll("[data-picker-row]")).map((el) => {
    const folder = el.getAttribute("data-picker-folder");
    return folder === null ? el.getAttribute("data-branch-name") : `${folder}/`;
  });

const activeRow = () => {
  const el = document.querySelector('[data-picker-row][data-active="true"]');
  if (!el) return undefined;
  const folder = el.getAttribute("data-picker-folder");
  return folder === null ? el.getAttribute("data-branch-name") : `${folder}/`;
};

const folderRow = (path: string) =>
  document.querySelector(`[data-picker-folder="${path}"]`) as HTMLElement;

const press = (key: string) =>
  fireEvent.keyDown(screen.getByPlaceholderText("Switch to branch…"), { key });

/** Fold `paths` for `/repo` the way a previous session would have. */
const storeFolds = (...paths: string[]) => {
  localStorage.setItem(BRANCH_FOLDERS_KEY, JSON.stringify({ "/repo": paths }));
  reloadCollapsedFolders();
};

const storedFolds = () =>
  (JSON.parse(localStorage.getItem(BRANCH_FOLDERS_KEY) ?? "{}") as Record<
    string,
    string[]
  >)["/repo"] ?? [];

beforeEach(() => {
  resetInvokeMock();
  localStorage.clear();
  // The folds are a shared store, so a fold made by one case would otherwise
  // outlive it — clearing the key is not enough.
  reloadCollapsedFolders();
  useBranchPins.setState({ byRepo: {} });
  anchor = document.createElement("div");
  document.body.appendChild(anchor);
});

afterEach(() => {
  anchor.remove();
});

describe("BranchPicker folders", () => {
  it("groups each section on `/` and compresses lone chains", () => {
    setup();

    expect(rows()).toEqual([
      "main",
      "feat/",
      "feat/alpha",
      "feat/beta",
      // Neither groups anything, so both keep their full names and no folder.
      "chore/deps",
      "release/1.0/rc",
      // The remote section trees on its own — `origin` holds exactly one
      // segment's worth of children, so the chain compresses into one row.
      "origin/feat/",
      "origin/feat/alpha",
      "origin/feat/beta",
    ]);
  });

  it("hides the branches under a folder the repository has folded", () => {
    storeFolds("feat");
    setup();

    expect(rows()).toEqual([
      "main",
      "feat/",
      "chore/deps",
      "release/1.0/rc",
      "origin/feat/",
      "origin/feat/alpha",
      "origin/feat/beta",
    ]);
  });

  it("folds and unfolds on click, without checking anything out", () => {
    setup();

    fireEvent.click(folderRow("feat"));
    expect(rows()).not.toContain("feat/alpha");
    expect(checkoutBranch).not.toHaveBeenCalled();
    // Written where the Branches screen reads it — one repository, one set.
    expect(storedFolds()).toEqual(["feat"]);

    fireEvent.click(folderRow("feat"));
    expect(rows()).toContain("feat/alpha");
    expect(storedFolds()).toEqual([]);
  });

  it("checks out a branch row on click, as it always did", () => {
    setup();

    fireEvent.click(
      document.querySelector('[data-branch-name="feat/beta"]') as HTMLElement,
    );
    expect(checkoutBranch).toHaveBeenCalledWith("feat/beta");
  });

  it("rests on the current branch when its folder is open", () => {
    setup();
    expect(activeRow()).toBe("feat/alpha");
  });

  // Enter acts on the resting row. With HEAD folded away the only harmless
  // place to rest is the folder holding it — Enter there opens the folder.
  it("rests on the folder holding the current branch when it is folded away", () => {
    storeFolds("feat");
    setup();

    expect(activeRow()).toBe("feat/");
    press("Enter");
    expect(checkoutBranch).not.toHaveBeenCalled();
    expect(rows()).toContain("feat/alpha");
    expect(activeRow()).toBe("feat/");
  });

  it("expands with ArrowRight and folds with ArrowLeft", () => {
    storeFolds("feat");
    setup();

    expect(activeRow()).toBe("feat/");
    press("ArrowRight");
    expect(rows()).toContain("feat/alpha");
    press("ArrowLeft");
    expect(rows()).not.toContain("feat/alpha");
  });

  it("climbs out of a folder with ArrowLeft from a branch inside it", () => {
    setup();

    expect(activeRow()).toBe("feat/alpha");
    press("ArrowLeft");
    expect(activeRow()).toBe("feat/");
    // ...and again folds the folder it just climbed to.
    press("ArrowLeft");
    expect(rows()).not.toContain("feat/alpha");
  });

  it("walks folder rows with the arrow keys like any other row", () => {
    setup();

    press("ArrowUp");
    expect(activeRow()).toBe("feat/");
    press("ArrowUp");
    expect(activeRow()).toBe("main");
  });

  it("flattens to full names while a query is typed", () => {
    setup();

    fireEvent.change(screen.getByPlaceholderText("Switch to branch…"), {
      target: { value: "feat" },
    });

    // No folder row at all: a hit hidden behind a fold is the one thing a
    // search box must never do.
    expect(rows()).toEqual([
      "feat/alpha",
      "feat/beta",
      "origin/feat/alpha",
      "origin/feat/beta",
    ]);
    expect(activeRow()).toBe("feat/alpha");
  });

  it("keeps a pinned branch out of the tree so a fold cannot hide it", () => {
    useBranchPins.getState().toggle("/repo", "feat/beta");
    storeFolds("feat");
    // A third `feat/…` so the folder survives the hoist: with only `alpha`
    // left under it, the chain would rightly compress back into one row.
    setup([...BRANCHES, branch({ name: "feat/gamma", tipTime: 850 })]);

    // Hoisted to the top under its FULL name, and still on screen with `feat`
    // folded — which is the case pinning exists for.
    expect(rows()).toEqual([
      "feat/beta",
      "main",
      "feat/",
      "chore/deps",
      "release/1.0/rc",
      "origin/feat/",
      "origin/feat/alpha",
      "origin/feat/beta",
    ]);
  });
});
