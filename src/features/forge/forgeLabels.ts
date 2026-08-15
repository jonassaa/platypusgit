// Pure derivations for the forge feature (#92). No store, no IPC — so the rules
// the UI depends on are unit-testable and cannot be restated inconsistently in
// two components.

import type { ChecksState, ForgeKind, PullRequest } from "@/lib/types";

/** Display name of a forge. */
export function forgeLabel(kind: ForgeKind): string {
  return kind === "GitHub" ? "GitHub" : "GitLab";
}

/**
 * What the forge calls the thing, singular. GitHub says "pull request", GitLab
 * says "merge request", and using the wrong word makes the app look like it does
 * not know which forge it is talking to.
 */
export function prNoun(kind: ForgeKind | null): string {
  return kind === "GitLab" ? "merge request" : "pull request";
}

export function prNounPlural(kind: ForgeKind | null): string {
  return `${prNoun(kind)}s`;
}

/** The abbreviation, for a number prefix (`PR #12` / `MR !12`). */
export function prAbbrev(kind: ForgeKind | null): string {
  return kind === "GitLab" ? "MR" : "PR";
}

/**
 * How the forge writes a request's number. GitLab uses `!` for merge requests
 * (`#` is an issue there), GitHub uses `#`.
 */
export function prNumberLabel(kind: ForgeKind | null, number: number): string {
  return kind === "GitLab" ? `!${number}` : `#${number}`;
}

/**
 * Local branch name for checking out `pr`.
 *
 * A same-repo request keeps its own branch name — that is the name the author
 * pushed and the one everyone refers to. A **fork** request must not: a fork's
 * `main` (or `master`, or `develop`) landing on your `main` is silent data loss
 * waiting to happen, so a cross-repo request gets a numbered branch instead.
 */
export function localBranchFor(pr: PullRequest, kind: ForgeKind): string {
  if (!pr.crossRepo) return pr.sourceBranch;
  return `${kind === "GitLab" ? "mr" : "pr"}-${pr.number}`;
}

/** Design-token colour for a CI verdict. */
export function checksTone(state: ChecksState): string {
  switch (state) {
    case "Success":
      return "var(--git-added)";
    case "Failure":
      return "var(--git-removed)";
    case "Pending":
      return "var(--git-modified)";
    default:
      return "var(--fg-3)";
  }
}

/** Icon name for a CI verdict. All already in the design-system icon set. */
export function checksIcon(state: ChecksState): string {
  switch (state) {
    case "Success":
      return "check";
    case "Failure":
      return "error";
    case "Pending":
      return "clock";
    default:
      return "circle";
  }
}

/**
 * Title for a `New pull request` form, given the branch it would come from.
 * Derived from the branch name so the common case needs no typing: a leading
 * `feat/`-style prefix goes, dashes and underscores become spaces.
 */
export function titleFromBranch(branch: string): string {
  const tail = branch.includes("/")
    ? branch.slice(branch.lastIndexOf("/") + 1)
    : branch;
  const words = tail.replace(/[-_]+/g, " ").trim();
  if (!words) return branch;
  return words.charAt(0).toUpperCase() + words.slice(1);
}
