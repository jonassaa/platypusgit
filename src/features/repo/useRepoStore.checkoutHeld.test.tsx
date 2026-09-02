// `checkoutBranch` when a linked worktree holds the branch (#358).
//
// The backend refuses with `BranchHeldByWorktree` rather than mangling the
// index, and the store turns that refusal into the choice the user actually
// wants: take the branch from that worktree, or go and work in it.
//
// The trap this file exists for is the AUTO-STASH. `checkoutBranch` stashes
// uncommitted work BEFORE it calls the backend, and pops it after a successful
// checkout. Every path that declines the checkout therefore has to pop it back,
// or the user's work is left sitting in a stash they never made — a refusal
// that quietly hides their changes is the same bug class as the one that
// started all this, just with a different symptom.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

import { useRepoStore } from "./useRepoStore";
import { useTabsStore } from "./useTabsStore";
import { WithDialogs, resetDialogs } from "@/test/dialog";
import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";
import type { BranchHeld } from "@/lib/errors";

const HELD: BranchHeld = {
  branch: "FIM-122",
  worktree: "api-fixes",
  path: "/dev/proj/.worktrees/api-fixes",
  blocked: null,
  dirty: true,
};

/** Every `checkout_branch` invoke, as the `take` flag it was given. */
const checkoutTakes = () =>
  getInvokeCalls()
    .filter((c) => c.cmd === "checkout_branch")
    .map((c) => c.args.take);

const invoked = (cmd: string) => getInvokeCalls().filter((c) => c.cmd === cmd);

let opened: string[] = [];

function armRepo() {
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
    error: null,
    refreshAll: async () => {},
  } as never);
  useTabsStore.setState({
    openRepo: async (p: string) => {
      opened.push(p);
    },
  } as never);
}

/**
 * Refuse the first attempt the way the backend does, accept a `take`.
 * `held` lets a case vary what the holder looks like.
 */
function armBackend(held: BranchHeld = HELD) {
  // A dirty tree, so the auto-stash actually produces a stash to strand.
  mockInvoke("stash_save", () => "stash@{0}");
  mockInvoke("stash_pop", () => null);
  mockInvoke("checkout_branch", ({ take }) => {
    if (!take) throw { kind: "BranchHeldByWorktree", message: held };
    return null;
  });
}

const pick = async (id: string) => {
  const btn = await screen.findByTestId(`dialog-choice-${id}`);
  await act(async () => {
    btn.click();
  });
};

beforeEach(() => {
  opened = [];
  resetDialogs();
  armRepo();
});
afterEach(() => {
  resetDialogs();
  vi.restoreAllMocks();
});

describe("checkoutBranch against a held branch", () => {
  it("offers the choice and retries with take when the user says move it here", async () => {
    armBackend();
    render(<WithDialogs>{null}</WithDialogs>);

    const done = useRepoStore.getState().checkoutBranch("FIM-122");
    await pick("take");
    await done;

    expect(checkoutTakes()).toEqual([false, true]);
    expect(useRepoStore.getState().error).toBeNull();
    // The stash is restored by the SUCCESS path, exactly once.
    expect(invoked("stash_pop")).toHaveLength(1);
  });

  it("opens the holding worktree instead, without touching the branch", async () => {
    armBackend();
    render(<WithDialogs>{null}</WithDialogs>);

    const done = useRepoStore.getState().checkoutBranch("FIM-122");
    await pick("open");
    await done;

    expect(opened).toEqual(["/dev/proj/.worktrees/api-fixes"]);
    expect(checkoutTakes()).toEqual([false]);
    // Declining still has to give the user their work back.
    expect(invoked("stash_pop")).toHaveLength(1);
  });

  it("restores the auto-stash and sets no banner when the user cancels", async () => {
    armBackend();
    render(<WithDialogs>{null}</WithDialogs>);

    const done = useRepoStore.getState().checkoutBranch("FIM-122");
    const cancel = await screen.findByTestId("dialog-cancel");
    await act(async () => {
      cancel.click();
    });
    await done;

    expect(checkoutTakes()).toEqual([false]);
    expect(invoked("stash_pop")).toHaveLength(1);
    // A choice the user declined is not an error to report at them.
    expect(useRepoStore.getState().error).toBeNull();
  });

  it("does not offer the take when the holder is blocked", async () => {
    armBackend({ ...HELD, blocked: "a rebase is in progress there" });
    render(<WithDialogs>{null}</WithDialogs>);

    const done = useRepoStore.getState().checkoutBranch("FIM-122");
    await screen.findByTestId("dialog-choice-open");

    // Offering a button that is going to fail is worse than not offering it.
    expect(screen.queryByTestId("dialog-choice-take")).toBeNull();
    expect(screen.getByTestId("dialog-title").textContent).toContain("FIM-122");

    await pick("open");
    await done;
    expect(checkoutTakes()).toEqual([false]);
  });

  it("reports any other refusal as a banner rather than a choice", async () => {
    mockInvoke("stash_save", () => null);
    mockInvoke("checkout_branch", () => {
      throw { kind: "DirtyWorktree", message: "commit or stash first" };
    });
    render(<WithDialogs>{null}</WithDialogs>);

    await useRepoStore.getState().checkoutBranch("FIM-122");

    expect(useRepoStore.getState().error).toEqual({
      kind: "DirtyWorktree",
      message: "commit or stash first",
    });
  });

  it("gives the work back and reports the failure when the take itself is refused", async () => {
    // The holder acquired a lock (or started a rebase) between the refusal and
    // the answer — the backend re-validates, so the take can still fail.
    mockInvoke("stash_save", () => "stash@{0}");
    mockInvoke("stash_pop", () => null);
    mockInvoke("checkout_branch", ({ take }) => {
      if (!take) throw { kind: "BranchHeldByWorktree", message: HELD };
      throw { kind: "InvalidArgument", message: "it is locked: do not touch" };
    });
    render(<WithDialogs>{null}</WithDialogs>);

    const done = useRepoStore.getState().checkoutBranch("FIM-122");
    await pick("take");
    await done;

    expect(checkoutTakes()).toEqual([false, true]);
    // Unlike a cancel, this one IS worth a banner — the user asked for it and
    // it did not happen.
    expect(useRepoStore.getState().error).toEqual({
      kind: "InvalidArgument",
      message: "it is locked: do not touch",
    });
    // And their uncommitted work must not be left in a stash they never made.
    expect(invoked("stash_pop")).toHaveLength(1);
  });
});
