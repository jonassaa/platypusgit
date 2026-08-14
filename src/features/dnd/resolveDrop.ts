/**
 * What a drop MEANS — pure, so the whole table is unit-testable without a DOM,
 * a store or a repository. The screens do the DOM work and call the git ops;
 * every decision about legality lives here.
 */

import type { DragPayload, FilesPayload } from "./types";

// ─── Staging ─────────────────────────────────────────────────────────────────

export type StagingDrop = { action: "stage" | "unstage"; paths: string[] } | null;

/**
 * Dropping files onto a side. Null means "nothing to do": the payload is already
 * on that side, or it carried no actionable path (a folder of embedded repos, a
 * selection the source already filtered empty).
 */
export function resolveStagingDrop(
  payload: FilesPayload,
  targetSide: "staged" | "unstaged",
): StagingDrop {
  if (payload.side === targetSide) return null;
  if (payload.paths.length === 0) return null;
  return {
    action: targetSide === "staged" ? "stage" : "unstage",
    paths: payload.paths,
  };
}

// ─── Graph ───────────────────────────────────────────────────────────────────

export type GraphDropTarget =
  | { kind: "ref"; ref: string }
  | { kind: "commit"; oid: string; shortOid: string };

export type GraphDrop =
  | { kind: "merge"; branch: string }
  | { kind: "rebase"; upstream: string; label: string }
  | { kind: "cherryPick"; oid: string; label: string }
  | { kind: "rejected"; reason: string };

export interface GraphContext {
  /** Current branch name, or null on a detached HEAD. */
  headBranch: string | null;
  /** Oid HEAD points at. */
  headOid: string | null;
}

function isHeadTarget(t: GraphDropTarget, ctx: GraphContext): boolean {
  return t.kind === "ref"
    ? t.ref === ctx.headBranch
    : !!ctx.headOid && t.oid === ctx.headOid;
}

function targetLabel(t: GraphDropTarget): string {
  return t.kind === "ref" ? t.ref : t.shortOid;
}

/**
 * The graph drop table. Deliberately asymmetric, and that asymmetry IS the
 * safety model: the backend can only merge *into* HEAD and rebase *HEAD* onto
 * something, so every legal drop has the current branch at one end. No gesture
 * rewrites a branch you are not on, and none checks a branch out as a side
 * effect.
 *
 * Returns null for a no-op (a thing dropped on itself); a `rejected` result for
 * a gesture that has a meaning we refuse, so the reason can be shown.
 */
export function resolveGraphDrop(
  src: DragPayload,
  target: GraphDropTarget,
  ctx: GraphContext,
): GraphDrop | null {
  if (src.kind === "files") return null;

  const ontoHead = isHeadTarget(target, ctx);

  if (src.kind === "ref") {
    if (target.kind === "ref" && target.ref === src.ref) return null;
    if (src.isHead) {
      // Dragging your own branch elsewhere = "move me over there" = rebase.
      if (target.kind === "commit" && target.oid === ctx.headOid) return null;
      const upstream = target.kind === "ref" ? target.ref : target.oid;
      return { kind: "rebase", upstream, label: targetLabel(target) };
    }
    // Dragging someone else's branch onto yours = "bring it here" = merge.
    if (ontoHead) return { kind: "merge", branch: src.ref };
    return {
      kind: "rejected",
      reason: `Only the current branch can be merged into — check out ${targetLabel(
        target,
      )} first`,
    };
  }

  // src.kind === "commit"
  if (target.kind === "commit" && target.oid === src.oid) return null;
  if (ontoHead) {
    if (src.oid === ctx.headOid) return null;
    return { kind: "cherryPick", oid: src.oid, label: src.label };
  }
  return {
    kind: "rejected",
    reason: `Cherry-pick applies to the current branch — check out ${targetLabel(
      target,
    )} first`,
  };
}
