import { describe, it, expect } from "vitest";
import {
  resolveBranchMoveDrop,
  resolveGraphDrop,
  resolveStagingDrop,
  type BranchMoveContext,
  type BranchMoveTarget,
  type GraphContext,
  type GraphDropTarget,
} from "./resolveDrop";
import type { CommitPayload, FilesPayload, RefPayload } from "./types";

function files(
  side: "staged" | "unstaged",
  paths: string[],
): FilesPayload {
  return { kind: "files", side, paths, label: `${paths.length} files` };
}

const HEAD_OID = "a".repeat(40);
const OTHER_OID = "b".repeat(40);

const ctx: GraphContext = { headBranch: "main", headOid: HEAD_OID };

function ref(name: string, isHead: boolean): RefPayload {
  return { kind: "ref", ref: name, isHead, label: name };
}
function commit(oid: string): CommitPayload {
  return { kind: "commit", oid, label: oid.slice(0, 7) };
}
const refTarget = (name: string): GraphDropTarget => ({ kind: "ref", ref: name });
const commitTarget = (oid: string): GraphDropTarget => ({
  kind: "commit",
  oid,
  shortOid: oid.slice(0, 7),
});

describe("resolveStagingDrop", () => {
  it("stages files dropped onto the staged side", () => {
    expect(resolveStagingDrop(files("unstaged", ["a.txt", "b.txt"]), "staged")).toEqual({
      action: "stage",
      paths: ["a.txt", "b.txt"],
    });
  });

  it("unstages files dropped onto the unstaged side", () => {
    expect(resolveStagingDrop(files("staged", ["a.txt"]), "unstaged")).toEqual({
      action: "unstage",
      paths: ["a.txt"],
    });
  });

  it("is a no-op when the payload is already on that side", () => {
    expect(resolveStagingDrop(files("staged", ["a.txt"]), "staged")).toBeNull();
    expect(resolveStagingDrop(files("unstaged", ["a.txt"]), "unstaged")).toBeNull();
  });

  // A folder holding only embedded repos, or a selection the source already
  // filtered down to nothing, must not reach the backend as an empty batch.
  it("is a no-op for an empty path list", () => {
    expect(resolveStagingDrop(files("unstaged", []), "staged")).toBeNull();
  });
});

describe("resolveGraphDrop", () => {
  it("rebases the current branch onto another ref", () => {
    expect(resolveGraphDrop(ref("main", true), refTarget("develop"), ctx)).toEqual({
      kind: "rebase",
      upstream: "develop",
      label: "develop",
    });
  });

  it("rebases the current branch onto a remote-tracking ref", () => {
    expect(
      resolveGraphDrop(ref("main", true), refTarget("origin/main"), ctx),
    ).toEqual({ kind: "rebase", upstream: "origin/main", label: "origin/main" });
  });

  it("rebases the current branch onto a bare commit, by oid", () => {
    expect(resolveGraphDrop(ref("main", true), commitTarget(OTHER_OID), ctx)).toEqual({
      kind: "rebase",
      upstream: OTHER_OID,
      label: OTHER_OID.slice(0, 7),
    });
  });

  it("merges another ref into the current branch", () => {
    expect(resolveGraphDrop(ref("feature", false), refTarget("main"), ctx)).toEqual({
      kind: "merge",
      branch: "feature",
    });
  });

  it("merges when dropped on the HEAD commit row rather than the pill", () => {
    expect(
      resolveGraphDrop(ref("feature", false), commitTarget(HEAD_OID), ctx),
    ).toEqual({ kind: "merge", branch: "feature" });
  });

  it("cherry-picks a commit dropped onto the current branch", () => {
    expect(resolveGraphDrop(commit(OTHER_OID), refTarget("main"), ctx)).toEqual({
      kind: "cherryPick",
      oid: OTHER_OID,
      label: OTHER_OID.slice(0, 7),
    });
  });

  // The whole safety model: nothing rewrites a branch you are not on.
  it("refuses to merge into a branch that is not checked out", () => {
    const r = resolveGraphDrop(ref("feature", false), refTarget("develop"), ctx);
    expect(r?.kind).toBe("rejected");
    expect(r && "reason" in r ? r.reason : "").toContain("check out develop first");
  });

  it("refuses to cherry-pick onto a branch that is not checked out", () => {
    const r = resolveGraphDrop(commit(OTHER_OID), refTarget("develop"), ctx);
    expect(r?.kind).toBe("rejected");
    expect(r && "reason" in r ? r.reason : "").toContain("check out develop first");
  });

  it("refuses to cherry-pick onto a commit that is not HEAD", () => {
    expect(resolveGraphDrop(commit(OTHER_OID), commitTarget("c".repeat(40)), ctx)?.kind).toBe(
      "rejected",
    );
  });

  it("is a no-op when a ref is dropped on itself", () => {
    expect(resolveGraphDrop(ref("main", true), refTarget("main"), ctx)).toBeNull();
    expect(resolveGraphDrop(ref("feature", false), refTarget("feature"), ctx)).toBeNull();
  });

  it("is a no-op when a commit is dropped on itself", () => {
    expect(resolveGraphDrop(commit(OTHER_OID), commitTarget(OTHER_OID), ctx)).toBeNull();
  });

  it("is a no-op when the HEAD ref is dropped on the commit it already points at", () => {
    expect(resolveGraphDrop(ref("main", true), commitTarget(HEAD_OID), ctx)).toBeNull();
  });

  it("is a no-op when the HEAD commit is dropped onto the HEAD ref", () => {
    expect(resolveGraphDrop(commit(HEAD_OID), refTarget("main"), ctx)).toBeNull();
  });

  it("ignores a files payload entirely", () => {
    expect(resolveGraphDrop(files("unstaged", ["a.txt"]), refTarget("main"), ctx)).toBeNull();
  });

  // Detached HEAD: no branch to merge into, no branch to rebase, but the HEAD
  // pill does not exist either — so the only reachable drops are rejections.
  it("rejects a merge while HEAD is detached", () => {
    const detached: GraphContext = { headBranch: null, headOid: HEAD_OID };
    expect(
      resolveGraphDrop(ref("feature", false), refTarget("develop"), detached)?.kind,
    ).toBe("rejected");
  });
});

describe("resolveBranchMoveDrop", () => {
  const folder = (path: string): BranchMoveTarget => ({ kind: "folder", path });
  const root: BranchMoveTarget = { kind: "root" };
  const ctx: BranchMoveContext = {
    local: ["main", "bugfix", "feat/a", "feat/b", "feat/deep/c", "release/x"],
  };

  it("moves a top-level branch into a folder", () => {
    expect(resolveBranchMoveDrop(ref("bugfix", false), folder("feat"), ctx)).toEqual({
      kind: "move",
      from: "bugfix",
      to: "feat/bugfix",
    });
  });

  it("moves a branch from one folder to another", () => {
    expect(resolveBranchMoveDrop(ref("feat/a", false), folder("release"), ctx)).toEqual({
      kind: "move",
      from: "feat/a",
      to: "release/a",
    });
  });

  it("moves a branch into a nested folder", () => {
    expect(
      resolveBranchMoveDrop(ref("bugfix", false), folder("feat/deep"), ctx),
    ).toEqual({ kind: "move", from: "bugfix", to: "feat/deep/bugfix" });
  });

  it("moves a branch out to the top level", () => {
    expect(resolveBranchMoveDrop(ref("feat/a", false), root, ctx)).toEqual({
      kind: "move",
      from: "feat/a",
      to: "a",
    });
  });

  // Only the leaf travels, like a file dragged between directories: the folder
  // it came out of is not part of its new name.
  it("carries only the last segment out of a deep folder", () => {
    expect(
      resolveBranchMoveDrop(ref("feat/deep/c", false), folder("release"), ctx),
    ).toEqual({ kind: "move", from: "feat/deep/c", to: "release/c" });
  });

  // The current branch renames like any other — `git branch -m <new>` is
  // exactly this — so the gesture is not gated on it.
  it("moves the current branch", () => {
    expect(resolveBranchMoveDrop(ref("main", true), folder("feat"), ctx)).toEqual({
      kind: "move",
      from: "main",
      to: "feat/main",
    });
  });

  it("is a no-op on the folder the branch already sits in", () => {
    expect(resolveBranchMoveDrop(ref("feat/a", false), folder("feat"), ctx)).toBeNull();
  });

  it("is a no-op dropping a top-level branch onto the top level", () => {
    expect(resolveBranchMoveDrop(ref("bugfix", false), root, ctx)).toBeNull();
  });

  it("rejects a name the repository already uses", () => {
    expect(
      resolveBranchMoveDrop(ref("bugfix", false), folder("release"), {
        local: [...ctx.local, "release/bugfix"],
      }),
    ).toEqual({ kind: "rejected", reason: "release/bugfix already exists" });
  });

  // A remote-tracking ref is not a branch git can move. Reported rather than
  // ignored, so the gesture explains itself mid-drag instead of going dead.
  it("rejects a remote-tracking branch", () => {
    expect(
      resolveBranchMoveDrop(ref("origin/feat/a", false), folder("release"), ctx)?.kind,
    ).toBe("rejected");
  });

  it("ignores payloads that are not refs", () => {
    expect(resolveBranchMoveDrop(commit(HEAD_OID), folder("feat"), ctx)).toBeNull();
    expect(
      resolveBranchMoveDrop(files("unstaged", ["a.txt"]), folder("feat"), ctx),
    ).toBeNull();
  });
});
