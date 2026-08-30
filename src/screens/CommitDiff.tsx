import React from "react";
import { PGEmpty } from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { CommitDiffPanel } from "@/features/diff/CommitDiffPanel";
import { useIgnoreWhitespace } from "@/features/diff/WhitespaceToggle";
import { DeepViewHeader } from "@/features/nav/DeepViewHeader";
import { diffCommit, diffCommits, diffRefToWorkdir, stashDiff } from "@/lib/tauri";
import { appErrorMessage } from "@/lib/errors";
import type { DiffToolTarget, FileDiff } from "@/lib/types";
import type { SideSource } from "@/lib/syntax/useDiffSyntax";

/**
 * A stash target carries the entry's own facts (#133) — see `NavIntent`.
 * `label` is display only; `oid` is what every fetch addresses.
 */
type StashTarget = { oid: string; label: string; untracked: boolean };

type Target =
  | { kind: "commit-self"; oid: string }
  | { kind: "commit-vs-wt"; oid: string }
  | { kind: "commit-vs-commit"; from: string; to: string }
  | ({ kind: "stash-diff" } & StashTarget)
  | ({ kind: "stash-vs-wt" } & StashTarget);

function targetHeader(target: Target): string {
  switch (target.kind) {
    case "commit-self":
      return `${target.oid.slice(0, 7)} (this commit)`;
    case "commit-vs-wt":
      return `${target.oid.slice(0, 7)} → HEAD`;
    // Parent → stash, so the stashed work reads as additions. It used to be
    // `stash → HEAD`, which was wrong on both counts: HEAD is not the stash's
    // base, and the stash was on the FROM side.
    case "stash-diff":
      return `${target.label} (what it changed)`;
    case "stash-vs-wt":
      return `${target.label} → working tree`;
    case "commit-vs-commit":
      return `${target.from.slice(0, 7)} → ${target.to.slice(0, 7)}`;
  }
}

/**
 * The pair `useDiffSyntax` colours from, mirroring the fetch above.
 *
 * A commit's own diff is against its parent (`^` — it simply fails and renders
 * plain on a root commit, where there is no old side anyway). A stash's pair is
 * its own first parent → itself, the same sides `stash_diff` uses. The
 * working-tree target's new side is the tree on disk, which is a `worktree`
 * source rather than a rev.
 */
function syntaxSidesFor(
  target: Target,
  repoId: string,
): { repoId: string; old: SideSource; new: SideSource } {
  switch (target.kind) {
    case "commit-self":
    case "stash-diff":
      return {
        repoId,
        old: { kind: "rev", rev: `${target.oid}^` },
        new: { kind: "rev", rev: target.oid },
      };
    case "stash-vs-wt":
      return {
        repoId,
        old: { kind: "rev", rev: target.oid },
        new: { kind: "worktree" },
      };
    case "commit-vs-commit":
      return {
        repoId,
        old: { kind: "rev", rev: target.from },
        new: { kind: "rev", rev: target.to },
      };
    case "commit-vs-wt":
      return {
        repoId,
        old: { kind: "rev", rev: target.oid },
        new: { kind: "rev", rev: "HEAD" },
      };
  }
}

/**
 * The same two sides again, for `git difftool` (#235).
 *
 * A separate function from `syntaxSidesFor` rather than a translation of it,
 * and the reason is `commit-self`: `syntaxSidesFor` says `<oid>^`, which is
 * allowed to fail — a root commit simply renders plain. `git difftool` cannot
 * be given that. `<oid>^` errors, and `<oid>^!` silently diffs the commit
 * against the WORKING TREE. So the commit targets pass `commit` and let the
 * backend resolve the parent (or the empty tree at a root).
 *
 * `stash-diff` is the same shape — a stash IS a commit, and its first parent is
 * the base it was taken from, which is the pair `git stash show` uses. Its
 * untracked payload lives on a third parent that `git difftool` will not reach,
 * so an untracked file in the stash opens empty; the screen already says the
 * untracked files are included, and the alternative is no entry at all on a
 * surface where most rows work.
 */
function difftoolTargetFor(target: Target): DiffToolTarget {
  switch (target.kind) {
    case "commit-self":
    case "stash-diff":
      return { kind: "commit", oid: target.oid };
    case "stash-vs-wt":
      return { kind: "revToWorktree", rev: target.oid };
    case "commit-vs-commit":
      return { kind: "range", from: target.from, to: target.to };
    case "commit-vs-wt":
      // Not `revToWorktree`: this target diffs the commit against HEAD, which
      // is what the fetch above does too. The header says so.
      return { kind: "range", from: target.oid, to: "HEAD" };
  }
}

/**
 * What a stash target does about the `git stash -u` third parent, said out
 * loud rather than left to be inferred from the file list.
 *
 * The two targets genuinely differ. `stash-diff` can reach that parent's tree,
 * so it includes it. `stash-vs-wt` cannot — the untracked payload is not in the
 * tree `diff_ref_to_workdir` resolves, whatever its own flag says — and turning
 * the workdir flag on instead would fill the view with *worktree* untracked
 * files, which are noise about the working tree rather than facts about the
 * stash. So both sides are excluded there, and it says so.
 */
function untrackedNote(target: Target): string | null {
  if (target.kind === "stash-diff") {
    return target.untracked ? "includes the stashed untracked files" : null;
  }
  if (target.kind === "stash-vs-wt") {
    return "untracked files excluded on both sides";
  }
  return null;
}

export function CommitDiffScreen() {
  const repo = useRepoStore((s) => s.current);
  const diffContextLines = useSettingsStore((s) => s.diffContextLines);
  const ignoreWhitespace = useIgnoreWhitespace();
  const intent = useNavStore((s) => s.intent);
  const clearIntent = useNavStore((s) => s.clearIntent);

  const [target, setTarget] = React.useState<Target | null>(null);
  const [diffs, setDiffs] = React.useState<FileDiff[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (intent?.kind === "commit-self") {
      setTarget({ kind: "commit-self", oid: intent.oid });
      clearIntent();
    } else if (intent?.kind === "commit-vs-wt") {
      setTarget({ kind: "commit-vs-wt", oid: intent.oid });
      clearIntent();
    } else if (intent?.kind === "commit-vs-commit") {
      setTarget({ kind: "commit-vs-commit", from: intent.from, to: intent.to });
      clearIntent();
    } else if (intent?.kind === "stash-diff" || intent?.kind === "stash-vs-wt") {
      setTarget({
        kind: intent.kind,
        oid: intent.oid,
        label: intent.label,
        untracked: intent.untracked,
      });
      clearIntent();
    }
  }, [intent, clearIntent]);

  React.useEffect(() => {
    if (!repo || !target) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const fetch: Promise<FileDiff[]> =
      target.kind === "commit-self"
        ? diffCommit(repo.id, target.oid, diffContextLines, ignoreWhitespace)
        : target.kind === "stash-diff"
          ? // Its own first parent, resolved in the backend — NOT `diffCommits`
            // against HEAD, which mixed the stash with everything landed since.
            stashDiff(repo.id, target.oid, diffContextLines, ignoreWhitespace, true)
          : target.kind === "stash-vs-wt"
            ? // The shared #131 primitive, reused rather than duplicated. The
              // untracked flag is off — see `untrackedNote`.
              diffRefToWorkdir(
                repo.id,
                target.oid,
                diffContextLines,
                ignoreWhitespace,
                false,
              ).then((d) => d.files)
            : diffCommits(
                repo.id,
                target.kind === "commit-vs-commit" ? target.from : target.oid,
                target.kind === "commit-vs-commit" ? target.to : "HEAD",
                diffContextLines,
                ignoreWhitespace,
              );
    fetch
      .then((d) => { if (!cancelled) setDiffs(d); })
      .catch((e) => { if (!cancelled) { setDiffs([]); setError(appErrorMessage(e)); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [repo?.id, target, diffContextLines, ignoreWhitespace]);

  if (!target) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <DeepViewHeader crumbs={["Commit diff"]} />
        <PGEmpty icon="diff" title="No diff target">
          Pick &quot;Compare…&quot; from a context menu.
        </PGEmpty>
      </div>
    );
  }

  const note = untrackedNote(target);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <DeepViewHeader crumbs={[`Diff ${targetHeader(target)}`]} />
      {note && (
        <div
          data-testid="commit-diff-note"
          style={{
            padding: "4px 12px",
            fontSize: 11,
            color: "var(--fg-3)",
            borderBottom: "1px solid var(--border-0)",
            flexShrink: 0,
          }}
        >
          {note}
        </div>
      )}
      <CommitDiffPanel
        diffs={diffs}
        loading={loading}
        error={error}
        header={targetHeader(target)}
        paneIdPrefix="commitDiff"
        emptyLabel={
          target.kind === "commit-self" ? "No changes in this commit." : "No changes."
        }
        // Only a single commit has a signature — a range or a commit-vs-worktree
        // comparison does not (#61 D6).
        verifyOid={target.kind === "commit-self" ? target.oid : undefined}
        syntaxSides={repo ? syntaxSidesFor(target, repo.id) : undefined}
        difftoolTarget={difftoolTargetFor(target)}
      />
    </div>
  );
}
