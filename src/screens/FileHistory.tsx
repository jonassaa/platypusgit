import React from "react";
import { PGEmpty, PGSpinner } from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { fileHistory } from "@/lib/tauri";
import { appErrorMessage } from "@/lib/errors";
import type { CommitInfo } from "@/lib/types";

export function FileHistoryScreen() {
  const repo = useRepoStore((s) => s.current);
  const intent = useNavStore((s) => s.intent);
  const clearIntent = useNavStore((s) => s.clearIntent);

  const [path, setPath] = React.useState<string | null>(null);
  const [commits, setCommits] = React.useState<CommitInfo[]>([]);
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
      .then((c) => { if (!cancelled) setCommits(c); })
      .catch((e) => { if (!cancelled) setError(appErrorMessage(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [repo?.id, path]);

  if (!path) {
    return (
      <PGEmpty icon="history" title="No file selected">
        Right-click a file and choose "File history".
      </PGEmpty>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{
        padding: "8px 12px",
        borderBottom: "1px solid var(--border-0)",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-12)",
      }}>
        History — {path}
      </div>
      {loading && <div style={{ padding: 12 }}><PGSpinner /></div>}
      {error && <div style={{ padding: 12, color: "var(--git-removed)" }}>{error}</div>}
      {!loading && !error && commits.length === 0 && (
        <PGEmpty icon="history" title="No commits touched this file" />
      )}
      <div style={{ flex: 1, overflow: "auto" }}>
        {commits.map((c) => (
          <div key={c.oid} style={{
            display: "flex",
            gap: 10,
            padding: "6px 12px",
            borderBottom: "1px solid var(--border-0)",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-12)",
          }}>
            <span style={{ color: "var(--fg-3)" }}>{c.shortOid}</span>
            <span style={{ flex: 1 }}>{c.summary}</span>
            <span style={{ color: "var(--fg-3)" }}>{c.author}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
