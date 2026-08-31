// What to do about one filesystem event (#239).
//
// Pure and separate from the subscription so the three ways this can be wrong
// are testable without a Tauri event bus: refreshing for the wrong repository,
// refreshing while an operation is mid-flight, and repainting history for a
// file save.

import type { FsChange } from "@/lib/types";

/** How much of the repository state one event asks to be re-read. */
export type FsRefresh = "none" | "status" | "all";

export interface FsPlanInput {
  change: FsChange;
  /** The active tab's repository id, or null when nothing is open. */
  currentRepoId: string | null;
  /**
   * Whether a long-running operation owns the repository right now
   * (`RepoActivity` is non-empty).
   */
  busy: boolean;
  /** Whether the user has the watcher switched on. */
  enabled: boolean;
}

/**
 * The refresh one event earns.
 *
 * Four reasons to do nothing, and each is a bug if it is missing:
 *
 * - **The setting is off.** The backend watch is stopped too, but an event
 *   already in flight when it stopped must not sneak a refresh through.
 * - **No repository is open.** Nothing to refresh into.
 * - **A different repository.** `useRepoStore` holds exactly ONE repository's
 *   state — the active tab's — so applying another tab's event would write its
 *   status over the open one. The backend watches only the active repo, but an
 *   event can already be in flight when the tab switches, which is precisely
 *   why the payload carries `repoId`.
 * - **An operation is in flight.** A rebase or a merge writes to `.git/` in a
 *   storm, and a refresh landing mid-transition can read a half-applied state.
 *   Skipping is safe rather than lossy: every operation refreshes on
 *   completion anyway, so the final state is never missed — only the flicker
 *   of intermediate ones.
 */
export function fsRefreshPlan({
  change,
  currentRepoId,
  busy,
  enabled,
}: FsPlanInput): FsRefresh {
  if (!enabled) return "none";
  if (!currentRepoId) return "none";
  if (change.repoId !== currentRepoId) return "none";
  if (busy) return "none";
  return change.refsMoved ? "all" : "status";
}

/**
 * Fold two pending refreshes into the one that covers both.
 *
 * Events arrive faster than a refresh completes on a big repository, so the
 * second one waits — and it must not downgrade the first. A `status` arriving
 * behind an `all` still needs the log re-read.
 */
export function mergeRefresh(a: FsRefresh, b: FsRefresh): FsRefresh {
  if (a === "all" || b === "all") return "all";
  if (a === "status" || b === "status") return "status";
  return "none";
}
