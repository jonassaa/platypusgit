import React, { useState, useCallback } from "react";
import { PGRebaseRow } from "@/design/git-components";
import { PGButton } from "@/design/primitives";
import { PGEmpty, PGIcon } from "@/design";
import type { AheadBehind, CommitInfo } from "@/lib/types";
import type { RebaseAction, RebaseStep, RebaseSummary } from "@/lib/types";
import { aheadBehind, commitsBetween, commitsSince } from "@/lib/tauri";
import { appErrorMessage } from "@/lib/errors";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { RebaseBasePicker } from "@/features/rebase/RebaseBasePicker";
import {
  useRebaseMergeMode,
  type RebaseMergeMode,
} from "@/features/rebase/useRebaseMergeMode";
import { buildPreservePlan } from "@/features/commits/buildPreservePlan";
import { withPlanBase } from "@/features/commits/withPlanBase";
import { useRowReorder } from "@/features/dnd";
import { PGPane, FocusableScroll, useAction, usePaneList } from "@/features/keymap";

// ─── Plan row state ───────────────────────────────────────────────────────────

interface PlanRow {
  oid: string;
  shortOid: string;
  subject: string;
  action: RebaseAction;
  message: string;
  /** More than one parent — actions are restricted and the row is badged. */
  isMerge: boolean;
  /** Original oid this step is replayed onto; null = onto the previous step. */
  onto: string | null;
  /** A merge row's original parents beyond the first. */
  mergeParents: string[];
}

/**
 * Actions that mean anything for a merge row; mirrors `rebase_plan::merge_legal`
 * on the backend. Keep the two in sync or the UI offers an action the backend
 * refuses on submit.
 */
const MERGE_ACTIONS_FLATTEN: RebaseAction[] = ["Drop", "MainlinePick"];
const MERGE_ACTIONS_PRESERVE: RebaseAction[] = ["Merge", "Drop"];

function mergeActionsFor(mode: RebaseMergeMode): RebaseAction[] {
  return mode === "preserve" ? MERGE_ACTIONS_PRESERVE : MERGE_ACTIONS_FLATTEN;
}

/**
 * Rows for a whole range, honouring the merge mode. Flatten drops merges (git's
 * own behaviour, so the branch comes out linear); preserve emits a
 * topology-aware plan where each step names the base it must sit on.
 */
function commitsToPlan(commits: CommitInfo[], mode: RebaseMergeMode): PlanRow[] {
  const byOid = new Map(commits.map((c) => [c.oid, c]));
  const steps: RebaseStep[] =
    mode === "preserve"
      ? buildPreservePlan(commits)
      : // Flatten: oldest-first, merges dropped.
        [...commits].reverse().map((c) => ({
          oid: c.oid,
          action: (c.parents.length > 1 ? "Drop" : "Pick") as RebaseAction,
          message: null,
          onto: null,
          mergeParents: [],
        }));

  return steps.map((step) => {
    const c = byOid.get(step.oid);
    return {
      oid: step.oid,
      shortOid: c?.shortOid ?? step.oid.slice(0, 7),
      subject: c?.summary ?? "",
      action: step.action,
      message: step.message ?? "",
      isMerge: (c?.parents.length ?? 0) > 1,
      onto: step.onto ?? null,
      mergeParents: step.mergeParents ?? [],
    };
  });
}

/**
 * True when every step is a plain pick/drop with no message — the shape a whole
 * range produces. A targeted plan (squash/fixup/reword, or one carrying a
 * message) is NOT rebuilt when the merge mode changes: doing so would silently
 * throw away the message the user just typed.
 */
function isPlainPlan(steps: RebaseStep[]): boolean {
  return steps.every(
    (s) => (s.action === "Pick" || s.action === "Drop") && !s.message,
  );
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
      "Conflicts detected — resolve them with Resolve conflicts in the bar above, then click Continue.";
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
  const current = useRepoStore((s) => s.current);
  const commits = useRepoStore((s) => s.commits);
  const rebaseStatus = useRepoStore((s) => s.rebaseStatus);
  // Store actions are stable identities; selecting them individually keeps this
  // screen from re-rendering on every unrelated store write (the selector-less
  // destructure subscribed to the whole store).
  const rebaseStart = useRepoStore((s) => s.rebaseStart);
  const rebaseContinue = useRepoStore((s) => s.rebaseContinue);
  const rebaseAbort = useRepoStore((s) => s.rebaseAbort);
  const rebaseAcknowledge = useRepoStore((s) => s.rebaseAcknowledge);

  const [plan, setPlan] = useState<PlanRow[]>([]);
  const [mergeMode, setMergeMode] = useRebaseMergeMode();
  // The range the plan was built from, newest-first, kept so flipping the merge
  // mode can rebuild without asking the backend again. Empty for a targeted plan
  // (squash/fixup/reword), which the mode must not rebuild — see isPlainPlan.
  const [range, setRange] = useState<CommitInfo[]>([]);
  // The drag needs the scroll element to auto-scroll near the edges.
  const planScrollRef = React.useRef<HTMLDivElement>(null);
  const [baseLabel, setBaseLabel] = useState<string | null>(null);
  /**
   * The revspec the run detaches at, carried to submit by `withPlanBase`. Any
   * revspec is legal (a full oid where we have one, a prefix from the picker's
   * hash row, a branch name from a branch menu) because both the validator and
   * the engine `revparse_single` it. Null means "use the engine's parent
   * fallback" — a root commit, or an oldest step outside the loaded log.
   */
  const [baseRev, setBaseRev] = useState<string | null>(null);
  /** Counts for the summary strip; only a RESOLVED base has them. */
  const [baseStats, setBaseStats] = useState<AheadBehind | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [baseNotice, setBaseNotice] = useState<string | null>(null);
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);

  // The completed-rebase notice reads STRAIGHT off the backend's retained
  // summary — no local copy. That is the whole point of the backend keeping it
  // (#47): a frontend cache had to be cleared by hand on every start and abort
  // path, and forgetting one left a stale "N steps completed" standing. Now the
  // engine drops the summary when a rebase starts or aborts, so both cases
  // clear themselves on the next status read.
  const doneSummary: RebaseSummary | null = rebaseStatus.lastCompleted ?? null;

  // Acknowledge on the way out: the summary is retained "until shown", and this
  // screen is what shows it. Done at unmount rather than on render so a refresh
  // cycle mid-visit can't blank the notice the user is still reading — and via a
  // ref so the cleanup sees the latest value without re-running per poll.
  const doneRef = React.useRef(doneSummary);
  doneRef.current = doneSummary;
  React.useEffect(
    () => () => {
      if (doneRef.current) void rebaseAcknowledge();
    },
    [rebaseAcknowledge],
  );

  /**
   * Resolve a base to a range and a plan. ONE path for the picker and for a
   * `rebase-onto` intent, so the strip's counts and the plan can never describe
   * different ranges. Any revspec works — branch, tag, full or short hash, even
   * a commit outside the loaded log window.
   *
   * `aheadBehind` comes first because its answer chooses the range primitive,
   * with no failed round trip:
   *   - ahead === 0  → nothing to replay (base is HEAD, or a descendant of it).
   *   - behind === 0 → base is an ANCESTOR of HEAD, by graph_ahead_behind's own
   *     definition: nothing reachable from base is missing from HEAD. That is
   *     `commitsSince`'s domain — the unchanged path, and the one primitive that
   *     ENFORCES the invariant, so it keeps its only caller.
   *   - behind > 0   → diverged (or unrelated): `commitsBetween`, which requires
   *     no ancestry at all (#131). That is what makes a new base anywhere work.
   *
   * `commits_between`'s handler defaults `limit` to 200 and simply breaks at the
   * cap, so the limit is derived from the exact count and the length is verified.
   * A silently truncated plan would leave commits unreplayed and still move the
   * branch ref — refuse instead.
   */
  const resolveBase = useCallback(
    async (rev: string, label: string) => {
      if (!current) return;
      const baseName = label.split(" — ")[0];
      try {
        const stats = await aheadBehind(current.id, rev, "HEAD");
        if (stats.ahead === 0) {
          setBaseNotice(`No commits between HEAD and ${baseName}.`);
          return;
        }
        const next =
          stats.behind === 0
            ? await commitsSince(current.id, rev)
            : await commitsBetween(current.id, rev, "HEAD", stats.ahead + 1);
        if (next.length !== stats.ahead) {
          setBaseNotice(
            `Read ${next.length} of ${stats.ahead} commits between ${baseName} and HEAD — refusing to plan a partial rebase.`,
          );
          return;
        }
        setRange(next);
        setPlan(commitsToPlan(next, mergeMode));
        setBaseRev(rev);
        setBaseLabel(label);
        setBaseStats(stats);
        setBaseNotice(null);
        setPickerOpen(false);
      } catch (e) {
        setBaseNotice(appErrorMessage(e));
      }
    },
    [current, mergeMode],
  );

  // Seed the plan from a NavIntent when the context menu fires rebase-plan.
  const intent = useNavStore((s) => s.intent);
  const clearIntent = useNavStore((s) => s.clearIntent);
  React.useEffect(() => {
    // The base-only variant (186): the SCREEN walks the range, because the log is
    // paged and a branch menu hands over a name rather than commits.
    if (intent?.kind === "rebase-onto") {
      void resolveBase(intent.base, intent.label);
      clearIntent();
      return;
    }
    if (intent?.kind !== "rebase-plan") return;
    const byOid = new Map(commits.map((c) => [c.oid, c]));
    const inRange = intent.plan
      .map((s) => byOid.get(s.oid))
      .filter((c): c is CommitInfo => c != null);
    // A plain whole-range plan is rebuilt from the range when the merge mode
    // flips; a targeted one (squash/fixup/reword) is kept exactly as handed over.
    const rebuildable = isPlainPlan(intent.plan) && inRange.length === intent.plan.length;
    setRange(rebuildable ? [...inRange].reverse() : []);

    const rows: PlanRow[] = rebuildable
      ? commitsToPlan([...inRange].reverse(), mergeMode)
      : intent.plan.map((step) => {
          const c = byOid.get(step.oid);
          const isMerge = (c?.parents.length ?? 0) > 1;
          return {
            oid: step.oid,
            shortOid: c?.shortOid ?? step.oid.slice(0, 7),
            subject: c?.summary ?? "",
            // A caller that hands us something the backend refuses on a merge
            // (an older plan, a hand-built intent) gets the flattening default.
            action:
              isMerge && !mergeActionsFor(mergeMode).includes(step.action)
                ? "Drop"
                : step.action,
            message: step.message ?? "",
            isMerge,
            onto: step.onto ?? null,
            mergeParents: step.mergeParents ?? [],
          };
        });
    setPlan(rows);
    // The base of a context-menu plan is the parent of the oldest step.
    const oldest = rows[0];
    const oldestCommit = oldest ? byOid.get(oldest.oid) : null;
    const baseOid = oldestCommit?.parents[0];
    const baseCommit = baseOid ? byOid.get(baseOid) : null;
    // Remember the base for THIS plan too, not just for the label: `handleStart`
    // pins it to the plan's first non-Drop step, which is what keeps a reorder
    // from moving where the run detaches. Null (a root commit, or an oldest step
    // outside the loaded log) leaves the engine's parent fallback in charge.
    setBaseRev(baseOid ?? null);
    setBaseStats(null);
    setBaseNotice(null);
    setBaseLabel(
      baseCommit
        ? `${baseCommit.shortOid} — ${baseCommit.summary}`
        : baseOid
          ? baseOid.slice(0, 7)
          : "selected commit",
    );
    clearIntent();
  }, [intent, commits, clearIntent, mergeMode, resolveBase]);

  // Flipping the mode rebuilds a whole-range plan in place.
  React.useEffect(() => {
    if (range.length === 0) return;
    setPlan(commitsToPlan(range, mergeMode));
  }, [mergeMode, range]);

  const updateRow = useCallback(
    (index: number, patch: Partial<PlanRow>) => {
      setPlan((rows) =>
        rows.map((r, i) => (i === index ? { ...r, ...patch } : r)),
      );
    },
    [],
  );

  // Splice, not swap: a drag can travel several rows, and for the adjacent case
  // the buttons use, splice and swap are the same move.
  const moveRowTo = useCallback((from: number, to: number) => {
    setPlan((rows) => {
      if (to < 0 || to >= rows.length || from === to) return rows;
      const next = [...rows];
      const [row] = next.splice(from, 1);
      next.splice(to, 0, row);
      return next;
    });
  }, []);

  const moveRow = useCallback(
    (index: number, direction: -1 | 1) => moveRowTo(index, index + direction),
    [moveRowTo],
  );

  const planKeys = React.useMemo(() => plan.map((r) => r.oid), [plan]);
  const { registerRow, onRowPointerDown, draggingKey } = useRowReorder(
    planKeys,
    moveRowTo,
    planScrollRef,
  );

  /**
   * Reordering is not offered while preserving merges: git documents its own
   * reorder bugs under `--rebase-merges`, and a reorder that silently produces
   * the wrong topology is worse than no reorder.
   *
   * This gate must hold for EVERY entry point. The chevrons were hidden here
   * from the start, but the pointer drag was wired unconditionally — so a
   * preserve-mode plan was reorderable by drag while the buttons said it wasn't
   * (#91).
   */
  const canReorder = mergeMode === "flatten";

  // Keyboard parity for the drag (#91): a cursor row, moved by ↑/↓, reordered by
  // Mod+Shift+↑/↓. Clamped rather than pruned — the plan is rebuilt wholesale
  // when the merge mode flips, and a stale index would point past the end.
  const [cursor, setCursor] = useState(0);
  const cursorIdx = plan.length === 0 ? -1 : Math.min(cursor, plan.length - 1);
  usePaneList({
    paneId: "rebase.steps",
    count: plan.length,
    selectedIndex: cursorIdx,
    onSelect: setCursor,
    searchText: (i) => plan[i]?.subject ?? "",
  });
  const moveCursorRow = React.useCallback(
    (direction: -1 | 1) => {
      if (!canReorder) return false;
      const to = cursorIdx + direction;
      if (cursorIdx < 0 || to < 0 || to >= plan.length) return false;
      moveRowTo(cursorIdx, to);
      setCursor(to);
      return true;
    },
    [canReorder, cursorIdx, plan.length, moveRowTo],
  );
  useAction("rebase.moveStepUp", () => moveCursorRow(-1), [moveCursorRow], {
    paneId: "rebase.steps",
  });
  useAction("rebase.moveStepDown", () => moveCursorRow(1), [moveCursorRow], {
    paneId: "rebase.steps",
  });

  const handleStart = async () => {
    // The base rides on the plan's FIRST non-Drop step, attached HERE rather than
    // when the rows were built: flatten mode lets the user reorder, and
    // `rebase_start` reads the base off whatever step ends up first.
    const steps: RebaseStep[] = withPlanBase(
      plan.map((r) => ({
        oid: r.oid,
        action: r.action,
        message: r.action === "Reword" || r.action === "Squash" ? (r.message || null) : null,
        onto: r.onto,
        mergeParents: r.mergeParents,
      })),
      baseRev,
    );
    const status = await rebaseStart(steps);
    // The rebase consumed the plan — clear it so the completion summary (or
    // the in-progress banner) isn't hidden behind a stale plan builder. On
    // failure (null) keep the plan so the user can adjust and retry.
    if (status) {
      setPlan([]);
      setBaseLabel(null);
      setBaseRev(null);
      setBaseStats(null);
    }
  };

  const handleClear = () => {
    setPlan([]);
    setRange([]);
    setBaseLabel(null);
    setBaseRev(null);
    setBaseStats(null);
    setBaseNotice(null);
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
            <div style={{ display: "flex", gap: 2 }}>
              {(["flatten", "preserve"] as const).map((m) => (
                <PGButton
                  key={m}
                  size="sm"
                  variant={mergeMode === m ? "primary" : "ghost"}
                  aria-pressed={mergeMode === m}
                  data-testid={`rebase-merge-mode-${m}`}
                  onClick={() => setMergeMode(m)}
                  title={
                    m === "flatten"
                      ? "Drop merge commits and replay their commits individually (git's default)"
                      : "Recreate merge commits, keeping the branch structure"
                  }
                >
                  {m === "flatten" ? "Flatten merges" : "Preserve merges"}
                </PGButton>
              ))}
            </div>
            <PGButton
              size="sm"
              variant={baseLabel ? "outline" : "primary"}
              icon="search"
              onClick={(e) => {
                setPickerAnchor(e.currentTarget);
                setBaseNotice(null);
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

          {/* What will be replayed. Once the base can be diverged, "everything
              newer than the base" stops being obvious — so state how many commits
              go over, what the base adds, and where the two histories met. */}
          {baseStats && baseLabel && plan.length > 0 && (
            <div
              data-testid="rebase-base-summary"
              style={{
                padding: "6px 12px",
                borderBottom: "1px solid var(--border-0)",
                background: "var(--bg-1)",
                color: "var(--fg-2)",
                fontSize: "var(--fs-12)",
              }}
            >
              {baseStats.ahead === 1
                ? "1 commit will be replayed onto "
                : `${baseStats.ahead} commits will be replayed onto `}
              {baseLabel.split(" — ")[0]}.
              {baseStats.behind > 0 && (
                <>
                  {" "}
                  {baseLabel.split(" — ")[0]} has {baseStats.behind}{" "}
                  {baseStats.behind === 1 ? "commit" : "commits"} this branch does
                  not.
                </>
              )}
              {/* The merge base only tells you something once the two sides have
                  diverged — for an ancestor base it IS the base. */}
              {baseStats.behind > 0 && baseStats.mergeBase && (
                <> Merge base {baseStats.mergeBase.slice(0, 7)}.</>
              )}
              {baseStats.mergeBase === null && (
                <> No common ancestor — the whole branch will be replayed.</>
              )}
            </div>
          )}

          {/* A base can also fail to resolve, and the picker is not always open to
              say so: a context-menu intent has no anchor, so without this the menu
              item would do nothing at all and explain nothing. One state, two
              places that cannot both be on screen. */}
          {baseNotice && !pickerOpen && (
            <div
              data-testid="rebase-base-notice"
              style={{
                padding: "6px 12px",
                borderBottom: "1px solid var(--git-conflict)",
                background: "oklch(from var(--git-conflict) l c h / 0.12)",
                color: "var(--fg-0)",
                fontSize: "var(--fs-12)",
              }}
            >
              {baseNotice}
            </div>
          )}

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
                {mergeMode === "flatten" ? (
                  <>
                    {flattenedCount > 0 && (
                      <>
                        {flattenedCount === mergeCount
                          ? mergeCount === 1
                            ? "It will be"
                            : "They will be"
                          : `${flattenedCount} will be`}{" "}
                        dropped and the merged commits replayed individually — the
                        branch becomes linear.{" "}
                      </>
                    )}
                    Choose <strong>keep as one</strong> on a merge row to keep it as a
                    single commit instead.
                  </>
                ) : (
                  <>
                    They will be recreated by re-merging their new parents. Conflict
                    resolutions and manual edits inside the original merges are{" "}
                    <strong>not preserved</strong> and may need redoing. Reordering is
                    disabled in this mode.
                  </>
                )}
              </span>
            </div>
          )}

          {/* Preserve mode disables reordering, and it has to SAY so. The
              merge-count banner above already does — but only when the range
              contains a merge, so a merge-free range in preserve mode had dim
              grips, dead chords and no explanation anywhere. */}
          {!canReorder && plan.length > 0 && mergeCount === 0 && (
            <div
              data-testid="rebase-reorder-disabled"
              style={{
                padding: "6px 12px",
                borderBottom: "1px solid var(--border-0)",
                background: "var(--bg-1)",
                color: "var(--fg-2)",
                fontSize: "var(--fs-12)",
              }}
            >
              Reordering is disabled while preserving merges — git&apos;s own{" "}
              <code style={{ fontFamily: "var(--font-mono)" }}>--rebase-merges</code>{" "}
              reorder is unreliable.
            </div>
          )}

          {/* Rows */}
          <PGPane
            id="rebase.steps"
            primary
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
            }}
          >
          <FocusableScroll
            ariaLabel="Rebase plan"
            innerRef={planScrollRef}
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
                <div
                  key={row.oid}
                  ref={registerRow(row.oid)}
                  data-pg-plan-row={row.oid}
                  onPointerDown={
                    canReorder ? (e) => onRowPointerDown(row.oid, e) : undefined
                  }
                  onClick={() => setCursor(i)}
                  style={{
                    cursor: !canReorder
                      ? "default"
                      : draggingKey === row.oid
                        ? "grabbing"
                        : "grab",
                    // Only suppress touch panning where a drag can actually
                    // start; in preserve mode it would block touch-scrolling the
                    // plan for a gesture that no longer exists.
                    touchAction: canReorder ? "none" : undefined,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <div style={{ flex: 1 }}>
                      <PGRebaseRow
                        index={i + 1}
                        sha={row.shortOid}
                        subject={row.subject}
                        action={row.action}
                        badge={row.isMerge ? "merge" : undefined}
                        options={row.isMerge ? mergeActionsFor(mergeMode) : undefined}
                        dragging={draggingKey === row.oid}
                        selected={i === cursorIdx}
                        reorderable={canReorder}
                        onActionChange={(v) => updateRow(i, { action: v })}
                      />
                    </div>
                    {/* Same gate as the drag and the keyboard chords — see
                        canReorder. */}
                    {canReorder && (
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
                          data-testid="rebase-move-up"
                          onClick={() => moveRow(i, -1)}
                          style={{ opacity: i === 0 ? 0.3 : 1, pointerEvents: i === 0 ? "none" : undefined }}
                        />
                        <PGButton
                          size="xs"
                          variant="ghost"
                          icon="chevronDown"
                          data-testid="rebase-move-down"
                          onClick={() => moveRow(i, 1)}
                          style={{ opacity: i === plan.length - 1 ? 0.3 : 1, pointerEvents: i === plan.length - 1 ? "none" : undefined }}
                        />
                      </div>
                    )}
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

      {/* Done state when a rebase finished. `rebase_status` reports total: 0
          once the engine sweeps its state, so the numbers come from the
          summary the BACKEND retains for exactly this purpose (#47). */}
      {!rebaseStatus.inProgress && doneSummary && plan.length === 0 && (
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
          Last rebase: {doneSummary.total} steps completed.
        </div>
      )}

      <RebaseBasePicker
        anchor={pickerAnchor}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={resolveBase}
        notice={baseNotice}
      />
    </div>
  );
}
