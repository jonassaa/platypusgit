import React from "react";
import {
  PGButton,
  PGCommitRow,
  PGEmpty,
  PGIconButton,
  PGToolbar,
  PGSpinner,
} from "@/design";
import { useReflogStore } from "@/features/reflog/useReflogStore";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { relativeTime } from "@/lib/derive";
import type { FileDiff, ReflogEntry, ReflogOp } from "@/lib/types";

function opLabel(op: ReflogOp): string {
  switch (op.kind) {
    case "Commit":
      return "commit";
    case "Amend":
      return "amend";
    case "Reset":
      return "reset";
    case "Checkout":
      return "checkout";
    case "Merge":
      return "merge";
    case "Rebase":
      return "rebase";
    case "Pull":
      return "pull";
    case "Clone":
      return "clone";
    case "Other":
      return op.detail || "other";
  }
}

export function ReflogScreen() {
  const repo = useRepoStore((s) => s.current);
  const entries = useReflogStore((s) => s.entries);
  const selectedOid = useReflogStore((s) => s.selectedOid);
  const previewDiff = useReflogStore((s) => s.previewDiff);
  const previewLoading = useReflogStore((s) => s.previewLoading);
  const loading = useReflogStore((s) => s.loading);
  const loadReflog = useReflogStore((s) => s.loadReflog);
  const selectEntry = useReflogStore((s) => s.selectEntry);

  React.useEffect(() => {
    if (repo) void loadReflog();
  }, [repo, loadReflog]);

  const selectedEntry: ReflogEntry | null =
    entries.find((e) => e.oid === selectedOid) ?? null;

  if (!repo) {
    return (
      <PGEmpty title="No repository open">
        Open a repo to browse its reflog.
      </PGEmpty>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <PGToolbar
        right={
          <PGIconButton
            icon="refresh"
            size="sm"
            title="Refresh reflog"
            onClick={() => void loadReflog()}
          />
        }
      >
        <strong style={{ fontSize: "var(--fs-13)" }}>Reflog</strong>
      </PGToolbar>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <div
          style={{
            width: "35%",
            minWidth: 280,
            borderRight: "1px solid var(--border-0)",
            overflow: "auto",
          }}
        >
          {loading && (
            <div style={{ padding: 16 }}>
              <PGSpinner />
            </div>
          )}
          {!loading && entries.length === 0 && (
            <PGEmpty title="No reflog entries yet.">
              The reflog records HEAD movements. Make some commits or switch
              branches to see entries here.
            </PGEmpty>
          )}
          {entries.map((e) => (
            <PGCommitRow
              key={`${e.oid}-${e.timestamp}`}
              sha={e.shortOid}
              message={`${opLabel(e.op)}: ${e.message || "(no message)"}`}
              author=""
              date={relativeTime(e.timestamp)}
              selected={selectedOid === e.oid}
              onClick={() => void selectEntry(e.oid)}
            />
          ))}
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: 12 }}>
          {!selectedEntry && (
            <PGEmpty title="Pick an entry">
              Select a reflog entry on the left to preview where HEAD was at
              that point.
            </PGEmpty>
          )}
          {selectedEntry && (
            <div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontWeight: 600, fontSize: "var(--fs-13)" }}>
                  {opLabel(selectedEntry.op)}:{" "}
                  {selectedEntry.message || "(no message)"}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    color: "var(--fg-2)",
                    fontSize: "var(--fs-12)",
                    marginTop: 4,
                  }}
                >
                  {selectedEntry.oid} &middot;{" "}
                  {new Date(selectedEntry.timestamp * 1000).toLocaleString()}
                </div>
              </div>
              <PGButton disabled title="Wired up in task 14" onClick={() => {}}>
                Go to this point
              </PGButton>
              <div style={{ marginTop: 16 }}>
                {previewLoading && <PGSpinner />}
                {!previewLoading && previewDiff && (
                  <ReflogDiffSummary diff={previewDiff} />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ReflogDiffSummary({ diff }: { diff: FileDiff[] }) {
  if (diff.length === 0) {
    return (
      <div style={{ color: "var(--fg-2)" }}>
        No changes relative to current HEAD.
      </div>
    );
  }
  return (
    <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-12)" }}>
      <div style={{ marginBottom: 6, color: "var(--fg-2)" }}>
        {diff.length} file{diff.length === 1 ? "" : "s"} changed
      </div>
      {diff.map((f) => (
        <div key={f.path} style={{ display: "flex", gap: 8 }}>
          <span style={{ flex: 1 }}>{f.path}</span>
          <span style={{ color: "var(--git-added)" }}>+{f.additions}</span>
          <span style={{ color: "var(--git-removed)" }}>-{f.deletions}</span>
        </div>
      ))}
    </div>
  );
}
