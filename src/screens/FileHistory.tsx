import React from "react";
import { PGEmpty, PGSpinner } from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { fileHistory } from "@/lib/tauri";
import { appErrorMessage } from "@/lib/errors";
import { DeepViewHeader } from "@/features/nav/DeepViewHeader";
import { PGPane, FocusableScroll, usePaneList } from "@/features/keymap";
import type { CommitInfo } from "@/lib/types";

export function FileHistoryScreen() {
  const repo = useRepoStore((s) => s.current);
  const intent = useNavStore((s) => s.intent);
  const clearIntent = useNavStore((s) => s.clearIntent);
  const setNavIntent = useNavStore((s) => s.setIntent);

  const [path, setPath] = React.useState<string | null>(null);
  const [commits, setCommits] = React.useState<CommitInfo[]>([]);
  const [selected, setSelected] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (intent?.kind === "file-history") {
      setPath(intent.path);
      clearIntent();
    }
  }, [intent, clearIntent]);

  React.useEffect(() => {
    if (!repo || !path) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fileHistory(repo.id, path)
      .then((c) => { if (!cancelled) { setCommits(c); setSelected(0); } })
      .catch((e) => { if (!cancelled) setError(appErrorMessage(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [repo?.id, path]);

  // Keyboard: arrows move the commit selection, Enter opens the commit's diff.
  usePaneList({
    paneId: "fileHistory.list",
    count: commits.length,
    selectedIndex: selected,
    onSelect: setSelected,
    onActivate: (i) => {
      const c = commits[i];
      if (c) setNavIntent({ kind: "commit-vs-wt", oid: c.oid });
    },
    searchText: (i) => commits[i]?.summary ?? "",
  });

  if (!path) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <DeepViewHeader crumbs={["File history"]} />
        <PGEmpty icon="history" title="No file selected">
          Right-click a file and choose "File history".
        </PGEmpty>
      </div>
    );
  }

  return (
    <PGPane id="fileHistory.list" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <DeepViewHeader crumbs={[`History — ${path}`]} />
      {loading && <div style={{ padding: 12 }}><PGSpinner /></div>}
      {error && <div style={{ padding: 12, color: "var(--git-removed)" }}>{error}</div>}
      {!loading && !error && commits.length === 0 && (
        <PGEmpty icon="history" title="No commits touched this file" />
      )}
      <FocusableScroll style={{ flex: 1 }}>
        {commits.map((c, i) => (
          <div
            key={c.oid}
            onClick={() => setSelected(i)}
            data-pg-row=""
            data-selected={selected === i ? "" : undefined}
            style={{
              display: "flex",
              gap: 10,
              padding: "6px 12px",
              borderBottom: "1px solid var(--border-0)",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-12)",
              cursor: "pointer",
            }}
          >
            <span style={{ color: "var(--fg-3)" }}>{c.shortOid}</span>
            <span style={{ flex: 1 }}>{c.summary}</span>
            <span style={{ color: "var(--fg-3)" }}>{c.author}</span>
          </div>
        ))}
      </FocusableScroll>
    </PGPane>
  );
}
