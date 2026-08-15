// The app's standing signal that a git operation is open (#108).
//
// Driven by `repoState`, which is on-disk truth (`git2::Repository::state()`) —
// unlike the error banner, which is dismissible, one-shot and gone after a
// restart. A merge you left conflicted yesterday still says so today.
//
// Chrome, so its geometry is fixed: no `--row-step`.

import React from "react";
import { PGButton, PGIcon, pgConfirm } from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { openMergeWindow } from "@/features/merge/openMergeWindow";
import { currentBranch, isConflicted, shortSha } from "@/lib/derive";
import type { BisectStatus, RepoState } from "@/lib/types";

/** What the user thinks they are doing, collapsed from libgit2's state enum. */
type OpKind = "merge" | "rebase" | "cherryPick" | "revert" | "bisect" | "opaque";

function opKind(state: RepoState): OpKind | null {
  switch (state) {
    case "Clean":
      return null;
    case "Merge":
      return "merge";
    case "Rebase":
    case "RebaseInteractive":
    case "RebaseMerge":
      return "rebase";
    case "CherryPick":
    case "CherryPickSequence":
      return "cherryPick";
    case "Revert":
    case "RevertSequence":
      return "revert";
    // Its own kind since #93: a bisect is neither finished by committing the index
    // NOR ended by the generic Abort — `abort_operation` hard-resets to HEAD, and
    // mid-bisect HEAD is a detached test commit, so the one button the bar used to
    // offer for this state left the user worse off than doing nothing.
    case "Bisect":
      return "bisect";
    // The mailbox states are in-progress too, and saying so is the point — but
    // neither is finished by committing the index, so they get the label and
    // abort, nothing else.
    default:
      return "opaque";
  }
}

/** Names the state the user is actually in — `opKind` groups by what can be
 *  done about it, which is coarser than what it is worth saying. */
function opTitle(state: RepoState): string {
  switch (state) {
    case "Merge":
      return "Merge in progress";
    case "Rebase":
    case "RebaseInteractive":
    case "RebaseMerge":
      return "Rebase in progress";
    case "CherryPick":
    case "CherryPickSequence":
      return "Cherry-pick in progress";
    case "Revert":
    case "RevertSequence":
      return "Revert in progress";
    case "Bisect":
      return "Bisect in progress";
    case "ApplyMailbox":
    case "ApplyMailboxOrRebase":
      return "Patch application in progress";
    default:
      return "Operation in progress";
  }
}

const ICONS: Record<OpKind, string> = {
  merge: "merge",
  rebase: "rebase",
  cherryPick: "commit",
  revert: "undo",
  bisect: "bisect",
  opaque: "info",
};

/**
 * The bisect bar's detail line.
 *
 * Pure, and exported, because the copy is the whole feature: "4 revisions left ·
 * ~2 steps" is what makes a bisect feel finite, and once it converges the culprit
 * has to be NAMED rather than implied — git leaves HEAD on the last commit
 * *tested*, not on the first bad one, so a user reading the sha off the titlebar
 * would blame the wrong commit.
 */
export function bisectDetail(status: BisectStatus): string {
  if (status.firstBadOid) {
    return `first ${status.badTerm} commit ${shortSha(status.firstBadOid)} — HEAD is still on the last commit you tested`;
  }
  if (status.badCount === 0) {
    return `waiting for a ${status.badTerm} commit`;
  }
  if (status.goodCount === 0) {
    return `waiting for a ${status.goodTerm} commit`;
  }
  const parts: string[] = [];
  if (status.remaining !== null) {
    parts.push(
      `${status.remaining} revision${status.remaining === 1 ? "" : "s"} left`,
    );
  }
  if (status.steps !== null) {
    parts.push(`~${status.steps} step${status.steps === 1 ? "" : "s"}`);
  }
  if (status.skippedCount > 0) parts.push(`${status.skippedCount} skipped`);
  return parts.join(" · ");
}

export function OperationBar() {
  const repo = useRepoStore((s) => s.current);
  const repoState = useRepoStore((s) => s.repoState);
  const status = useRepoStore((s) => s.status);
  const branches = useRepoStore((s) => s.branches);
  const rebaseStatus = useRepoStore((s) => s.rebaseStatus);
  const bisect = useRepoStore((s) => s.bisectStatus);

  const conflicts = React.useMemo(
    () => status.filter(isConflicted).length,
    [status],
  );

  const kind = opKind(repoState);
  if (!repo || !kind) return null;

  const head = currentBranch(branches);
  // Mid-rebase HEAD is detached, so there is often no branch to name — say
  // less rather than "(detached)", which reads as a problem when it is normal.
  const title = head ? `${opTitle(repoState)} on ${head.name}` : opTitle(repoState);

  // Bisect gets the whole bar: its actions are neither "resolve" nor "finalize",
  // and its Abort would be actively wrong (see `opKind`).
  if (kind === "bisect") {
    return <BisectBar title={title} status={bisect} />;
  }

  const detailParts: string[] = [];
  if (conflicts > 0) {
    detailParts.push(`${conflicts} conflict${conflicts !== 1 ? "s" : ""} to resolve`);
  } else if (kind !== "opaque") {
    detailParts.push("no conflicts left");
  }
  // `rebase_status` is an in-process map filled by the app's own interactive
  // rebase, so a step counter exists only for that kind — never for a `git
  // rebase` we shelled out, and never after a restart.
  if (rebaseStatus.inProgress && rebaseStatus.total > 0) {
    detailParts.push(`step ${rebaseStatus.nextIndex + 1} of ${rebaseStatus.total}`);
  }

  const alarm = conflicts > 0;
  const tint = alarm ? "var(--git-conflict)" : "var(--accent)";

  return (
    <div
      data-testid="operation-bar"
      data-op={repoState}
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 14px",
        background: `oklch(from ${tint} l c h / 0.12)`,
        borderBottom: `1px solid oklch(from ${tint} l c h / 0.4)`,
        flexShrink: 0,
      }}
    >
      <span style={{ color: tint, display: "flex", alignItems: "center" }}>
        <PGIcon name={alarm ? "conflict" : ICONS[kind]} size={14} />
      </span>
      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", gap: 8 }}>
        <span
          data-testid="operation-title"
          style={{ fontSize: "var(--fs-12)", fontWeight: 600 }}
        >
          {title}
        </span>
        {detailParts.length > 0 && (
          <span
            data-testid="operation-detail"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-11)",
              color: "var(--fg-2)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {detailParts.join(" · ")}
          </span>
        )}
      </div>

      {conflicts > 0 ? (
        <PGButton
          size="sm"
          variant="primary"
          icon="merge"
          data-testid="operation-resolve"
          onClick={() => void openMergeWindow(repo.id)}
        >
          Resolve conflicts
        </PGButton>
      ) : (
        kind !== "opaque" && (
          <PGButton
            size="sm"
            variant="primary"
            icon="check"
            data-testid="operation-continue"
            onClick={() => void useRepoStore.getState().continueOperation()}
          >
            {/* A rebase has steps after this one; a merge does not. */}
            {kind === "rebase" ? "Continue" : "Finalize"}
          </PGButton>
        )
      )}
      <PGButton
        size="sm"
        variant="ghost"
        tone="danger"
        icon="x"
        data-testid="operation-abort"
        onClick={async () => {
          if (
            await pgConfirm({
              title: "Abort the current operation?",
              body: "Conflict resolutions are discarded and the repository returns to where the operation started.",
              danger: true,
              confirmLabel: "Abort",
            })
          )
            void useRepoStore.getState().abortOperation();
        }}
      >
        Abort
      </PGButton>
    </div>
  );
}

/**
 * The bisect bar (#93). Same chrome as the generic bar — fixed geometry, no
 * `--row-step` — but a different action set:
 *
 * * **Good / Bad / Skip** mark the revision git checked out for testing. They are
 *   the loop, so they are the primary controls.
 * * **Reset** replaces the generic Abort. `abort_operation` hard-resets to HEAD,
 *   which mid-bisect is a detached test commit; `git bisect reset` returns to
 *   `BISECT_START`. That is the whole reason bisect is its own `OpKind`.
 *
 * Once the search converges the marks go away — there is nothing left to test —
 * and only Reset remains, next to the named culprit.
 */
function BisectBar({ title, status }: { title: string; status: BisectStatus }) {
  const store = useRepoStore.getState();
  const converged = !!status.firstBadOid;
  const tint = converged ? "var(--git-added)" : "var(--accent)";

  return (
    <div
      data-testid="operation-bar"
      data-op="Bisect"
      data-bisect-converged={converged ? "1" : "0"}
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 14px",
        background: `oklch(from ${tint} l c h / 0.12)`,
        borderBottom: `1px solid oklch(from ${tint} l c h / 0.4)`,
        flexShrink: 0,
      }}
    >
      <span style={{ color: tint, display: "flex", alignItems: "center" }}>
        <PGIcon name={converged ? "check" : "bisect"} size={14} />
      </span>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "baseline",
          gap: 8,
        }}
      >
        <span
          data-testid="operation-title"
          style={{ fontSize: "var(--fs-12)", fontWeight: 600 }}
        >
          {title}
        </span>
        <span
          data-testid="operation-detail"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-11)",
            color: "var(--fg-2)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {bisectDetail(status)}
        </span>
      </div>

      {!converged && (
        <>
          {/* Labels follow the repository's own terms, so a bisect started with
              --term-old/--term-new reads correctly instead of saying "good" while
              writing a `works` ref. */}
          <PGButton
            size="sm"
            variant="primary"
            icon="check"
            data-testid="bisect-good"
            onClick={() => void store.bisectMark("Good")}
          >
            {status.goodTerm}
          </PGButton>
          <PGButton
            size="sm"
            variant="default"
            tone="danger"
            icon="warn"
            data-testid="bisect-bad"
            onClick={() => void store.bisectMark("Bad")}
          >
            {status.badTerm}
          </PGButton>
          <PGButton
            size="sm"
            variant="ghost"
            icon="chevronRight"
            data-testid="bisect-skip"
            title="Cannot test this revision — let git pick another"
            onClick={() => void store.bisectMark("Skip")}
          >
            Skip
          </PGButton>
        </>
      )}
      <PGButton
        size="sm"
        variant={converged ? "primary" : "ghost"}
        icon="undo"
        data-testid="bisect-reset"
        title={
          status.startRef
            ? `Return to ${status.startRef}`
            : "Return to where the bisect started"
        }
        onClick={async () => {
          if (
            await pgConfirm({
              title: "End the bisect?",
              body: `Returns to ${status.startRef ?? "where the bisect started"} and forgets the good/bad marks.`,
              confirmLabel: "Reset",
            })
          )
            void useRepoStore.getState().bisectReset();
        }}
      >
        Reset
      </PGButton>
    </div>
  );
}
