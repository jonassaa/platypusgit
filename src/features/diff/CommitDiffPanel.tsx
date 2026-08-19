import React from "react";
import {
  PGFoldSeparator,
  PGIcon,
  PGResizeHandle,
  PGSkeleton,
  usePaneSize,
  type DiffLineData,
} from "@/design";
import { useElementSize } from "@/lib/useElementSize";
import { MinimapGutter } from "./DiffMinimap";
import { PGPane, FocusableScroll, usePaneList, useHunkNav } from "@/features/keymap";
import { fileIconSpec } from "@/lib/fileIcon";
import { WhitespaceToggle } from "./WhitespaceToggle";
import { diffOpenReady, useDiffGaps, useExpandedGaps } from "./useDiffGaps";
import { SignatureBadge } from "@/features/signing/SignatureBadge";
import { useDiffSyntax, usePrefetchSyntax, type SideSource } from "@/lib/syntax";
import {
  flattenDiffRows,
  hunkAnchorRows,
  scrollTopForRow,
} from "@/lib/diffRows";
import { useVariableWindow } from "@/lib/useVariableWindow";
import { useViewportH } from "@/lib/useViewportH";
import { useDiffRowHeight } from "@/lib/useDiffRowHeight";
import { buildLineSpans } from "@/lib/lineSpans";
import type { FileDiff } from "@/lib/types";
import { isTextualDiff } from "@/lib/derive";
import { LfsDiffNotice } from "@/features/lfs/LfsDiffNotice";

/**
 * One diff row's text: syntax classes plus intra-line change marks, through the
 * same tiling builder the design-system rows use.
 *
 * Both inputs already sit on the row: `flattenDiffRows` attaches the word spans
 * (via the shared pairing rule) and resolves each row's syntax from the correct
 * side, so this only has to render.
 */
const CommitDiffRowText = React.memo(function CommitDiffRowText({
  line,
}: {
  line: DiffLineData;
}) {
  const text = line.text ?? "";
  // Memoized (and the component memo'd on the row's stable identity): this
  // panel renders a window of rows per frame and the span tiling is the only
  // non-trivial work per row.
  const rendered = React.useMemo(
    () => buildLineSpans(text, line.syntax ?? null, line.spans),
    [text, line.syntax, line.spans],
  );
  if (rendered.length === 0) return <>{text}</>;
  if (rendered.length === 1 && !rendered[0].cls && !rendered[0].changed) {
    return <>{text}</>;
  }
  const tint =
    line.kind === "rem"
      ? "oklch(from var(--git-removed) l c h / 0.28)"
      : "oklch(from var(--git-added) l c h / 0.28)";
  return (
    <>
      {rendered.map((s, k) => (
        <span
          key={k}
          className={s.cls}
          data-testid={s.changed ? "word-change" : undefined}
          style={s.changed ? { background: tint, borderRadius: 2 } : undefined}
        >
          {text.slice(s.start, s.end)}
        </span>
      ))}
    </>
  );
});

export interface CommitDiffPanelProps {
  diffs: FileDiff[];
  loading: boolean;
  error: string | null;
  /** Small label shown atop the file list (e.g. "abc1234 → HEAD"). */
  header: React.ReactNode;
  /**
   * Unique per mount site — the file/diff panes register in the global focus
   * store under `${paneIdPrefix}.files` / `${paneIdPrefix}.view`, so two panels
   * on screen at once must not share a prefix.
   */
  paneIdPrefix: string;
  /** Shown when the diff is empty (no changed files). */
  emptyLabel?: string;
  /**
   * Commit whose signature to show in the header (#61 D6). Omitted for
   * comparisons that are not a single commit, e.g. a combined multi-select diff
   * or commit-vs-worktree, where "the" signature has no meaning.
   */
  verifyOid?: string;
  /**
   * Revisions to read whole-file text from, for syntax highlighting.
   *
   * The panel is presentational — the caller fetches the diffs and it never
   * learns the repo or which revisions were compared — so callers that know them
   * pass them here. A combined multi-commit diff, where "the" old side has no
   * meaning, omits this and renders plain. The per-file `oldPath` for renames is
   * filled in by the panel itself, which knows the selected file.
   */
  syntaxSides?: { repoId: string; old: SideSource; new: SideSource };
}

/**
 * Presentational file-list + per-file-hunk renderer for a commit diff. Owns
 * file selection and F7/⇧F7 hunk navigation internally; the caller fetches the
 * diffs. Mounted by both `CommitDiffScreen` (full-screen) and the History
 * inline panel so hunk-nav and selection behave identically in both.
 */
export function CommitDiffPanel({
  diffs,
  loading,
  error,
  header,
  paneIdPrefix,
  emptyLabel = "No changes in this commit.",
  verifyOid,
  syntaxSides,
}: CommitDiffPanelProps) {
  const filesPaneId = `${paneIdPrefix}.files`;
  const viewPaneId = `${paneIdPrefix}.view`;

  const [selected, setSelected] = React.useState<string | null>(
    diffs[0]?.path ?? null,
  );

  // Keep the selection valid as the diff set changes (new commit selected).
  React.useEffect(() => {
    setSelected((prev) =>
      prev && diffs.some((d) => d.path === prev) ? prev : (diffs[0]?.path ?? null),
    );
  }, [diffs]);

  const selectedIndex = Math.max(0, diffs.findIndex((d) => d.path === selected));
  usePaneList({
    paneId: filesPaneId,
    count: diffs.length,
    selectedIndex,
    onSelect: (i) => {
      const d = diffs[i];
      if (d) setSelected(d.path);
    },
    searchText: (i) => diffs[i]?.path ?? "",
  });

  // Fall back to the first file so the diff pane is populated immediately when
  // a new diff arrives, before the selection-sync effect runs.
  const current = diffs.find((d) => d.path === selected) ?? diffs[0] ?? null;

  const syntax = useDiffSyntax({
    repoId: syntaxSides?.repoId ?? null,
    path: syntaxSides ? (current?.path ?? null) : null,
    // A rename's old side lives at its old path; the panel knows it per file.
    old: syntaxSides
      ? syntaxSides.old.kind === "rev"
        ? { ...syntaxSides.old, path: current?.oldPath ?? null }
        : syntaxSides.old
      : { kind: "none" },
    new: syntaxSides?.new ?? { kind: "none" },
  });

  // Warm the token cache for the commit's other files while nothing else needs
  // the worker, so moving down the file list usually hits the cache. The selected
  // file goes first and the hook skips it — it is already loading above.
  const prefetchPaths = React.useMemo(() => {
    const others = diffs.filter((d) => d.path !== current?.path).map((d) => d.path);
    return current ? [current.path, ...others] : others;
  }, [diffs, current?.path]);
  usePrefetchSyntax({
    repoId: syntaxSides?.repoId ?? null,
    paths: prefetchPaths,
    source: syntaxSides?.new ?? { kind: "none" },
    enabled: !loading && !error && !!syntaxSides,
  });

  // Flat rows + an exact window, from the SAME helpers the other diff surfaces
  // use. The panel keeps its own lighter markup, but not its own row model:
  // flattenDiffRows already pairs the word spans and resolves each row's syntax
  // side, which this panel used to do by hand.
  const rowH = useDiffRowHeight();
  const { expanded: expandedGaps, expand: expandGap } = useExpandedGaps(selected);
  const { gaps, text: diffText } = useDiffGaps(syntax);
  const rows = React.useMemo(
    () =>
      // `isTextualDiff` also excludes an LFS pointer diff (#93).
      flattenDiffRows(isTextualDiff(current) && current ? current.hunks : [], {
        // This panel's rows are tighter than the other surfaces', so its fold
        // separator is one code row tall rather than density-sized chrome.
        foldH: rowH,
        rowH,
        syntax,
        text: diffText,
        gaps,
        expandedGaps,
      }),
    [current, rowH, syntax, diffText, gaps, expandedGaps],
  );
  const heights = React.useMemo(() => rows.map((r) => r.h), [rows]);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const { viewportH, remeasure } = useViewportH(scrollRef);
  // Measured on the WRAPPER holding the scroll area and the minimap, so adding
  // the gutter cannot change the width that decides whether to add it (#161).
  // This is the panel that most often falls UNDER the threshold — History's
  // beside layout is ~480px — and it does so by width, not by being this panel.
  const diffBox = useElementSize();
  const {
    win,
    onScroll: onDiffScroll,
    scrollTo: scrollDiffTo,
  } = useVariableWindow({
    heights,
    viewportH,
    scrollRef,
  });

  // F7/⇧F7. The cursor lands on each hunk's ANCHOR row — its first changed line —
  // and scrolling goes BY OFFSET, because that row is usually unmounted (#157).
  const anchorRows = React.useMemo(() => hunkAnchorRows(rows), [rows]);
  const scrollToHunk = React.useCallback(
    (hunkIndex: number): boolean => {
      const el = scrollRef.current;
      const rowIndex = anchorRows[hunkIndex];
      if (!el || rowIndex == null || rowIndex < 0) return false;
      // Through the window's own setter — see `useVariableWindow.scrollTo`.
      const want = scrollTopForRow(heights, rowIndex, {
        scrollTop: el.scrollTop,
        viewportH: el.clientHeight,
      });
      scrollDiffTo(want);
      // Confirm the write: a container shorter than the offset CLAMPS it (a pane
      // mid-refetch is), and a reveal that did not land must not count as this
      // file having been opened — see `useHunkNav`'s `scrollToHunk`.
      return Math.abs(el.scrollTop - want) <= 1;
    },
    [anchorRows, heights, scrollDiffTo],
  );
  const hunkCursor = useHunkNav({
    paneIds: [filesPaneId, viewPaneId],
    count: current?.hunks.length ?? 0,
    resetKey: selected,
    scrollToHunk,
    ready: diffOpenReady({
      // `current` falls back to `diffs[0]` while `selected` is still the previous
      // commit's file, so these disagree for exactly the renders where the row
      // model is not the selection's yet.
      diffFor: current?.path,
      showing: selected,
      rowCount: rows.length,
      viewportH,
      gaps,
      text: diffText,
    }),
    // This panel's list is the commit's own changed files, and it owns the
    // selection, so moving it moves both panes (issue 188).
    files: {
      count: diffs.length,
      index: diffs.findIndex((d) => d.path === current?.path),
      select: (i) => {
        const d = diffs[i];
        if (d) setSelected(d.path);
      },
    },
  });

  // Per mount site: History's bottom panel is wide and short, the full-screen
  // commit diff is not, so one shared width would fit neither.
  const layout = useElementSize();
  const filesPane = usePaneSize(240, {
    axis: "width",
    container: layout,
    min: 140,
    // The diff this is a list OF keeps a readable column. That floor replaces the
    // old `maxWidth: "60%"` on the pane: a CSS cap held the RENDERED width while
    // the dragged number kept growing, so the handle drifted away from the box it
    // was sizing. A measured clamp is the same protection without the lie (#162).
    //
    // 200 rather than the ~360 a full-screen diff would like, because this panel
    // also mounts inside History's 440px-wide beside layout, where the two floors
    // plus the handle are the whole container: a larger number there would shove
    // the file column down to its own minimum and shrink a list that fits today.
    siblingMin: 200,
    storageKey: `pg-${paneIdPrefix.replace(/\./g, "-")}-files-w`,
  });

  return (
    <div ref={layout.ref} style={{ flex: 1, display: "flex", minHeight: 0 }}>
      <PGPane
        id={filesPaneId}
        style={{
          width: filesPane.size,
          flexShrink: 0,
          borderRight: "1px solid var(--border-0)",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-12)",
          minWidth: 0,
        }}
      >
        <FocusableScroll style={{ height: "100%" }} ariaLabel="Changed files">
          <div
            style={{
              padding: "6px 12px",
              borderBottom: "1px solid var(--border-0)",
              color: "var(--fg-3)",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span
              style={{
                flex: 1,
                minWidth: 0,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {header}
            </span>
            {/* Signature status for THIS commit only, verified lazily (#61 D6). */}
            {verifyOid && <SignatureBadge oid={verifyOid} />}
            {/* Read-only surface: no hunk staging to gate here. */}
            <WhitespaceToggle />
          </div>
          {loading && (
            <div style={{ padding: 12 }}>
              <PGSkeleton count={6} rowStep />
            </div>
          )}
          {error && (
            <div style={{ padding: 12, color: "var(--git-removed)" }}>{error}</div>
          )}
          {!loading && !error && diffs.length === 0 && (
            <div style={{ padding: 12, color: "var(--fg-3)" }}>{emptyLabel}</div>
          )}
          {diffs.map((d) => {
            const glyph = fileIconSpec(d.path);
            const parts = d.path.split("/");
            const base = parts.pop();
            const dir = parts.join("/");
            return (
            <div
              key={d.path}
              onClick={() => setSelected(d.path)}
              data-pg-row=""
              data-selected={d.path === selected ? "" : undefined}
              data-path={d.path}
              title={d.oldPath && d.oldPath !== d.path ? `${d.oldPath} → ${d.path}` : d.path}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                padding: "calc(4px + var(--row-step) / 2) 12px",
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 6,
                  minWidth: 0,
                  overflow: "hidden",
                }}
              >
                <PGIcon
                  name={glyph.icon}
                  size={11}
                  style={{ color: glyph.color, flexShrink: 0, alignSelf: "center" }}
                />
                <span
                  style={{
                    color: "var(--fg-0)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                    maxWidth: "70%",
                  }}
                >
                  {base}
                </span>
                {dir && (
                  <span
                    style={{
                      color: "var(--fg-3)",
                      fontSize: "var(--fs-10)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      direction: "rtl",
                    }}
                  >
                    {dir}
                  </span>
                )}
              </span>
              <span style={{ flexShrink: 0, fontSize: "var(--fs-10)" }}>
                {d.additions > 0 && (
                  <span style={{ color: "var(--git-added)" }}>+{d.additions}</span>
                )}{" "}
                {d.deletions > 0 && (
                  <span style={{ color: "var(--git-removed)" }}>−{d.deletions}</span>
                )}
              </span>
            </div>
            );
          })}
        </FocusableScroll>
      </PGPane>
      <PGResizeHandle
        side="right"
        testId={`${paneIdPrefix}-files-resize`}
        onDrag={(d) => filesPane.resize(d)}
        onReset={filesPane.reset}
      />
      <PGPane
        id={viewPaneId}
        style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}
      >
        <div
          ref={diffBox.ref}
          style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex" }}
        >
        <FocusableScroll
          style={{ flex: 1, minWidth: 0, padding: 12 }}
          ariaLabel="Diff"
          innerRef={scrollRef}
          onScroll={() => {
            onDiffScroll();
            remeasure();
          }}
        >
          {current?.binary && (
            <div style={{ color: "var(--fg-3)", fontSize: "var(--fs-12)" }}>
              Binary file — no textual diff.
            </div>
          )}
          {current?.lfs && <LfsDiffNotice diff={current} />}
          {win.topPad > 0 && (
            <div data-pg-spacer="top" style={{ height: `${win.topPad}px` }} />
          )}
          {rows.slice(win.start, win.end).map((row, k) => {
            // Chunked mode's real discontinuity, named rather than labelled with a
            // `@@` range (#157). Sized to this panel's tighter code row.
            if (row.kind === "fold") {
              return (
                <PGFoldSeparator
                  key={`g${row.gapIndex}`}
                  hiddenLines={row.hiddenLines}
                  fromR={row.fromR}
                  height="var(--diff-row-h)"
                  onExpand={() => expandGap(row.gapIndex)}
                />
              );
            }
            const kind = row.line.kind;
            const line = (
              <div
                key={`l${win.start + k}`}
                style={{
                  height: `var(--diff-row-h)`,
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--fs-12)",
                  whiteSpace: "pre",
                  // The Rider read: a changed line carries a coloured BACKGROUND
                  // and a gutter stripe, not just coloured text (#157). This panel
                  // was the one diff surface without it.
                  background:
                    kind === "add"
                      ? "var(--git-added-bg)"
                      : kind === "rem"
                        ? "var(--git-removed-bg)"
                        : undefined,
                  borderLeft:
                    kind === "add"
                      ? "2px solid var(--git-added-gutter)"
                      : kind === "rem"
                        ? "2px solid var(--git-removed-gutter)"
                        : "2px solid transparent",
                  paddingLeft: 2,
                  boxSizing: "border-box",
                  color:
                    kind === "add"
                      ? "var(--git-added)"
                      : kind === "rem"
                        ? "var(--git-removed)"
                        : "var(--fg-0)",
                }}
              >
                {kind === "add" ? "+" : kind === "rem" ? "-" : " "}
                <CommitDiffRowText line={row.line} />
              </div>
            );
            // The anchor row is where F7 addresses this hunk, since #157.
            if (row.kind !== "line" || !row.hunkAnchor) return line;
            return (
              <div
                key={`a${win.start + k}`}
                data-hunk-index={row.hunkIndex}
                data-hunk-active={hunkCursor === row.hunkIndex ? "" : undefined}
              >
                {line}
              </div>
            );
          })}
          {win.bottomPad > 0 && (
            <div data-pg-spacer="bottom" style={{ height: `${win.bottomPad}px` }} />
          )}
        </FocusableScroll>
        <MinimapGutter
          rows={rows}
          heights={heights}
          rowH={rowH}
          viewportH={viewportH}
          scrollRef={scrollRef}
          containerWidth={diffBox.width}
          containerHeight={diffBox.height}
        />
        </div>
      </PGPane>
    </div>
  );
}
