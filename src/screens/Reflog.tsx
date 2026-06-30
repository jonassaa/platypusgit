import React from "react";
import {
  PGButton,
  PGCommitRow,
  PGEmpty,
  PGIconButton,
  PGToolbar,
  PGSpinner,
} from "@/design";
import {
  useReflogStore,
  type ReflogActionChoice,
} from "@/features/reflog/useReflogStore";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { ReflogActionDialog } from "@/features/reflog/ReflogActionDialog";
import {
  DirtyTreeDialog,
  type DirtyChoice,
} from "@/features/reflog/DirtyTreeDialog";
import { relativeTime } from "@/lib/derive";
import type { FileDiff, ReflogOp } from "@/lib/types";

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
  const status = useRepoStore((s) => s.status);
  const entries = useReflogStore((s) => s.entries);
  const selectedOid = useReflogStore((s) => s.selectedOid);
  const previewDiff = useReflogStore((s) => s.previewDiff);
  const previewLoading = useReflogStore((s) => s.previewLoading);
  const loading = useReflogStore((s) => s.loading);
  const loadReflog = useReflogStore((s) => s.loadReflog);
  const selectEntry = useReflogStore((s) => s.selectEntry);
  const resetBranchTo = useReflogStore((s) => s.resetBranchTo);
  const checkoutAt = useReflogStore((s) => s.checkoutAt);
  const createBranchAt = useReflogStore((s) => s.createBranchAt);
  const stashAndThen = useReflogStore((s) => s.stashAndThen);
  const discardAndThen = useReflogStore((s) => s.discardAndThen);
  const rememberedAction = useReflogStore((s) => s.rememberedAction);
  const error = useReflogStore((s) => s.error);
  const clearError = useReflogStore((s) => s.clearError);

  const [actionOpen, setActionOpen] = React.useState(false);
  const [dirtyOpen, setDirtyOpen] = React.useState(false);
  const pendingActionRef = React.useRef<(() => Promise<void>) | null>(null);

  React.useEffect(() => {
    if (repo) void loadReflog();
  }, [repo, loadReflog]);

  const selectedEntry = entries.find((e) => e.oid === selectedOid) ?? null;

  function makeActionRunner(
    oid: string,
    choice: ReflogActionChoice,
    branchName?: string,
  ): () => Promise<void> {
    if (choice === "reset") return () => resetBranchTo(oid);
    if (choice === "checkout") return () => checkoutAt(oid);
    return () => createBranchAt(oid, branchName ?? "");
  }

  function treeIsDirty(): boolean {
    return status.some(
      (s) =>
        s.worktree.kind !== "Unmodified" || s.index.kind !== "Unmodified",
    );
  }

  async function runOrPromptDirty(action: () => Promise<void>) {
    if (!treeIsDirty()) {
      await action();
      return;
    }
    pendingActionRef.current = action;
    setDirtyOpen(true);
  }

  async function handleActionResolve(
    choice: ReflogActionChoice,
    branchName?: string,
  ) {
    setActionOpen(false);
    if (!selectedEntry) return;
    const run = makeActionRunner(selectedEntry.oid, choice, branchName);
    await runOrPromptDirty(run);
  }

  async function handleDirtyResolve(choice: DirtyChoice) {
    setDirtyOpen(false);
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    if (!action) return;
    if (choice === "cancel" || choice === "commit-first") return;
    if (choice === "stash") {
      await stashAndThen(action);
    } else if (choice === "discard") {
      await discardAndThen(action);
    }
  }

  function openActionDialog() {
    if (!selectedEntry) return;
    // Short-circuit if a non-branch choice is remembered (branch still needs a name).
    if (rememberedAction && rememberedAction !== "branch") {
      const run = makeActionRunner(selectedEntry.oid, rememberedAction);
      void runOrPromptDirty(run);
      return;
    }
    setActionOpen(true);
  }

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
      {error && (
        <div
          role="alert"
          style={{
            padding: "6px 12px",
            fontSize: "var(--fs-12)",
            fontFamily: "var(--font-mono)",
            color: "var(--git-removed)",
            background: "oklch(0.68 0.18 25 / 0.1)",
            borderBottom: "1px solid oklch(0.68 0.18 25 / 0.35)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <strong>{error.kind}:</strong>
          <span style={{ flex: 1 }}>{error.message ?? error.kind}</span>
          <button
            onClick={clearError}
            style={{
              background: "transparent",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              fontSize: "var(--fs-11)",
            }}
          >
            dismiss
          </button>
        </div>
      )}
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
              <PGButton variant="primary" onClick={openActionDialog}>
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

      {actionOpen && selectedEntry && (
        <ReflogActionDialog
          entry={selectedEntry}
          onResolve={(choice, name) => void handleActionResolve(choice, name)}
          onCancel={() => setActionOpen(false)}
        />
      )}
      {dirtyOpen && (
        <DirtyTreeDialog onResolve={(c) => void handleDirtyResolve(c)} />
      )}
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
