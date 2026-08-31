// Undo, end to end through the store (#242).
//
// `undoStack.test.ts` pins the model. This file pins that the model is
// actually fed and actually acted on: that operations record entries, that
// preconditions are re-read from the BACKEND rather than from cached state,
// and that a refusal changes nothing.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { pgFlashClear } from "@/design";

import { emptyUndo, undoable } from "./undoStack";
import { useRepoStore } from "./useRepoStore";

/** Where HEAD is, as the backend reports it. Moved by tests. */
let head: { branch: string | null; headOid: string } = {
  branch: "refs/heads/main",
  headOid: "aaaa1111",
};
/** Whether the working copy is dirty, as the backend reports it. */
let dirty = false;

function mockRefresh() {
  mockInvoke("get_status", () =>
    dirty
      ? [
          {
            path: "a.ts",
            worktree: { kind: "Modified" },
            index: { kind: "Unmodified" },
            additions: 1,
            deletions: 0,
            embedded: false,
          },
        ]
      : [],
  );
  mockInvoke("list_branches", () => []);
  mockInvoke("list_tags", () => []);
  mockInvoke("list_stashes", () => []);
  mockInvoke("list_remotes", () => []);
  mockInvoke("get_log_page", () => ({ commits: [], nextCursor: null }));
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("head_info", () => head);
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
  mockInvoke("bisect_status", () => ({
    inProgress: false,
    startRef: null,
    badTerm: "bad",
    goodTerm: "good",
    currentOid: null,
    remaining: null,
    steps: null,
    firstBadOid: null,
    goodCount: 0,
    badCount: 0,
    skippedCount: 0,
  }));
}

const cmds = (cmd: string) => getInvokeCalls().filter((c) => c.cmd === cmd);

/** Run `op`, with HEAD moving to `to` as a result. */
async function withHeadMovingTo(
  to: { branch: string | null; headOid: string },
  op: () => Promise<unknown>,
) {
  const done = op();
  head = to;
  await done;
}

beforeEach(async () => {
  resetInvokeMock();
  pgFlashClear();
  head = { branch: "refs/heads/main", headOid: "aaaa1111" };
  dirty = false;
  mockRefresh();
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
    error: null,
    status: [],
    headInfo: head,
    ...emptyUndo(),
  } as never);
});

describe("operations record what they did", () => {
  it("a commit records an entry naming its subject", async () => {
    mockInvoke("commit", () => ({ oid: "bbbb2222", message: "fix: thing" }));
    await withHeadMovingTo(
      { branch: "refs/heads/main", headOid: "bbbb2222" },
      () => useRepoStore.getState().commit("fix: thing\n\nbody"),
    );

    const entry = undoable(useRepoStore.getState());
    expect(entry?.kind).toBe("commit");
    // Never a bare "Undo" — the label carries the subject.
    expect(entry?.label).toContain("fix: thing");
    expect(entry?.before.oid).toBe("aaaa1111");
    expect(entry?.after.oid).toBe("bbbb2222");
  });

  it("a merge records the branch it merged", async () => {
    mockInvoke("merge_branch", () => undefined);
    await withHeadMovingTo(
      { branch: "refs/heads/main", headOid: "bbbb2222" },
      () => useRepoStore.getState().mergeBranch("feat/x"),
    );
    expect(undoable(useRepoStore.getState())?.label).toBe("merge of feat/x");
  });

  it("a revert records the commit it reverted", async () => {
    mockInvoke("revert", () => undefined);
    await withHeadMovingTo(
      { branch: "refs/heads/main", headOid: "bbbb2222" },
      () => useRepoStore.getState().revert("0123456789abcdef"),
    );
    expect(undoable(useRepoStore.getState())?.label).toBe(
      "revert of 01234567",
    );
  });

  it("an operation that FAILED records nothing", async () => {
    mockInvoke("merge_branch", () => {
      throw { kind: "ConflictsDetected", message: "conflicts" };
    });
    await useRepoStore.getState().mergeBranch("feat/x");
    expect(undoable(useRepoStore.getState())).toBeNull();
  });

  it("an operation that did not move HEAD records nothing", async () => {
    // Checking out the branch you are already on. An entry here would make ⌘Z
    // appear to act and then do nothing.
    mockInvoke("checkout_ref", () => undefined);
    mockInvoke("stash_save", () => null);
    await useRepoStore.getState().checkoutRef("main");
    expect(undoable(useRepoStore.getState())).toBeNull();
  });
});

describe("applying an undo", () => {
  async function recordACommit() {
    mockInvoke("commit", () => ({ oid: "bbbb2222", message: "fix: thing" }));
    await withHeadMovingTo(
      { branch: "refs/heads/main", headOid: "bbbb2222" },
      () => useRepoStore.getState().commit("fix: thing"),
    );
  }

  it("hard-resets back to where the operation started", async () => {
    await recordACommit();
    mockInvoke("reset", () => undefined);
    await withHeadMovingTo(
      { branch: "refs/heads/main", headOid: "aaaa1111" },
      () => useRepoStore.getState().applyUndo("undo"),
    );

    const reset = cmds("reset");
    expect(reset).toHaveLength(1);
    expect(reset[0].args).toMatchObject({ target: "aaaa1111", mode: "Hard" });
    // The entry is not discarded — it moves behind the cursor, ready to redo.
    expect(useRepoStore.getState().undoStack).toHaveLength(1);
    expect(useRepoStore.getState().undoCursor).toBe(0);
  });

  it("puts a checkout back ON the branch, not detached at the same commit", async () => {
    // Same oid, different ref is a real state difference, and `checkout_ref`
    // with an oid would leave HEAD detached — identical in the log, and not
    // what the user had.
    mockInvoke("checkout_ref", () => undefined);
    await withHeadMovingTo({ branch: null, headOid: "bbbb2222" }, () =>
      useRepoStore.getState().checkoutRef("bbbb2222"),
    );
    resetInvokeMock();
    mockRefresh();
    mockInvoke("checkout_ref", () => undefined);

    await withHeadMovingTo(
      { branch: "refs/heads/main", headOid: "aaaa1111" },
      () => useRepoStore.getState().applyUndo("undo"),
    );
    expect(cmds("checkout_ref")[0].args.reference).toBe("refs/heads/main");
    expect(cmds("reset")).toHaveLength(0);
  });

  it("redo moves forward again", async () => {
    await recordACommit();
    mockInvoke("reset", () => undefined);
    await withHeadMovingTo(
      { branch: "refs/heads/main", headOid: "aaaa1111" },
      () => useRepoStore.getState().applyUndo("undo"),
    );
    await withHeadMovingTo(
      { branch: "refs/heads/main", headOid: "bbbb2222" },
      () => useRepoStore.getState().applyUndo("redo"),
    );

    expect(cmds("reset")).toHaveLength(2);
    expect(cmds("reset")[1].args.target).toBe("bbbb2222");
    expect(useRepoStore.getState().undoCursor).toBe(1);
  });
});

describe("refusals change nothing", () => {
  async function recordACommit() {
    mockInvoke("commit", () => ({ oid: "bbbb2222", message: "fix: thing" }));
    await withHeadMovingTo(
      { branch: "refs/heads/main", headOid: "bbbb2222" },
      () => useRepoStore.getState().commit("fix: thing"),
    );
  }

  it("refuses when HEAD moved, asking the BACKEND not the cached value", async () => {
    await recordACommit();
    // The store still believes HEAD is at bbbb2222; only the backend knows a
    // terminal moved it. Reading the cached `headInfo` would let this through.
    head = { branch: "refs/heads/main", headOid: "9999ffff" };
    mockInvoke("reset", () => undefined);

    await useRepoStore.getState().applyUndo("undo");

    expect(cmds("head_info").length).toBeGreaterThan(0);
    expect(cmds("reset")).toHaveLength(0);
    expect(useRepoStore.getState().undoCursor).toBe(1);
  });

  it("refuses a hard undo when the working copy is dirty", async () => {
    await recordACommit();
    dirty = true;
    mockInvoke("reset", () => undefined);

    await useRepoStore.getState().applyUndo("undo");

    expect(cmds("reset")).toHaveLength(0);
    expect(useRepoStore.getState().undoCursor).toBe(1);
  });

  it("does not become an AppError — the union stays 1:1 with Rust", async () => {
    // A precondition refusal is not something git refused; nothing was even
    // attempted. Synthesising an AppError would claim otherwise, and there is
    // no Rust variant for a frontend-only condition.
    await recordACommit();
    head = { branch: "refs/heads/main", headOid: "9999ffff" };
    await useRepoStore.getState().applyUndo("undo");
    expect(useRepoStore.getState().error).toBeNull();
  });

  it("does nothing at all with an empty stack", async () => {
    await useRepoStore.getState().applyUndo("undo");
    expect(cmds("reset")).toHaveLength(0);
    expect(cmds("checkout_ref")).toHaveLength(0);
  });
});

describe("the stack is per repository", () => {
  it("does not survive a tab switch", async () => {
    // `useRepoStore` holds exactly one repository's state, and `emptySlice()`
    // is a TOTAL write. An undo stack that leaked would offer to reset the
    // wrong repository.
    mockInvoke("commit", () => ({ oid: "bbbb2222", message: "fix: thing" }));
    await withHeadMovingTo(
      { branch: "refs/heads/main", headOid: "bbbb2222" },
      () => useRepoStore.getState().commit("fix: thing"),
    );
    expect(useRepoStore.getState().undoStack).toHaveLength(1);

    useRepoStore.getState().closeRepo();
    expect(useRepoStore.getState().undoStack).toHaveLength(0);
    expect(useRepoStore.getState().undoCursor).toBe(0);
  });
});

describe("the stack is guarded against a late resolution", () => {
  it("does not record onto another repository's stack", async () => {
    // The `setErrorFor` rule, applied to undo: an op that resolves after the
    // user has moved to another repository must write nothing.
    let release: (() => void) | null = null;
    mockInvoke("merge_branch", async () => {
      await new Promise<void>((r) => {
        release = r;
      });
    });
    const pending = useRepoStore.getState().mergeBranch("feat/x");
    await vi.waitFor(() => expect(release).not.toBeNull());

    useRepoStore.setState({
      current: { id: "r2", path: "/other", head: "main" },
      ...emptyUndo(),
    } as never);
    head = { branch: "refs/heads/main", headOid: "bbbb2222" };
    release!();
    await pending;

    expect(useRepoStore.getState().undoStack).toHaveLength(0);
  });
});
