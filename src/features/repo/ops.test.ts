// stageAllOp / unstageAllOp — default runners for the ⌘⇧S / ⌘⇧U chords.
// Decline (false) with no repo or nothing to move; otherwise call the store
// with every unstaged/staged path.

import { describe, it, expect, beforeEach } from "vitest";
import { cloneRepoOp, initRepoOp, stageAllOp, unstageAllOp } from "./ops";
import { useRepoStore } from "./useRepoStore";
import { useCreateStore } from "@/features/create/useCreateStore";
import type { FileStatus } from "@/lib/types";

const staged = (path: string): FileStatus => ({
  path,
  worktree: { kind: "Unmodified" },
  index: { kind: "Modified" },
  additions: 0,
  deletions: 0,
  embedded: false,
});
const unstaged = (path: string): FileStatus => ({
  path,
  worktree: { kind: "Modified" },
  index: { kind: "Unmodified" },
  additions: 0,
  deletions: 0,
  embedded: false,
});
/** An untracked dir that is its own git repo — reported with a trailing slash. */
const embedded = (path: string): FileStatus => ({
  path,
  worktree: { kind: "Untracked" },
  index: { kind: "Unmodified" },
  additions: 0,
  deletions: 0,
  embedded: true,
});

describe("stageAllOp / unstageAllOp", () => {
  const stageCalls: string[][] = [];
  const unstageCalls: string[][] = [];

  beforeEach(() => {
    stageCalls.length = 0;
    unstageCalls.length = 0;
    useRepoStore.setState({
      current: { id: "r1", path: "/repo", head: "main" },
      status: [staged("a.ts"), unstaged("b.ts"), unstaged("c.ts")],
      stage: async (paths: string[]) => {
        stageCalls.push(paths);
      },
      unstage: async (paths: string[]) => {
        unstageCalls.push(paths);
      },
    } as never);
  });

  it("stageAllOp stages every unstaged path", () => {
    expect(stageAllOp()).toBe(true);
    expect(stageCalls).toEqual([["b.ts", "c.ts"]]);
  });

  it("unstageAllOp unstages every staged path", () => {
    expect(unstageAllOp()).toBe(true);
    expect(unstageCalls).toEqual([["a.ts"]]);
  });

  it("declines with no repo", () => {
    useRepoStore.setState({ current: null } as never);
    expect(stageAllOp()).toBe(false);
    expect(unstageAllOp()).toBe(false);
    expect(stageCalls).toEqual([]);
    expect(unstageCalls).toEqual([]);
  });

  it("stageAllOp skips embedded git repos but still stages the rest", () => {
    // Stage-all used to pass status() paths verbatim, so one vendored repo made
    // the whole batch fail — the user could stage nothing until they ignored it.
    useRepoStore.setState({
      status: [unstaged("b.ts"), embedded("vendor/lib/")],
    } as never);
    expect(stageAllOp()).toBe(true);
    expect(stageCalls).toEqual([["b.ts"]]);
  });

  it("stageAllOp declines when every unstaged entry is an embedded repo", () => {
    useRepoStore.setState({ status: [embedded("vendor/lib/")] } as never);
    expect(stageAllOp()).toBe(false);
    expect(stageCalls).toEqual([]);
  });

  it("declines when there is nothing to move", () => {
    useRepoStore.setState({ status: [staged("a.ts")] } as never);
    expect(stageAllOp()).toBe(false);
    useRepoStore.setState({ status: [unstaged("b.ts")] } as never);
    expect(unstageAllOp()).toBe(false);
    expect(stageCalls).toEqual([]);
    expect(unstageCalls).toEqual([]);
  });
});

describe("cloneRepoOp / initRepoOp", () => {
  beforeEach(() => {
    useCreateStore.setState({ open: "none", busy: false, progress: null, error: null });
  });

  // The action-catalog test only asserts `run` is *a function* — it can't
  // catch a runner wired to the wrong dialog (e.g. cloneRepoOp calling
  // openInit()). Assert the actual store field each runner flips.
  it("cloneRepoOp opens the clone dialog and claims the chord", () => {
    expect(cloneRepoOp()).toBe(true);
    expect(useCreateStore.getState().open).toBe("clone");
  });

  it("initRepoOp opens the init dialog and claims the chord", () => {
    expect(initRepoOp()).toBe(true);
    expect(useCreateStore.getState().open).toBe("init");
  });

  it("each runner opens only its own dialog, not the other", () => {
    cloneRepoOp();
    expect(useCreateStore.getState().open).toBe("clone");
    initRepoOp();
    expect(useCreateStore.getState().open).toBe("init");
  });
});
