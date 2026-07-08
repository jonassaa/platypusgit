import React from "react";
import { PGEmpty } from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { CommitDiffPanel } from "@/features/diff/CommitDiffPanel";
import { DeepViewHeader } from "@/features/nav/DeepViewHeader";
import { diffCommit, diffCommits } from "@/lib/tauri";
import { appErrorMessage } from "@/lib/errors";
import type { FileDiff } from "@/lib/types";

type Target =
  | { kind: "commit-self"; oid: string }
  | { kind: "commit-vs-wt"; oid: string }
  | { kind: "commit-vs-commit"; from: string; to: string }
  | { kind: "stash-diff"; oid: string };

function targetHeader(target: Target): string {
  switch (target.kind) {
    case "commit-self":
      return `${target.oid.slice(0, 7)} (this commit)`;
    case "commit-vs-wt":
      return `${target.oid.slice(0, 7)} → HEAD`;
    case "stash-diff":
      return `stash ${target.oid.slice(0, 7)} → HEAD`;
    case "commit-vs-commit":
      return `${target.from.slice(0, 7)} → ${target.to.slice(0, 7)}`;
  }
}

export function CommitDiffScreen() {
  const repo = useRepoStore((s) => s.current);
  const diffContextLines = useSettingsStore((s) => s.diffContextLines);
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
    } else if (intent?.kind === "stash-diff") {
      setTarget({ kind: "stash-diff", oid: intent.oid });
      clearIntent();
    }
  }, [intent, clearIntent]);

  React.useEffect(() => {
    if (!repo || !target) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const fetch =
      target.kind === "commit-self"
        ? diffCommit(repo.id, target.oid, diffContextLines)
        : diffCommits(
            repo.id,
            target.kind === "commit-vs-commit" ? target.from : target.oid,
            target.kind === "commit-vs-commit" ? target.to : "HEAD",
            diffContextLines,
          );
    fetch
      .then((d) => { if (!cancelled) setDiffs(d); })
      .catch((e) => { if (!cancelled) { setDiffs([]); setError(appErrorMessage(e)); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [repo?.id, target, diffContextLines]);

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

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <DeepViewHeader crumbs={[`Diff ${targetHeader(target)}`]} />
      <CommitDiffPanel
        diffs={diffs}
        loading={loading}
        error={error}
        header={targetHeader(target)}
        paneIdPrefix="commitDiff"
        emptyLabel={
          target.kind === "commit-self" ? "No changes in this commit." : "No changes."
        }
      />
    </div>
  );
}
