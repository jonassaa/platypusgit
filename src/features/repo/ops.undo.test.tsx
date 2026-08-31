// The undo/redo op runners (#242).
//
// Two things only this layer can get wrong: whether ⌘Z is CLAIMED (a runner
// that always returns true steals the chord from every text field in the app),
// and whether the hard kinds are confirmed before anything moves.

import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  WithDialogs,
  acceptDialog,
  dialogIsOpen,
  dialogTitle,
  dismissDialog,
  resetDialogs,
} from "@/test/dialog";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";

import { redoOp, undoOp } from "./ops";
import { emptyUndo, type UndoEntry } from "./undoStack";
import { useRepoStore } from "./useRepoStore";

const HEAD = { branch: "refs/heads/main", headOid: "bbbb2222" };

function mockRefresh() {
  for (const cmd of [
    "get_status",
    "list_branches",
    "list_tags",
    "list_stashes",
    "list_remotes",
  ]) {
    mockInvoke(cmd, () => []);
  }
  mockInvoke("get_log_page", () => ({ commits: [], nextCursor: null }));
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("head_info", () => HEAD);
  mockInvoke("rebase_status", () => ({
    inProgress: false,
    nextIndex: 0,
    total: 0,
    pauseReason: null,
  }));
  mockInvoke("shallow_info", () => ({
    shallow: false,
    boundaryCount: 0,
    singleBranch: false,
  }));
  mockInvoke("reset", () => undefined);
  mockInvoke("checkout_ref", () => undefined);
}

const entry = (over: Partial<UndoEntry> = {}): UndoEntry => ({
  id: "e1",
  kind: "merge",
  label: "merge of feat/x",
  before: { ref: "refs/heads/main", oid: "aaaa1111" },
  after: { ref: "refs/heads/main", oid: "bbbb2222" },
  ...over,
});

function seed(stack: UndoEntry[], cursor = stack.length) {
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
    error: null,
    status: [],
    headInfo: HEAD,
    undoStack: stack,
    undoCursor: cursor,
  } as never);
}

const cmds = (cmd: string) => getInvokeCalls().filter((c) => c.cmd === cmd);

beforeEach(() => {
  resetInvokeMock();
  resetDialogs();
  mockRefresh();
  useRepoStore.setState({ current: null, ...emptyUndo() } as never);
});

describe("claiming the chord", () => {
  it("declines with nothing to undo, so Mod+Z still undoes typing", () => {
    // The whole reason this returns a boolean. A runner that always claimed
    // the chord would break text editing everywhere in the app.
    seed([]);
    expect(undoOp()).toBe(false);
    expect(redoOp()).toBe(false);
  });

  it("declines with no repository open", () => {
    useRepoStore.setState({ current: null, ...emptyUndo() } as never);
    expect(undoOp()).toBe(false);
  });

  it("claims the chord when there is something to undo", () => {
    seed([entry()]);
    expect(undoOp()).toBe(true);
  });

  it("redo declines until something has been undone", () => {
    seed([entry()]);
    expect(redoOp()).toBe(false);
    seed([entry()], 0);
    expect(redoOp()).toBe(true);
  });
});

describe("confirming the destructive kinds", () => {
  it("names the operation in the dialog, never a bare Undo", async () => {
    render(<WithDialogs>{null}</WithDialogs>);
    seed([entry()]);
    undoOp();
    await waitFor(() => expect(dialogIsOpen()).toBe(true));
    expect(dialogTitle()).toBe("Undo merge of feat/x?");
  });

  it("does nothing when the confirmation is dismissed", async () => {
    render(<WithDialogs>{null}</WithDialogs>);
    seed([entry()]);
    undoOp();
    await waitFor(() => expect(dialogIsOpen()).toBe(true));
    await dismissDialog();
    expect(cmds("reset")).toHaveLength(0);
    expect(useRepoStore.getState().undoCursor).toBe(1);
  });

  it("proceeds when it is accepted", async () => {
    render(<WithDialogs>{null}</WithDialogs>);
    seed([entry()]);
    undoOp();
    await waitFor(() => expect(dialogIsOpen()).toBe(true));
    await acceptDialog();
    await waitFor(() => expect(cmds("reset")).toHaveLength(1));
    expect(cmds("reset")[0].args.target).toBe("aaaa1111");
  });

  it("does NOT confirm a checkout — it discards nothing", async () => {
    render(<WithDialogs>{null}</WithDialogs>);
    seed([entry({ kind: "checkout", label: "switch to feat/x" })]);
    undoOp();
    await waitFor(() => expect(cmds("checkout_ref")).toHaveLength(1));
    expect(dialogIsOpen()).toBe(false);
  });

  it("says the commits are not lost", async () => {
    // The confirmation exists because a commit is about to stop being on a
    // branch — not because anything is deleted. Saying so is what keeps the
    // dialog from reading scarier than the operation is.
    render(<WithDialogs>{null}</WithDialogs>);
    seed([entry()]);
    undoOp();
    await waitFor(() => expect(dialogIsOpen()).toBe(true));
    expect(document.body.textContent).toContain("reflog");
  });
});
