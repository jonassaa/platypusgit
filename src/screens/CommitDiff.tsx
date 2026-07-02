import React from "react";
import { PGEmpty, PGSpinner } from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { diffCommits } from "@/lib/tauri";
import { appErrorMessage } from "@/lib/errors";
import { PGPane, FocusableScroll, usePaneList } from "@/features/keymap";
import type { FileDiff } from "@/lib/types";

type Target =
  | { kind: "commit-vs-wt"; oid: string }
  | { kind: "commit-vs-commit"; from: string; to: string }
  | { kind: "stash-diff"; oid: string };

export function CommitDiffScreen() {
  const repo = useRepoStore((s) => s.current);
  const intent = useNavStore((s) => s.intent);
  const clearIntent = useNavStore((s) => s.clearIntent);

  const [target, setTarget] = React.useState<Target | null>(null);
  const [diffs, setDiffs] = React.useState<FileDiff[]>([]);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (intent?.kind === "commit-vs-wt") {
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
    const [from, to] =
      target.kind === "commit-vs-wt" || target.kind === "stash-diff"
        ? [target.oid, "HEAD"]
        : [target.from, target.to];
    let cancelled = false;
    setLoading(true);
    setError(null);
    diffCommits(repo.id, from, to)
      .then((d) => { if (!cancelled) { setDiffs(d); setSelected(d[0]?.path ?? null); } })
      .catch((e) => { if (!cancelled) setError(appErrorMessage(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [repo?.id, target]);

  // Keyboard: arrows move the file selection while the list pane is focused.
  const selectedIndex = Math.max(0, diffs.findIndex((d) => d.path === selected));
  usePaneList({
    paneId: "commitDiff.files",
    count: diffs.length,
    selectedIndex,
    onSelect: (i) => {
      const d = diffs[i];
      if (d) setSelected(d.path);
    },
  });

  if (!target) {
    return <PGEmpty icon="diff" title="No diff target">Pick "Compare…" from a context menu.</PGEmpty>;
  }

  const current = diffs.find((d) => d.path === selected) ?? null;

  return (
    <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
      <PGPane id="commitDiff.files" style={{
        width: 260,
        borderRight: "1px solid var(--border-0)",
        fontFamily: "var(--font-mono)", fontSize: "var(--fs-12)",
      }}>
        <FocusableScroll style={{ height: "100%" }} ariaLabel="Changed files">
        <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border-0)" }}>
          {target.kind === "commit-vs-wt"
            ? `${target.oid.slice(0, 7)} → HEAD`
            : target.kind === "stash-diff"
            ? `stash ${target.oid.slice(0, 7)} → HEAD`
            : `${target.from.slice(0, 7)} → ${target.to.slice(0, 7)}`}
        </div>
        {loading && <div style={{ padding: 12 }}><PGSpinner /></div>}
        {error && <div style={{ padding: 12, color: "var(--git-removed)" }}>{error}</div>}
        {diffs.map((d) => (
          <div
            key={d.path}
            onClick={() => setSelected(d.path)}
            data-pg-row=""
            data-selected={d.path === selected ? "" : undefined}
            style={{
              padding: "4px 12px",
              cursor: "pointer",
            }}
          >
            {d.path}
          </div>
        ))}
        </FocusableScroll>
      </PGPane>
      <PGPane id="commitDiff.view" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
      <FocusableScroll style={{ flex: 1, padding: 12 }} ariaLabel="Diff">
        {current && current.hunks.map((h, i) => (
          <div key={i} style={{ marginBottom: 16 }}>
            <div style={{ color: "var(--fg-3)", fontFamily: "var(--font-mono)", fontSize: "var(--fs-12)" }}>
              {h.header}
            </div>
            {h.lines.map((ln, j) => (
              <div key={j} style={{
                fontFamily: "var(--font-mono)", fontSize: "var(--fs-12)",
                whiteSpace: "pre",
                color: ln.kind.kind === "Addition" ? "var(--git-added)" :
                       ln.kind.kind === "Deletion" ? "var(--git-removed)" : "var(--fg-0)",
              }}>
                {ln.kind.kind === "Addition" ? "+" : ln.kind.kind === "Deletion" ? "-" : " "}
                {ln.content}
              </div>
            ))}
          </div>
        ))}
      </FocusableScroll>
      </PGPane>
    </div>
  );
}
