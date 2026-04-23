import React, { useState, useCallback } from "react";
import { PGRebaseRow } from "@/design/git-components";
import { PGButton } from "@/design/primitives";
import { PGEmpty } from "@/design";
import type { CommitInfo } from "@/lib/types";
import type { RebaseAction, RebaseStep } from "@/lib/types";
import { useRepoStore } from "@/features/repo/useRepoStore";

// ─── Plan row state ───────────────────────────────────────────────────────────

interface PlanRow {
  oid: string;
  shortOid: string;
  subject: string;
  action: RebaseAction;
  message: string;
}

function commitsToPlan(commits: CommitInfo[]): PlanRow[] {
  // Present commits oldest-first (log is newest-first).
  return [...commits].reverse().map((c) => ({
    oid: c.oid,
    shortOid: c.shortOid,
    subject: c.summary,
    action: "Pick" as RebaseAction,
    message: "",
  }));
}

// ─── Progress banner ─────────────────────────────────────────────────────────

function RebaseBanner({
  onContinue,
  onAbort,
  nextIndex,
  total,
  pauseReason,
}: {
  onContinue: () => void;
  onAbort: () => void;
  nextIndex: number;
  total: number;
  pauseReason: string | null;
}) {
  const isConflict = pauseReason === "conflict";
  const isEdit = pauseReason === "edit";

  const bannerColor = isConflict
    ? "var(--git-conflict)"
    : isEdit
      ? "var(--git-modified)"
      : "var(--accent)";

  let message: string;
  if (isConflict) {
    message =
      "Conflicts detected — resolve them in the Conflicts screen, then click Continue.";
  } else if (isEdit) {
    message = "Paused for edit — amend the worktree as needed, then click Continue.";
  } else {
    message = `Rebase in progress (${nextIndex} / ${total} steps completed).`;
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 16px",
        background: `oklch(from ${bannerColor} l c h / 0.12)`,
        borderBottom: `1px solid ${bannerColor}`,
        borderLeft: `3px solid ${bannerColor}`,
        fontSize: "var(--fs-13)",
      }}
    >
      <span style={{ flex: 1, color: "var(--fg-0)" }}>{message}</span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-11)",
          color: "var(--fg-2)",
        }}
      >
        {nextIndex}/{total}
      </span>
      <PGButton size="sm" variant="outline" onClick={onAbort} icon="x">
        Abort
      </PGButton>
      <PGButton size="sm" variant="primary" onClick={onContinue} icon="check">
        Continue
      </PGButton>
    </div>
  );
}

// ─── Plan builder ─────────────────────────────────────────────────────────────

const REBASE_LIMIT = 10;

export function RebaseScreen() {
  const { current, commits, rebaseStatus, rebaseStart, rebaseContinue, rebaseAbort } =
    useRepoStore();

  const [plan, setPlan] = useState<PlanRow[]>(() =>
    commitsToPlan(commits.slice(0, REBASE_LIMIT)),
  );

  // Re-sync plan when commits change (e.g. after a refresh) — only if no rebase is running.
  const prevCommitsRef = React.useRef(commits);
  React.useEffect(() => {
    if (!rebaseStatus.inProgress && commits !== prevCommitsRef.current) {
      prevCommitsRef.current = commits;
      setPlan(commitsToPlan(commits.slice(0, REBASE_LIMIT)));
    }
  }, [commits, rebaseStatus.inProgress]);

  const updateRow = useCallback(
    (index: number, patch: Partial<PlanRow>) => {
      setPlan((rows) =>
        rows.map((r, i) => (i === index ? { ...r, ...patch } : r)),
      );
    },
    [],
  );

  const moveRow = useCallback((index: number, direction: -1 | 1) => {
    setPlan((rows) => {
      const next = [...rows];
      const target = index + direction;
      if (target < 0 || target >= next.length) return next;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  const handleStart = async () => {
    const steps: RebaseStep[] = plan.map((r) => ({
      oid: r.oid,
      action: r.action,
      message: r.action === "Reword" || r.action === "Squash" ? (r.message || null) : null,
    }));
    await rebaseStart(steps);
  };

  if (!current) {
    return (
      <PGEmpty icon="rebase" title="No repository open">
        Open a repository to use interactive rebase.
      </PGEmpty>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Banner while a rebase is running */}
      {rebaseStatus.inProgress && (
        <RebaseBanner
          nextIndex={rebaseStatus.nextIndex}
          total={rebaseStatus.total}
          pauseReason={rebaseStatus.pauseReason}
          onContinue={() => rebaseContinue()}
          onAbort={() => rebaseAbort()}
        />
      )}

      {/* Plan builder — shown when no rebase is running */}
      {!rebaseStatus.inProgress && (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
          {/* Toolbar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              borderBottom: "1px solid var(--border-0)",
              background: "var(--bg-1)",
            }}
          >
            <span
              style={{
                flex: 1,
                fontSize: "var(--fs-13)",
                fontWeight: 600,
                color: "var(--fg-0)",
              }}
            >
              Interactive Rebase
            </span>
            <span
              style={{
                fontSize: "var(--fs-11)",
                color: "var(--fg-3)",
                fontFamily: "var(--font-mono)",
              }}
            >
              last {plan.length} commits
            </span>
            <PGButton
              size="sm"
              variant="primary"
              icon="rebase"
              onClick={handleStart}
              disabled={plan.length === 0}
            >
              Start rebase
            </PGButton>
          </div>

          {/* Rows */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "10px 12px",
            }}
          >
            {plan.length === 0 ? (
              <PGEmpty icon="rebase" title="No commits to rebase">
                The repository has no commits yet.
              </PGEmpty>
            ) : (
              plan.map((row, i) => (
                <div key={row.oid}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <div style={{ flex: 1 }}>
                      <PGRebaseRow
                        index={i + 1}
                        sha={row.shortOid}
                        subject={row.subject}
                        action={row.action.toLowerCase()}
                        onActionChange={(v) =>
                          updateRow(i, { action: (v.charAt(0).toUpperCase() + v.slice(1)) as RebaseAction })
                        }
                      />
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                        flexShrink: 0,
                      }}
                    >
                      <PGButton
                        size="xs"
                        variant="ghost"
                        icon="chevronUp"
                        onClick={() => moveRow(i, -1)}
                        style={{ opacity: i === 0 ? 0.3 : 1, pointerEvents: i === 0 ? "none" : undefined }}
                      />
                      <PGButton
                        size="xs"
                        variant="ghost"
                        icon="chevronDown"
                        onClick={() => moveRow(i, 1)}
                        style={{ opacity: i === plan.length - 1 ? 0.3 : 1, pointerEvents: i === plan.length - 1 ? "none" : undefined }}
                      />
                    </div>
                  </div>

                  {/* Message textarea for reword / squash */}
                  {(row.action === "Reword" || row.action === "Squash") && (
                    <div style={{ paddingLeft: 12, paddingBottom: 6 }}>
                      <textarea
                        value={row.message}
                        onChange={(e) => updateRow(i, { message: e.target.value })}
                        placeholder={
                          row.action === "Reword"
                            ? "New commit message…"
                            : "Combined commit message (leave blank to auto-concat)…"
                        }
                        rows={2}
                        style={{
                          width: "100%",
                          boxSizing: "border-box",
                          background: "var(--bg-2)",
                          border: "1px solid var(--border-0)",
                          borderRadius: "var(--r-2)",
                          color: "var(--fg-0)",
                          fontFamily: "var(--font-mono)",
                          fontSize: "var(--fs-12)",
                          padding: "6px 8px",
                          resize: "vertical",
                        }}
                      />
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Waiting / done state when rebase just finished */}
      {rebaseStatus.inProgress === false && rebaseStatus.total > 0 && (
        <div
          style={{
            padding: "8px 16px",
            borderTop: "1px solid var(--border-0)",
            background: "var(--bg-1)",
            fontSize: "var(--fs-12)",
            color: "var(--fg-2)",
          }}
        >
          Last rebase: {rebaseStatus.total} steps completed.
        </div>
      )}
    </div>
  );
}
