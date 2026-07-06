// stageAllOp / unstageAllOp — default runners for the ⌘⇧S / ⌘⇧U chords.
// Decline (false) with no repo or nothing to move; otherwise call the store
// with every unstaged/staged path.

import { describe, it, expect, beforeEach } from "vitest";
import { stageAllOp, unstageAllOp } from "./ops";
import { useRepoStore } from "./useRepoStore";
import type { FileStatus } from "@/lib/types";

const staged = (path: string): FileStatus => ({
  path,
  worktree: { kind: "Unmodified" },
  index: { kind: "Modified" },
});
const unstaged = (path: string): FileStatus => ({
  path,
  worktree: { kind: "Modified" },
  index: { kind: "Unmodified" },
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

  it("declines when there is nothing to move", () => {
    useRepoStore.setState({ status: [staged("a.ts")] } as never);
    expect(stageAllOp()).toBe(false);
    useRepoStore.setState({ status: [unstaged("b.ts")] } as never);
    expect(unstageAllOp()).toBe(false);
    expect(stageCalls).toEqual([]);
    expect(unstageCalls).toEqual([]);
  });
});
