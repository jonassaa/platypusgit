// What a shallow or single-branch clone means on the screen you are looking at
// (#255) — the PURE half.
//
// A shallow clone does not fail. It answers every question it is asked, with a
// truncated graph, and nothing about the result looks wrong: history is short,
// blame stops, a merge base is missing, a branch is absent. Each of those reads
// as a repository with a strange past rather than as a repository that is only
// partly here — which is why the sentence has to be per surface. "This is a
// shallow clone" on a blame screen does not tell the reader what is wrong with
// the blame in front of them.
//
// Pure and separate so every sentence is testable without rendering anything.

import type { ShallowInfo } from "@/lib/types";

/** The surfaces a truncated clone visibly distorts. */
export type ShallowSurface = "history" | "fileHistory" | "blame" | "compare";

export interface ShallowNoticeText {
  /** The one-line claim. Always names the cause, never just the symptom. */
  headline: string;
  /** What it costs on THIS surface. */
  detail: string;
  /**
   * Whether `git fetch --unshallow` is the remedy for what the notice says.
   *
   * False for a single-branch clone that is otherwise complete: unshallowing
   * fetches history, not branches, so offering the button there would be a
   * button that runs and changes nothing the reader complained about.
   */
  canUnshallow: boolean;
}

/**
 * How many commits history stops at, spelled for a sentence. Absent when the
 * count could not be read — `shallow` is still true, and a wrong number is
 * worse than no number.
 */
function boundaryPhrase(count: number): string {
  if (count <= 0) return "";
  return count === 1
    ? " History stops at 1 commit."
    : ` History stops at ${count} commits.`;
}

/**
 * The notice for `surface`, or `null` when nothing is missing.
 *
 * Shallow outranks single-branch when both are true: the truncated history is
 * the bigger distortion and the one with a remedy, and two strips stacked on
 * one screen is how a warning stops being read. The single-branch fact is
 * folded into the shallow detail instead.
 */
export function shallowNoticeText(
  info: ShallowInfo,
  surface: ShallowSurface,
): ShallowNoticeText | null {
  if (info.shallow) {
    return {
      headline: `Shallow clone — this repository is only partly here.${boundaryPhrase(
        info.boundaryCount,
      )}`,
      detail: SHALLOW_DETAIL[surface],
      canUnshallow: true,
    };
  }
  if (info.singleBranch) {
    return {
      headline: "Single-branch clone — only one branch was fetched.",
      detail: SINGLE_BRANCH_DETAIL[surface],
      canUnshallow: false,
    };
  }
  return null;
}

const SHALLOW_DETAIL: Record<ShallowSurface, string> = {
  history:
    "Older commits were never fetched, so the log ends where the clone did — not where the project did.",
  fileHistory:
    "This file's history ends at the shallow boundary; earlier changes to it were never fetched.",
  blame:
    "Every line older than the shallow boundary is attributed to the oldest commit present, not to whoever wrote it.",
  compare:
    "A merge base older than the shallow boundary is not in this clone, so the ahead/behind counts can be wrong.",
};

const SINGLE_BRANCH_DETAIL: Record<ShallowSurface, string> = {
  history:
    "Commits that live only on another branch are not in this clone, whatever scope you pick.",
  fileHistory:
    "Changes made to this file on another branch are not in this clone.",
  blame: "A line last touched on another branch is blamed on whatever merged it here.",
  compare:
    "The other side may simply not be here — a ref this clone never fetched cannot be compared against.",
};
