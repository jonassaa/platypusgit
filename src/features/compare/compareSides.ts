// The compare view's side model (#131). PURE — no store, no IPC, no React — so
// `useNavStore` can carry a `CompareSide` in an intent without importing the
// compare feature's store, and so the labelling rules are testable on their own.

import type { BranchInfo } from "@/lib/types";
import { currentBranch } from "@/lib/derive";

/**
 * One side of a comparison.
 *
 * `rev` is any revspec — a branch, a remote branch, a tag, an oid. It is kept
 * as the SPEC the user picked rather than a resolved oid, so the header keeps
 * reading `main` instead of `a1b2c3d`, and a re-read after a fetch follows the
 * ref rather than pinning the commit it happened to point at.
 */
export type CompareSide =
  | { kind: "rev"; rev: string }
  | { kind: "workdir" };

/** The working tree is a RIGHT side only — see `swapSides`. */
export const WORKDIR: CompareSide = { kind: "workdir" };

export const WORKDIR_LABEL = "Working tree";

/** How many commits each of the two lists loads. The counts above them come
 *  from `aheadBehind`, which is exact regardless of this cap. */
export const COMPARE_COMMIT_LIMIT = 200;

export function sideLabel(side: CompareSide): string {
  return side.kind === "workdir" ? WORKDIR_LABEL : side.rev;
}

/**
 * Stable primitive for a React dependency array. The screen rebuilds side
 * objects every render, so depending on their identity would refetch forever.
 */
export function sideKey(side: CompareSide): string {
  return side.kind === "workdir" ? "workdir" : `rev:${side.rev}`;
}

/** `"main → feature/x"` — the same `from → to` direction `commit-vs-commit` reads. */
export function compareHeader(left: CompareSide, right: CompareSide): string {
  return `${sideLabel(left)} → ${sideLabel(right)}`;
}

/**
 * Only a rev↔rev pair has ancestry, so only that pair gets the ahead/behind
 * summary and the two commit lists. A working-tree side is not a commit: there
 * is nothing to count and nothing to walk, and rendering "0 commits ahead"
 * about it would be a lie dressed as a fact.
 */
export function hasCommitLists(
  left: CompareSide,
  right: CompareSide,
): left is { kind: "rev"; rev: string } {
  return left.kind === "rev" && right.kind === "rev";
}

/**
 * Swapping is refused when the working tree is involved: it cannot be a left
 * side, and silently producing a reversed patch instead is worse than doing
 * nothing.
 */
export function canSwap(left: CompareSide, right: CompareSide): boolean {
  return left.kind === "rev" && right.kind === "rev";
}

export function swapSides(
  left: CompareSide,
  right: CompareSide,
): { left: CompareSide; right: CompareSide } {
  if (!canSwap(left, right)) return { left, right };
  return { left: right, right: left };
}

/**
 * The left side to open on when nothing was named: the current branch, or
 * `HEAD` when detached / unborn. Pure so the screen carries no fallback logic.
 */
export function defaultLeftSide(branches: BranchInfo[]): CompareSide {
  const head = currentBranch(branches);
  return { kind: "rev", rev: head?.name ?? "HEAD" };
}

/**
 * Heading for one of the two commit lists: "3 commits on `feature` not on
 * `main`". Singular/plural matters here — these are read as counts, not labels.
 */
export function commitListHeading(
  count: number,
  onSide: CompareSide,
  notOnSide: CompareSide,
): string {
  const noun = count === 1 ? "commit" : "commits";
  return `${count} ${noun} on ${sideLabel(onSide)} not on ${sideLabel(notOnSide)}`;
}
