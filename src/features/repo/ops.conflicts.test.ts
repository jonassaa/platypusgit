// `conflict.openResolver` (⌘5 since #108) is a keymap runner, so it must claim
// the chord in both outcomes: open the resolver when something is conflicted,
// and say so when nothing is. Returning false would let the chord fall through
// and leave the user with no feedback at all.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resolveConflictsOp } from "./ops";
import { useRepoStore } from "./useRepoStore";
import type { FileStatus } from "@/lib/types";

vi.mock("@/features/merge/openMergeWindow", () => ({
  openMergeWindow: vi.fn().mockResolvedValue(undefined),
}));
import { openMergeWindow } from "@/features/merge/openMergeWindow";

vi.mock("@/design", async (orig) => ({
  ...(await orig<typeof import("@/design")>()),
  pgFlash: vi.fn(),
}));
import { pgFlash } from "@/design";

const conflicted = (path: string) =>
  ({ path, index: { kind: "Conflicted" }, worktree: { kind: "Conflicted" } }) as FileStatus;
const modified = (path: string) =>
  ({ path, index: { kind: "Unmodified" }, worktree: { kind: "Modified" } }) as FileStatus;

function seed(status: FileStatus[], repo: unknown = { id: "r1", path: "/r", head: "HEAD" }) {
  useRepoStore.setState({ current: repo, status } as never);
}

describe("resolveConflictsOp", () => {
  beforeEach(() => {
    vi.mocked(openMergeWindow).mockClear();
    vi.mocked(pgFlash).mockClear();
  });

  it("opens the resolver on the repository when files are conflicted", () => {
    seed([conflicted("a.txt"), modified("b.txt")]);
    expect(resolveConflictsOp()).toBe(true);
    // No path: the window picks the first unresolved file from its own list.
    expect(openMergeWindow).toHaveBeenCalledWith("r1");
  });

  it("claims the chord and says so when nothing is conflicted", () => {
    seed([modified("b.txt")]);
    expect(resolveConflictsOp()).toBe(true);
    expect(openMergeWindow).not.toHaveBeenCalled();
    expect(pgFlash).toHaveBeenCalledWith("No conflicts to resolve");
  });

  it("declines with no repository open, so the chord can fall through", () => {
    seed([], null);
    expect(resolveConflictsOp()).toBe(false);
    expect(openMergeWindow).not.toHaveBeenCalled();
  });
});
