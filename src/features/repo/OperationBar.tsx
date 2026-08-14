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
import { currentBranch, isConflicted } from "@/lib/derive";
import type { RepoState } from "@/lib/types";

/** What the user thinks they are doing, collapsed from libgit2's state enum. */
type OpKind = "merge" | "rebase" | "cherryPick" | "revert" | "opaque";

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
    // Bisect and the mailbox states are in-progress too, and saying so is the
    // point — but neither is finished by committing the index, so they get the
    // label and abort, nothing else.
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
  opaque: "info",
};

export function OperationBar() {
  const repo = useRepoStore((s) => s.current);
  const repoState = useRepoStore((s) => s.repoState);
  const status = useRepoStore((s) => s.status);
  const branches = useRepoStore((s) => s.branches);
  const rebaseStatus = useRepoStore((s) => s.rebaseStatus);

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
