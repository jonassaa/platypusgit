// Regression: the Branches list must not activate a row nothing selected.
//
// `flatIndex` used to be `Math.max(0, findIndex(...))`, and `selection` starts
// null — so `usePaneList` was told row 0 was selected while NO row rendered as
// highlighted. `branches.list` is the screen's primary pane, so entering the
// screen focuses it; Enter then checked out row 0, which since #135 is the
// pinned default branch. Nothing on screen ever said it would.

import { describe, it, expect, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { BranchesScreen } from "./Branches";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useKeymapStore, useFocusStore } from "@/features/keymap";
import { mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { WithDialogs, resetDialogs } from "@/test/dialog";
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
  mkBranch({ name: "chore/x", tipTime: 900 }),
  mkBranch({ name: "main", tipTime: 100, isDefault: true }),
  mkBranch({ name: "feat/y", tipTime: 950, isHead: true }),
];

let checkouts: string[] = [];

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

/** Dispatch through the keymap store, flushing the resulting React updates. */
function press(k: string): void {
  act(() => {
    useKeymapStore.getState().dispatch(key(k));
  });
}

const branchRowNames = () =>
  Array.from(document.querySelectorAll('[data-testid="branch-row"]')).map(
    (el) => el.querySelector("span")?.textContent ?? "",
  );

function setup() {
  checkouts = [];
  useRepoStore.setState({
    current: { id: "repo-1", path: "/repo", head: "refs/heads/feat/y" },
    status: [],
    branches: BRANCHES,
    remotes: [],
    tags: [],
    stashes: [],
    commits: [],
    loading: false,
    checkoutBranch: async (name: string) => {
      checkouts.push(name);
    },
  } as never);
  mockInvoke("get_status", () => []);
  mockInvoke("list_branches", () => BRANCHES);
  render(
    <WithDialogs>
      <BranchesScreen />
    </WithDialogs>,
  );
  useFocusStore.setState({ focused: "branches.list" });
}

describe("Branches list activation", () => {
  beforeEach(() => {
    resetInvokeMock();
    resetDialogs();
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

  it("checks nothing out on Enter while no row is selected", () => {
    setup();

    // Row 0 IS the pinned default — the whole reason a phantom selection here
    // is dangerous rather than merely surprising.
    expect(branchRowNames()[0]).toBe("main");
    expect(document.querySelector("[data-selected]")).toBeNull();

    press("Enter");

    expect(checkouts).toEqual([]);
  });

  it("checks out once the user has actually selected a row", () => {
    setup();

    press("ArrowDown");
    expect(document.querySelector("[data-selected]")).not.toBeNull();

    press("Enter");

    expect(checkouts).toEqual(["main"]);
  });

  it("clicking a row still selects and Enter then activates it", () => {
    setup();

    fireEvent.click(screen.getByText("chore/x"));
    press("Enter");

    expect(checkouts).toEqual(["chore/x"]);
  });
});
