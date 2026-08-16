// Branch compare (#131) — ref↔ref and ref↔working tree.
//
// Its own deep view rather than a fifth `Target` in CommitDiff: that screen's
// target union is oid-shaped end to end and immutable once routed, while this
// one owns two MUTABLE sides (one of which has no oid) plus two more focus
// panes for the commit lists. The file diff still goes through
// `CommitDiffPanel`, so the whole DiffRow pipeline — word spans, syntax,
// prefetch, F7 — is shared, and staging stays off by construction: the panel has
// no Stage/Discard affordance at all.

import React from "react";

import {
  PGButton,
  PGEmpty,
  PGIcon,
  PGIconButton,
  PGResizeHandle,
  usePaneWidth,
} from "@/design";
import { DeepViewHeader } from "@/features/nav/DeepViewHeader";
import { CommitDiffPanel } from "@/features/diff/CommitDiffPanel";
import { useIgnoreWhitespace } from "@/features/diff/WhitespaceToggle";
import { FocusableScroll, PGPane } from "@/features/keymap";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { useCompareStore } from "@/features/compare/useCompareStore";
import { CompareSidePicker } from "@/features/compare/CompareSidePicker";
import {
  COMPARE_COMMIT_LIMIT,
  WORKDIR,
  canSwap,
  commitListHeading,
  compareHeader,
  defaultLeftSide,
  diffBasisHelp,
  diffBasisNote,
  hasCommitLists,
  sideKey,
  sideLabel,
} from "@/features/compare/compareSides";
import { relativeTime, shortSha } from "@/lib/derive";
import type { CommitInfo } from "@/lib/types";

/**
 * One row of a compare commit list. Deliberately not `PGCommitRow`: that one
 * draws a graph lane, and these lists carry no layout to draw one from.
 */
function CompareCommitRow({ commit }: { commit: CommitInfo }) {
  return (
    <div
      data-pg-row=""
      data-sha={commit.oid}
      title={commit.summary}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        // Density-aware (#70): the Settings toggle must reach this surface.
        height: "calc(22px + var(--row-step))",
        padding: "0 10px",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-12)",
        minWidth: 0,
      }}
    >
      <span style={{ color: "var(--fg-3)", flexShrink: 0 }}>
        {shortSha(commit.oid)}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          color: "var(--fg-0)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {commit.summary}
      </span>
      <span
        style={{
          flexShrink: 0,
          color: "var(--fg-3)",
          fontSize: "var(--fs-10)",
        }}
      >
        {commit.author} · {relativeTime(commit.timestamp)}
      </span>
    </div>
  );
}

function CommitList({
  paneId,
  testId,
  heading,
  commits,
}: {
  paneId: string;
  testId: string;
  heading: string;
  commits: CommitInfo[];
}) {
  return (
    <PGPane
      id={paneId}
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          padding: "6px 10px",
          borderBottom: "1px solid var(--border-0)",
          color: "var(--fg-3)",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-11)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          flexShrink: 0,
        }}
      >
        {heading}
      </div>
      <FocusableScroll style={{ flex: 1 }} ariaLabel={heading}>
        <div data-testid={testId}>
          {commits.map((c) => (
            <CompareCommitRow key={c.oid} commit={c} />
          ))}
          {commits.length === 0 && (
            <div
              style={{
                padding: 10,
                color: "var(--fg-3)",
                fontSize: "var(--fs-12)",
              }}
            >
              Nothing here.
            </div>
          )}
          {commits.length >= COMPARE_COMMIT_LIMIT && (
            <div
              style={{
                padding: 10,
                color: "var(--fg-3)",
                fontSize: "var(--fs-10)",
              }}
            >
              Showing the first {COMPARE_COMMIT_LIMIT}; the count above is exact.
            </div>
          )}
        </div>
      </FocusableScroll>
    </PGPane>
  );
}

export function CompareScreen() {
  const repo = useRepoStore((s) => s.current);
  const diffContextLines = useSettingsStore((s) => s.diffContextLines);
  const ignoreWhitespace = useIgnoreWhitespace();

  const left = useCompareStore((s) => s.left);
  const right = useCompareStore((s) => s.right);
  const diffs = useCompareStore((s) => s.diffs);
  const summary = useCompareStore((s) => s.summary);
  const aheadCommits = useCompareStore((s) => s.aheadCommits);
  const behindCommits = useCompareStore((s) => s.behindCommits);
  const untrackedOmitted = useCompareStore((s) => s.untrackedOmitted);
  const loading = useCompareStore((s) => s.loading);
  const error = useCompareStore((s) => s.error);
  const setLeft = useCompareStore((s) => s.setLeft);
  const setRight = useCompareStore((s) => s.setRight);
  const swap = useCompareStore((s) => s.swap);
  const refresh = useCompareStore((s) => s.refresh);

  // First visit for this repository — or a tab switch since the last one — gets
  // the app's own `git diff`: the current branch against what is on disk. An
  // entry point that named a pair already stamped `repoId`, so this leaves it
  // alone; a pair left over from ANOTHER repository would name refs this one may
  // not even have.
  const branches = useRepoStore((s) => s.branches);
  React.useLayoutEffect(() => {
    if (!repo) return;
    if (useCompareStore.getState().repoId === repo.id) return;
    useCompareStore.getState().open(defaultLeftSide(branches), WORKDIR);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo?.id]);

  // Primitive deps only: the side objects are rebuilt on every render, so
  // depending on their identity would refetch forever.
  const leftKey = sideKey(left);
  const rightKey = sideKey(right);
  React.useEffect(() => {
    if (!repo) return;
    void refresh(diffContextLines, ignoreWhitespace);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo?.id, leftKey, rightKey, diffContextLines, ignoreWhitespace]);

  const listsHeight = usePaneWidth(200, {
    min: 90,
    max: 600,
    storageKey: "pg-compare-lists-h",
  });

  const showLists = hasCommitLists(left, right);
  const header = compareHeader(left, right);

  if (!repo) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <DeepViewHeader crumbs={["Compare"]} />
        <PGEmpty icon="diff" title="No repository open">
          Open a repository to compare refs.
        </PGEmpty>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <DeepViewHeader crumbs={[`Compare ${header}`]} />

      <div
        data-testid="compare-bar"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          borderBottom: "1px solid var(--border-0)",
          background: "var(--bg-1)",
          flexShrink: 0,
          minWidth: 0,
        }}
      >
        <CompareSidePicker
          side={left}
          onPick={setLeft}
          testId="compare-side-left"
          label="Base"
        />
        <PGIcon name="chevronRight" size={12} style={{ color: "var(--fg-3)" }} />
        <CompareSidePicker
          side={right}
          onPick={setRight}
          allowWorkdir
          testId="compare-side-right"
          label="Compare"
        />
        <PGButton
          icon="sync"
          size="sm"
          variant="ghost"
          data-testid="compare-swap"
          title={
            canSwap(left, right)
              ? "Swap sides"
              : "The working tree cannot be the base side"
          }
          disabled={!canSwap(left, right)}
          onClick={swap}
        />
        <span
          data-testid="compare-summary"
          style={{
            flex: 1,
            minWidth: 0,
            color: "var(--fg-3)",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-11)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {summary ? (
            <>
              <span style={{ color: "var(--git-added)" }}>↑{summary.ahead}</span>{" "}
              <span style={{ color: "var(--git-removed)" }}>↓{summary.behind}</span>
              {summary.mergeBase
                ? ` · base ${shortSha(summary.mergeBase)}`
                : " · unrelated histories"}
              {/* The lists are two-dot each way, the diff is tree-vs-tree.
                  Without this the screen contradicts itself in silence. */}
              {diffBasisNote(left, summary.behind) && (
                <span
                  data-testid="compare-diff-basis"
                  title={diffBasisHelp(left, right)}
                  style={{ color: "var(--git-modified)" }}
                >
                  {` · ${diffBasisNote(left, summary.behind)}`}
                </span>
              )}
            </>
          ) : showLists ? (
            ""
          ) : (
            `${sideLabel(left)} against what is on disk right now`
          )}
        </span>
        <PGIconButton
          icon="fetch"
          size="sm"
          title="Re-read"
          onClick={() => void refresh(diffContextLines, ignoreWhitespace)}
        />
      </div>

      {untrackedOmitted > 0 && (
        // The backend capped the untracked side rather than serialising an
        // untracked `dist/` whole. Saying so is the point of the cap — a short
        // file list with no explanation would be the very failure it prevents.
        <div
          data-testid="compare-untracked-omitted"
          style={{
            padding: "6px 10px",
            color: "var(--git-modified)",
            fontSize: "var(--fs-12)",
            borderBottom: "1px solid var(--border-0)",
            flexShrink: 0,
          }}
        >
          {untrackedOmitted} untracked files omitted — too many to diff at once.
          Commit or ignore them to see them here.
        </div>
      )}

      {error && (
        <div
          data-testid="compare-error"
          style={{
            padding: "8px 10px",
            color: "var(--git-removed)",
            fontSize: "var(--fs-12)",
            borderBottom: "1px solid var(--border-0)",
            flexShrink: 0,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {showLists && (
          <>
            <div
              style={{
                height: listsHeight.width,
                flexShrink: 0,
                display: "flex",
                minHeight: 0,
                borderBottom: "1px solid var(--border-0)",
              }}
            >
              <CommitList
                paneId="compare.ahead"
                testId="compare-ahead-list"
                heading={commitListHeading(
                  summary?.ahead ?? aheadCommits.length,
                  right,
                  left,
                )}
                commits={aheadCommits}
              />
              <div style={{ width: 1, background: "var(--border-0)" }} />
              <CommitList
                paneId="compare.behind"
                testId="compare-behind-list"
                heading={commitListHeading(
                  summary?.behind ?? behindCommits.length,
                  left,
                  right,
                )}
                commits={behindCommits}
              />
            </div>
            {/* Same vertical-split idiom History uses for its detail panel. */}
            <PGResizeHandle
              orientation="vertical"
              // The handle sits BELOW the pane it sizes, so its
              // -2px overlap belongs on its top edge.
              side="bottom"
              testId="compare-lists-resize"
              onDrag={(d) => listsHeight.resize(d)}
            />
          </>
        )}
        <CommitDiffPanel
          diffs={diffs}
          loading={loading}
          error={null}
          header={header}
          paneIdPrefix="compare"
          emptyLabel="No differences."
          // `SideSource` already has a `worktree` kind, so whole-file mode works
          // on both shapes with no new plumbing.
          syntaxSides={{
            repoId: repo.id,
            old: { kind: "rev", rev: left.kind === "rev" ? left.rev : "HEAD" },
            new:
              right.kind === "workdir"
                ? { kind: "worktree" }
                : { kind: "rev", rev: right.rev },
          }}
        />
      </div>
    </div>
  );
}
