import React, { useState, useCallback } from "react";
import { PGRebaseRow } from "@/design/git-components";
import { PGButton } from "@/design/primitives";
import { PGEmpty, PGIcon } from "@/design";
import type { CommitInfo } from "@/lib/types";
import type { RebaseAction, RebaseStep } from "@/lib/types";
import { commitsSince } from "@/lib/tauri";
import { appErrorMessage } from "@/lib/errors";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { RebaseBasePicker } from "@/features/rebase/RebaseBasePicker";
import { PGPane, FocusableScroll } from "@/features/keymap";

// ─── Plan row state ───────────────────────────────────────────────────────────

interface PlanRow {
  oid: string;
  shortOid: string;
  subject: string;
  action: RebaseAction;
  message: string;
  /** More than one parent — actions are restricted and the row is badged. */
  isMerge: boolean;
}

/**
 * Actions that mean anything for a merge row; mirrors `rebase_plan::merge_legal`
 * on the backend. Keep the two in sync or the UI offers an action the backend
 * refuses on submit.
 */
const MERGE_ACTIONS: RebaseAction[] = ["Drop", "MainlinePick"];

function commitsToPlan(commits: CommitInfo[]): PlanRow[] {
  // Present commits oldest-first (log is newest-first).
  return [...commits].reverse().map((c) => {
    const isMerge = c.parents.length > 1;
    return {
      oid: c.oid,
      shortOid: c.shortOid,
      subject: c.summary,
      // A merge defaults to Drop: git's own flattening behaviour, and the only
      // other action the backend accepts on one is MainlinePick.
      action: (isMerge ? "Drop" : "Pick") as RebaseAction,
      message: "",
      isMerge,
    };
  });
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
      <PGButton
        size="sm"
        variant="outline"
        onClick={onAbort}
        icon="x"
        data-testid="rebase-abort"
      >
        Abort
      </PGButton>
      <PGButton
        size="sm"
        variant="primary"
        onClick={onContinue}
        icon="check"
        data-testid="rebase-continue"
      >
        Continue
      </PGButton>
    </div>
  );
}

// ─── Plan builder ─────────────────────────────────────────────────────────────

export function RebaseScreen() {
  const {
    current,
    commits,
    rebaseStatus,
    lastRebaseSummary,
    rebaseStart,
    rebaseContinue,
    rebaseAbort,
  } = useRepoStore();

  const [plan, setPlan] = useState<PlanRow[]>([]);
  const [baseLabel, setBaseLabel] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerNotice, setPickerNotice] = useState<string | null>(null);
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);

  // Resolve the base through the backend so any revspec works — branch, tag,
  // full or short hash, even commits outside the loaded log window. The backend
  // returns base..HEAD (newest-first) and rejects a base that isn't an ancestor.
  const handlePickBase = useCallback(
    async (oid: string, label: string) => {
      if (!current) return;
      const baseName = label.split(" — ")[0];
      try {
        const range = await commitsSince(current.id, oid);
        if (range.length === 0) {
          setPickerNotice(`No commits between HEAD and ${baseName}.`);
          return;
        }
        setPlan(commitsToPlan(range));
        setBaseLabel(label);
        setPickerNotice(null);
        setPickerOpen(false);
      } catch (e) {
        setPickerNotice(appErrorMessage(e));
      }
    },
    [current],
  );

  // Seed the plan from a NavIntent when the context menu fires rebase-plan.
  const intent = useNavStore((s) => s.intent);
  const clearIntent = useNavStore((s) => s.clearIntent);
  React.useEffect(() => {
    if (intent?.kind !== "rebase-plan") return;
    const byOid = new Map(commits.map((c) => [c.oid, c]));
    const rows: PlanRow[] = intent.plan.map((step) => {
      const c = byOid.get(step.oid);
      const isMerge = (c?.parents.length ?? 0) > 1;
      return {
        oid: step.oid,
        shortOid: c?.shortOid ?? step.oid.slice(0, 7),
        subject: c?.summary ?? "",
        // A caller that hands us something the backend refuses on a merge (an
        // older plan, a hand-built intent) gets the flattening default instead.
        action: isMerge && !MERGE_ACTIONS.includes(step.action) ? "Drop" : step.action,
        message: step.message ?? "",
        isMerge,
      };
    });
    setPlan(rows);
    // The base of a context-menu plan is the parent of the oldest step.
    const oldest = rows[0];
    const oldestCommit = oldest ? byOid.get(oldest.oid) : null;
    const baseOid = oldestCommit?.parents[0];
    const baseCommit = baseOid ? byOid.get(baseOid) : null;
    setBaseLabel(
      baseCommit
        ? `${baseCommit.shortOid} — ${baseCommit.summary}`
        : baseOid
          ? baseOid.slice(0, 7)
          : "selected commit",
    );
    clearIntent();
  }, [intent, commits, clearIntent]);

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
    const status = await rebaseStart(steps);
    // The rebase consumed the plan — clear it so the completion summary (or
    // the in-progress banner) isn't hidden behind a stale plan builder. On
    // failure (null) keep the plan so the user can adjust and retry.
    if (status) {
      setPlan([]);
      setBaseLabel(null);
    }
  };

  const handleClear = () => {
    setPlan([]);
    setBaseLabel(null);
  };

  const mergeCount = plan.filter((r) => r.isMerge).length;
  const flattenedCount = plan.filter((r) => r.isMerge && r.action === "Drop").length;

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
                fontSize: "var(--fs-13)",
                fontWeight: 600,
                color: "var(--fg-0)",
              }}
            >
              Interactive Rebase
            </span>
            <span style={{ flex: 1 }} />
            {baseLabel && (
              <span
                style={{
                  fontSize: "var(--fs-11)",
                  color: "var(--fg-2)",
                  fontFamily: "var(--font-mono)",
                  maxWidth: 360,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={baseLabel}
              >
                base: {baseLabel}
              </span>
            )}
            <PGButton
              size="sm"
              variant={baseLabel ? "outline" : "primary"}
              icon="search"
              onClick={(e) => {
                setPickerAnchor(e.currentTarget);
                setPickerNotice(null);
                setPickerOpen((v) => !v);
              }}
            >
              {baseLabel ? "Change base" : "New rebase"}
            </PGButton>
            {plan.length > 0 && (
              <PGButton size="sm" variant="ghost" icon="x" onClick={handleClear}>
                Clear
              </PGButton>
            )}
            <PGButton
              size="sm"
              variant="primary"
              icon="rebase"
              onClick={handleStart}
              disabled={plan.length === 0}
              data-testid="rebase-start"
            >
              Start rebase
            </PGButton>
          </div>

          {/* What happens to the merges in this range — stated before the run,
              the way SmartGit and TortoiseGit do, rather than left for the user
              to infer from a linear result. */}
          {mergeCount > 0 && (
            <div
              data-testid="rebase-merge-warning"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 12px",
                borderBottom: "1px solid var(--border-0)",
                background: "oklch(from var(--git-modified) l c h / 0.12)",
                color: "var(--fg-1)",
                fontSize: "var(--fs-12)",
              }}
            >
              <PGIcon
                name="warn"
                size={14}
                style={{ color: "var(--git-modified)", flexShrink: 0 }}
              />
              <span>
                {mergeCount === 1 ? "1 merge commit" : `${mergeCount} merge commits`} in
                this range.{" "}
                {flattenedCount > 0 && (
                  <>
                    {flattenedCount === mergeCount
                      ? mergeCount === 1
                        ? "It will be"
                        : "They will be"
                      : `${flattenedCount} will be`}{" "}
                    dropped and the merged commits replayed individually — the branch
                    becomes linear.{" "}
                  </>
                )}
                Choose <strong>keep as one</strong> on a merge row to keep it as a
                single commit instead.
              </span>
            </div>
          )}

          {/* Rows */}
          <PGPane
            id="rebase.steps"
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
            }}
          >
          <FocusableScroll
            ariaLabel="Rebase plan"
            style={{
              flex: 1,
              padding: "10px 12px",
            }}
          >
            {plan.length === 0 ? (
              <PGEmpty icon="rebase" title="No rebase planned">
                Click <strong>New rebase</strong> to pick a base — branch, commit, or hash.
                The plan will include every commit between HEAD and that base.
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
                        action={row.action}
                        badge={row.isMerge ? "merge" : undefined}
                        options={row.isMerge ? MERGE_ACTIONS : undefined}
                        onActionChange={(v) => updateRow(i, { action: v })}
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
          </FocusableScroll>
          </PGPane>
        </div>
      )}

      {/* Done state when a rebase finished — rebase_status reports total: 0
          after the backend sweeps its state, so the summary comes from the
          store's frontend-held lastRebaseSummary instead. */}
      {!rebaseStatus.inProgress && lastRebaseSummary && plan.length === 0 && (
        <div
          data-testid="rebase-last-summary"
          style={{
            padding: "8px 16px",
            borderTop: "1px solid var(--border-0)",
            background: "var(--bg-1)",
            fontSize: "var(--fs-12)",
            color: "var(--fg-2)",
          }}
        >
          Last rebase: {lastRebaseSummary.total} steps completed.
        </div>
      )}

      <RebaseBasePicker
        anchor={pickerAnchor}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={handlePickBase}
        notice={pickerNotice}
      />
    </div>
  );
}
