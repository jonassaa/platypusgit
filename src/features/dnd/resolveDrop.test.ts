import { describe, it, expect } from "vitest";
import {
  resolveGraphDrop,
  resolveStagingDrop,
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
