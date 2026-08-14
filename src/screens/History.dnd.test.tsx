// Graph drag (#91): drag a ref pill or a commit row onto a ref pill or a commit
// row. Every legal drop has the CURRENT branch at one end — that asymmetry is the
// safety model — and every one of them confirms before touching the repository.
//
// jsdom has no PointerEvent; a MouseEvent typed as one keeps clientX/clientY.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { HistoryScreen } from "./History";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { useKeymapStore, useFocusStore } from "@/features/keymap";
import { useDragStore } from "@/features/dnd";
import { WithDialogs, acceptDialog, dismissDialog, resetDialogs } from "@/test/dialog";
import { mockInvoke } from "@/test/invokeMock";
import type { BranchInfo, CommitInfo, RepoState } from "@/lib/types";

const HEAD_OID = "a".repeat(40);
const FEATURE_OID = "b".repeat(40);
const OLD_OID = "c".repeat(40);

function makeCommit(oid: string, summary: string, parents: string[], refs: string[]): CommitInfo {
  return {
    oid,
    shortOid: oid.slice(0, 7),
    summary,
    body: null,
    author: "Dev",
    email: "dev@example.com",
    timestamp: 1_700_000_000,
    parents,
    refs,
  };
}

// main (HEAD) and feature both sit on top of one shared root.
const commits = [
  makeCommit(HEAD_OID, "feat: on main", [OLD_OID], ["main"]),
  makeCommit(FEATURE_OID, "feat: on feature", [OLD_OID], ["feature"]),
  makeCommit(OLD_OID, "chore: root", [], []),
];

const branch = (name: string, isHead: boolean, tip: string): BranchInfo => ({
  name,
  isHead,
  isRemote: false,
  upstream: null,
  ahead: 0,
  behind: 0,
  tip,
});

function setup(opts: { repoState?: RepoState } = {}) {
  localStorage.clear();
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "refs/heads/main" },
    commits,
    searchResults: null,
    searching: false,
    searchCommits: async () => {},
    branches: [branch("main", true, HEAD_OID), branch("feature", false, FEATURE_OID)],
    status: [],
    loading: false,
    repoState: opts.repoState ?? "Clean",
  } as never);
  useNavStore.setState({ intent: null });
  useKeymapStore.setState({ handlers: new Map(), lastShiftAt: 0 });
  useKeymapStore.getState().setPreset("rider");
  useFocusStore.setState({
    focused: null,
    panes: new Map(),
    order: [],
    barId: null,
    pendingContentFocus: false,
  });
  useDragStore.setState({ payload: null, overId: null });
  mockInvoke("diff_commit", () => []);
  render(
    <WithDialogs>
      <HistoryScreen />
    </WithDialogs>,
  );
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

function drag(from: Element, to: Element) {
  act(() => {
    from.dispatchEvent(pointer("pointerdown", 10, 10));
    to.dispatchEvent(pointer("pointermove", 90, 40));
    to.dispatchEvent(pointer("pointermove", 91, 41));
    to.dispatchEvent(pointer("pointerup", 91, 41));
  });
}

/** The ref pill for `ref` — the display name is lossy, `data-pg-ref` is not. */
const pill = (ref: string) => document.querySelector(`[data-pg-ref="${ref}"]`)!;
const commitRow = (oid: string) =>
  document.querySelector(`[data-sha="${oid.slice(0, 7)}"]`)!;

describe("History graph drag", () => {
  beforeEach(() => {
    resetDialogs();
  });

  it("publishes the git ref name on the pill, not the display name", async () => {
    setup();
    await waitFor(() => expect(pill("main")).toBeTruthy());
    // The pill READS "HEAD→main" — the drag must not have to parse that back.
    expect(pill("main").textContent).toContain("HEAD→main");
    expect(pill("feature")).toBeTruthy();
  });

  // Dragging your own branch elsewhere = "move me over there" = rebase.
  it("rebases the current branch when its pill is dropped on another ref", async () => {
    setup();
    const rebaseOnto = vi.fn();
    useRepoStore.setState({ rebaseOnto } as never);
    await waitFor(() => expect(pill("feature")).toBeTruthy());

    drag(pill("main"), pill("feature"));

    await waitFor(() => expect(screen.getByTestId("dialog-title")).toBeTruthy());
    expect(screen.getByTestId("dialog-title").textContent).toContain(
      "Rebase main onto feature",
    );
    await acceptDialog();
    expect(rebaseOnto).toHaveBeenCalledWith("feature");
  });

  it("rebases onto a bare commit row, by full oid", async () => {
    setup();
    const rebaseOnto = vi.fn();
    useRepoStore.setState({ rebaseOnto } as never);
    await waitFor(() => expect(commitRow(OLD_OID)).toBeTruthy());

    drag(pill("main"), commitRow(OLD_OID));

    await waitFor(() => expect(screen.getByTestId("dialog-title")).toBeTruthy());
    await acceptDialog();
    expect(rebaseOnto).toHaveBeenCalledWith(OLD_OID);
  });

  // Dragging someone else's branch onto yours = "bring it here" = merge.
  it("merges another ref dropped onto the current branch's pill", async () => {
    setup();
    const mergeBranch = vi.fn();
    useRepoStore.setState({ mergeBranch } as never);
    await waitFor(() => expect(pill("feature")).toBeTruthy());

    drag(pill("feature"), pill("main"));

    await waitFor(() => expect(screen.getByTestId("dialog-title")).toBeTruthy());
    expect(screen.getByTestId("dialog-title").textContent).toContain(
      "Merge feature into main",
    );
    await acceptDialog();
    expect(mergeBranch).toHaveBeenCalledWith("feature");
  });

  it("merges when dropped on the HEAD commit row rather than its pill", async () => {
    setup();
    const mergeBranch = vi.fn();
    useRepoStore.setState({ mergeBranch } as never);
    await waitFor(() => expect(commitRow(HEAD_OID)).toBeTruthy());

    drag(pill("feature"), commitRow(HEAD_OID));

    await waitFor(() => expect(screen.getByTestId("dialog-title")).toBeTruthy());
    await acceptDialog();
    expect(mergeBranch).toHaveBeenCalledWith("feature");
  });

  it("cherry-picks a commit dropped onto the current branch", async () => {
    setup();
    const cherryPick = vi.fn();
    useRepoStore.setState({ cherryPick } as never);
    await waitFor(() => expect(commitRow(FEATURE_OID)).toBeTruthy());

    drag(commitRow(FEATURE_OID), pill("main"));

    await waitFor(() => expect(screen.getByTestId("dialog-title")).toBeTruthy());
    expect(screen.getByTestId("dialog-title").textContent).toContain("Cherry-pick");
    await acceptDialog();
    expect(cherryPick).toHaveBeenCalledWith(FEATURE_OID);
  });

  // The confirm is the last gate before history changes — dismissing it must
  // leave the repository alone.
  it("touches nothing when the confirm is dismissed", async () => {
    setup();
    const rebaseOnto = vi.fn();
    useRepoStore.setState({ rebaseOnto } as never);
    await waitFor(() => expect(pill("feature")).toBeTruthy());

    drag(pill("main"), pill("feature"));

    await waitFor(() => expect(screen.getByTestId("dialog-title")).toBeTruthy());
    await dismissDialog();
    expect(rebaseOnto).not.toHaveBeenCalled();
  });

  // Nothing rewrites a branch you are not on, and nothing checks one out as a
  // side effect: a non-HEAD → non-HEAD drop has no legal meaning.
  it("refuses a drop between two branches that are not checked out", async () => {
    setup();
    const mergeBranch = vi.fn();
    const rebaseOnto = vi.fn();
    useRepoStore.setState({ mergeBranch, rebaseOnto } as never);
    await waitFor(() => expect(commitRow(OLD_OID)).toBeTruthy());

    drag(pill("feature"), commitRow(OLD_OID));

    expect(mergeBranch).not.toHaveBeenCalled();
    expect(rebaseOnto).not.toHaveBeenCalled();
    expect(document.querySelector("[data-pg-dialog]")).toBeNull();
  });

  it("says why mid-gesture on a refused drop", async () => {
    setup();
    await waitFor(() => expect(commitRow(OLD_OID)).toBeTruthy());

    act(() => {
      pill("feature").dispatchEvent(pointer("pointerdown", 10, 10));
      commitRow(OLD_OID).dispatchEvent(pointer("pointermove", 90, 40));
      commitRow(OLD_OID).dispatchEvent(pointer("pointermove", 91, 41));
    });
    expect(screen.getByTestId("drag-ghost").textContent).toContain("check out");
    expect(screen.getByTestId("drag-ghost").getAttribute("data-drop")).toBe("no");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(screen.queryByTestId("drag-ghost")).toBeNull();
  });

  it("is a no-op when a pill is dropped on its own row", async () => {
    setup();
    const rebaseOnto = vi.fn();
    useRepoStore.setState({ rebaseOnto } as never);
    await waitFor(() => expect(pill("main")).toBeTruthy());

    drag(pill("main"), commitRow(HEAD_OID));

    expect(rebaseOnto).not.toHaveBeenCalled();
    expect(document.querySelector("[data-pg-dialog]")).toBeNull();
  });

  // The OperationBar owns an open merge/rebase; starting a second one from the
  // graph would stack two operations the backend cannot hold.
  it("accepts nothing while an operation is already open", async () => {
    setup({ repoState: "Merge" });
    const mergeBranch = vi.fn();
    useRepoStore.setState({ mergeBranch } as never);
    await waitFor(() => expect(pill("main")).toBeTruthy());

    drag(pill("feature"), pill("main"));

    expect(mergeBranch).not.toHaveBeenCalled();
    expect(document.querySelector("[data-pg-dialog]")).toBeNull();
  });

  // Escape must reach the drag before the keymap's overlay handler.
  it("cancels a legal drag on Escape without confirming", async () => {
    setup();
    const rebaseOnto = vi.fn();
    useRepoStore.setState({ rebaseOnto } as never);
    await waitFor(() => expect(pill("feature")).toBeTruthy());

    act(() => {
      pill("main").dispatchEvent(pointer("pointerdown", 10, 10));
      pill("feature").dispatchEvent(pointer("pointermove", 90, 40));
      pill("feature").dispatchEvent(pointer("pointermove", 91, 41));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      pill("feature").dispatchEvent(pointer("pointerup", 91, 41));
    });

    expect(document.querySelector("[data-pg-dialog]")).toBeNull();
    expect(rebaseOnto).not.toHaveBeenCalled();
  });
});
