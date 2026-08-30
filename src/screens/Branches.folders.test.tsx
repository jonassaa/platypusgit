// The Branches screen's folder tree (#244).
//
// The pure grouping lives in `features/branches/branchTree.ts` and is tested
// there; this covers the wiring the tree cannot see — what a click folds, what
// survives a filter, and that the keyboard list still walks every rendered row.

import { describe, it, expect, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { BranchesScreen } from "./Branches";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useKeymapStore, useFocusStore } from "@/features/keymap";
import { mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { WithDialogs, resetDialogs } from "@/test/dialog";
import { BRANCH_FOLDERS_KEY } from "@/features/branches/useBranchFolders";
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
  mkBranch({ name: "main", tipTime: 10, isDefault: true }),
  mkBranch({ name: "feat/alpha", tipTime: 900 }),
  mkBranch({ name: "feat/beta", tipTime: 800 }),
  mkBranch({ name: "release/1.0/rc", tipTime: 700 }),
  mkBranch({ name: "chore/deps", tipTime: 600, isHead: true }),
  mkBranch({ name: "chore/lint", tipTime: 500 }),
];

const key = (k: string) =>
  ({
    key: k,
    code: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault() {},
    target: document.body,
  }) as unknown as KeyboardEvent;

function press(k: string): void {
  act(() => {
    useKeymapStore.getState().dispatch(key(k));
  });
}

const branchNames = () =>
  Array.from(document.querySelectorAll('[data-testid="branch-row"]')).map(
    (el) => el.querySelector("[data-branch-label]")?.textContent ?? "",
  );

const folderPaths = () =>
  Array.from(
    document.querySelectorAll('[data-testid="branch-folder-row"]'),
  ).map((el) => el.getAttribute("data-folder") ?? "");

const folderRow = (path: string) =>
  document.querySelector(`[data-folder="${path}"]`) as HTMLElement;

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

describe("Branches folder tree", () => {
  beforeEach(() => {
    resetInvokeMock();
    resetDialogs();
    localStorage.clear();
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

  it("groups branches that share a prefix and leaves lone ones whole", () => {
    setup();

    expect(folderPaths()).toEqual(["feat", "chore"]);
    // `release/1.0/rc` groups nothing, so it keeps its full name and no folder.
    expect(branchNames()).toEqual([
      "main",
      "alpha",
      "beta",
      "release/1.0/rc",
      "deps",
      "lint",
    ]);
  });

  // Grouping runs AFTER `orderBranches`, so #135's pin still holds: the
  // default branch is the first row on the screen, not the first row inside
  // some folder.
  it("keeps the default branch pinned above every folder", () => {
    setup();

    const rows = Array.from(document.querySelectorAll("[data-pg-row]"));
    expect(rows[0].getAttribute("data-testid")).toBe("branch-row");
    expect(rows[0].querySelector("[data-branch-label]")?.textContent).toBe(
      "main",
    );
  });

  it("folds a folder away when its row is clicked, and back", () => {
    setup();

    fireEvent.click(folderRow("feat"));
    expect(branchNames()).not.toContain("alpha");
    expect(folderPaths()).toEqual(["feat", "chore"]);

    fireEvent.click(folderRow("feat"));
    expect(branchNames()).toContain("alpha");
  });

  it("remembers the fold across a remount, per repository", () => {
    setup();
    fireEvent.click(folderRow("feat"));

    expect(JSON.parse(localStorage.getItem(BRANCH_FOLDERS_KEY) ?? "{}")).toEqual(
      { "/repo": ["feat"] },
    );

    cleanupAndRemount();
    expect(branchNames()).not.toContain("alpha");
  });

  // A search box that hides a hit behind a folded folder is broken, so a filter
  // flattens the tree — and the rows then carry their full names, because a
  // bare `alpha` with no `feat` above it names nothing.
  it("flattens to full names while a filter is typed", () => {
    setup();
    fireEvent.click(folderRow("feat"));

    fireEvent.change(screen.getByPlaceholderText("Filter by name…"), {
      target: { value: "a" },
    });

    expect(folderPaths()).toEqual([]);
    expect(branchNames()).toContain("feat/alpha");
    expect(branchNames()).toContain("feat/beta");
  });

  it("restores the tree, folds and all, when the filter is cleared", () => {
    setup();
    fireEvent.click(folderRow("feat"));
    const input = screen.getByPlaceholderText("Filter by name…");

    fireEvent.change(input, { target: { value: "a" } });
    fireEvent.change(input, { target: { value: "" } });

    expect(folderPaths()).toEqual(["feat", "chore"]);
    expect(branchNames()).not.toContain("alpha");
  });

  it("walks folder rows with the rest of the list", () => {
    setup();

    press("ArrowDown"); // main
    press("ArrowDown"); // feat/ folder

    expect(folderRow("feat").getAttribute("data-selected")).toBe("");
  });

  it("collapses and expands the selected folder with ← and →", () => {
    setup();

    press("ArrowDown");
    press("ArrowDown");
    press("ArrowLeft");

    expect(branchNames()).not.toContain("alpha");

    press("ArrowRight");
    expect(branchNames()).toContain("alpha");
  });

  // Folding the folder the selection sits inside would otherwise leave the
  // keyboard list pointing at a row that is no longer rendered.
  it("moves the selection up to the folder it folded away", () => {
    setup();

    press("ArrowDown"); // main
    press("ArrowDown"); // feat/
    press("ArrowDown"); // alpha
    press("ArrowLeft"); // climb out to feat/
    press("ArrowLeft"); // fold it

    expect(branchNames()).not.toContain("alpha");
    expect(folderRow("feat").getAttribute("data-selected")).toBe("");
  });

  it("folds every folder at once from the toolbar, and unfolds them", () => {
    setup();

    fireEvent.click(screen.getByTitle(/Collapse all branch folders/));
    expect(branchNames()).toEqual(["main", "release/1.0/rc"]);

    fireEvent.click(screen.getByTitle(/Expand all branch folders/));
    expect(branchNames()).toContain("alpha");
  });

  it("offers no fold-all control in a repository with no folders", () => {
    setup([mkBranch({ name: "main", isDefault: true }), mkBranch({ name: "wip" })]);

    expect(screen.queryByTitle(/branch folders/)).toBeNull();
  });

  // Folding a folder must not hide where you are standing.
  it("marks a folded folder that holds the current branch", () => {
    setup();

    expect(folderRow("chore").querySelector("[data-holds-head]")).toBeNull();

    fireEvent.click(folderRow("chore"));

    expect(folderRow("chore").querySelector("[data-holds-head]")).not.toBeNull();
    expect(folderRow("feat").querySelector("[data-holds-head]")).toBeNull();
  });

  it("describes the selected folder in the inspector", () => {
    setup();

    fireEvent.click(folderRow("feat"));

    expect(screen.getByText("feat/")).toBeTruthy();
    expect(screen.getByText("Delete merged branches…")).toBeTruthy();
  });
});

/** Re-render the screen from scratch, as a tab switch or restart would. */
function cleanupAndRemount(): void {
  document.body.innerHTML = "";
  render(
    <WithDialogs>
      <BranchesScreen />
    </WithDialogs>,
  );
}
