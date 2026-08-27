import React from "react";
import {
  PGBadge,
  PGButtonGroup,
  PGEmpty,
  PGWindowedDiff,
  PGIconButton,
  PGResizeHandle,
  PGSearchInput,
  PGSideBySideDiff,
  PGSpinner,
  PGStatusMark,
  PGToggle,
  PGToolbar,
  diffCopyMenuItems,
  useContextMenu,
  usePaneSize,
  type SideLine,
} from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import {
  WhitespaceToggle,
  useIgnoreWhitespace,
} from "@/features/diff/WhitespaceToggle";
import {
  diffOpenReady,
  useDiffGaps,
  useExpandedGaps,
} from "@/features/diff/useDiffGaps";
import { isTextualDiff, statusMark } from "@/lib/derive";
import { LfsDiffNotice } from "@/features/lfs/LfsDiffNotice";
import { EMBEDDED_REPO_HELP, appErrorMessage } from "@/lib/errors";
import { getDiff } from "@/lib/tauri";
import { useDiffSyntax } from "@/lib/syntax";
import {
  flattenDiffRows,
  HUNK_LEAD_ROWS,
  hunkExtentRows,
  scrollTopForHunk,
} from "@/lib/diffRows";
import { useVariableWindow } from "@/lib/useVariableWindow";
import { useViewportH } from "@/lib/useViewportH";
import { useElementSize } from "@/lib/useElementSize";
import { MinimapGutter } from "@/features/diff/DiffMinimap";
import { DiffFindBar } from "@/features/diff/DiffFindBar";
import { useDiffFind } from "@/features/diff/useDiffFind";
import { useDiffRowHeight } from "@/lib/useDiffRowHeight";
import { useDensityStep } from "@/features/settings/useSettingsStore";
import { pairChangedLines } from "@/lib/pairChangedLines";
import {
  PGPane,
  FocusableScroll,
  chordFor,
  usePaneList,
  useHunkNav,
} from "@/features/keymap";
import type { FileDiff } from "@/lib/types";

export function DiffViewerScreen() {
  const repo = useRepoStore((s) => s.current);
  const status = useRepoStore((s) => s.status);
  const diffContextLines = useSettingsStore((s) => s.diffContextLines);
  const ignoreWhitespace = useIgnoreWhitespace();
  // Persisted, so the choice is a preference rather than resetting on every
  // navigation. The rest of this screen speaks "unified"; the setting speaks
  // "inline". Mapping at this one boundary beats renaming every comparison.
  const diffViewMode = useSettingsStore((s) => s.diffViewMode);
  const setSetting = useSettingsStore((s) => s.set);
  const mode: "unified" | "split" = diffViewMode === "split" ? "split" : "unified";
  const setMode = React.useCallback(
    (v: string) => setSetting("diffViewMode", v === "split" ? "split" : "inline"),
    [setSetting],
  );
  const [wrap, setWrap] = React.useState(false);
  const [filter, setFilter] = React.useState("");
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const [diff, setDiff] = React.useState<FileDiff | null>(null);
  const [diffLoading, setDiffLoading] = React.useState(false);
  const [diffError, setDiffError] = React.useState<string | null>(null);
  // The file list may take everything the split allows, as long as the diff it
  // is a list OF keeps enough width to read a line of code (#162).
  const layout = useElementSize();
  const listPane = usePaneSize(280, {
    axis: "width",
    container: layout,
    min: 180,
    siblingMin: 360,
    storageKey: "pg-diff-list-w",
  });

  const filtered = React.useMemo(
    () =>
      status.filter(
        (s) =>
          s.path.toLowerCase().includes(filter.toLowerCase()) &&
          (s.worktree.kind !== "Unmodified" || s.index.kind !== "Unmodified"),
      ),
    [status, filter],
  );

  React.useEffect(() => {
    if (!selectedPath && filtered[0]) setSelectedPath(filtered[0].path);
  }, [filtered, selectedPath]);

  const intent = useNavStore((s) => s.intent);
  const clearIntent = useNavStore((s) => s.clearIntent);
  React.useEffect(() => {
    if (intent?.kind === "diff-file") {
      setSelectedPath(intent.path);
      clearIntent();
    }
  }, [intent, clearIntent]);

  const current = status.find((s) => s.path === selectedPath) ?? null;

  React.useEffect(() => {
    if (!current || !repo) {
      setDiff(null);
      setDiffError(null);
      return;
    }
    setDiffError(null);
    // An embedded repo has no diff to fetch — the panel below explains the row.
    if (current.embedded) {
      setDiff(null);
      setDiffLoading(false);
      return;
    }
    let cancelled = false;
    setDiffLoading(true);
    getDiff(repo.id, current.path, "WorktreeToHead", diffContextLines, ignoreWhitespace)
      .then((d) => {
        if (!cancelled) setDiff(d);
      })
      .catch((e) => {
        // Swallowing this is what left a blank panel with no explanation.
        if (!cancelled) {
          setDiff(null);
          setDiffError(appErrorMessage(e));
        }
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [current?.path, current?.embedded, repo, diffContextLines, ignoreWhitespace]);

  // This screen compares the worktree against HEAD; an embedded repo has no
  // text to read on either side.
  const syntax = useDiffSyntax({
    repoId: current && !current.embedded ? (repo?.id ?? null) : null,
    path: current?.path ?? null,
    old: { kind: "rev", rev: "HEAD", path: diff?.oldPath },
    new: { kind: "worktree" },
  });

  // Right-click to copy. A read-only surface, so there is no line selection to
  // offer — just the dragged text and the whole file, which is the part a
  // windowed selection cannot reach.
  const diffCopyMenu = useContextMenu<void>(() => diffCopyMenuItems({ diff }));

  const split = React.useMemo(() => diffToSplit(diff), [diff]);

  // Same side rule as the unified path: the left column is the old file, the
  // right the new one, and a row resolves its tokens by its own line number.
  const splitWithSyntax = React.useMemo(() => {
    const attach = (rows: SideLine[], lines: typeof syntax.old): SideLine[] =>
      rows.map((r) => {
        if (!lines || r.kind === "info" || r.kind === "empty") return r;
        const n = typeof r.ln === "number" ? r.ln : Number(r.ln);
        if (!Number.isFinite(n) || n < 1) return r;
        const tokens = lines[n - 1];
        return tokens ? { ...r, syntax: tokens } : r;
      });
    return {
      left: attach(split.left, syntax.old),
      right: attach(split.right, syntax.new),
    };
  }, [split, syntax]);

  // Keyboard: arrows move the file selection while the list pane is focused.
  const selectedIndex = Math.max(
    0,
    filtered.findIndex((f) => f.path === selectedPath),
  );
  usePaneList({
    paneId: "diff.files",
    count: filtered.length,
    selectedIndex,
    onSelect: (i) => {
      const f = filtered[i];
      if (f) setSelectedPath(f.path);
    },
    searchText: (i) => filtered[i]?.path ?? "",
  });

  // ── Windowed rows ────────────────────────────────────────────────────────
  const rowH = useDiffRowHeight();
  const foldH = 22 + useDensityStep();
  const { expanded: expandedGaps, expand: expandGap } = useExpandedGaps(selectedPath);

  const { gaps, text: diffText } = useDiffGaps(syntax);
  const rows = React.useMemo(
    () =>
      flattenDiffRows(isTextualDiff(diff) && diff ? diff.hunks : [], {
        foldH,
        rowH,
        syntax,
        text: diffText,
        gaps,
        expandedGaps,
      }),
    [diff, foldH, rowH, syntax, diffText, gaps, expandedGaps],
  );
  const heights = React.useMemo(() => rows.map((r) => r.h), [rows]);

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const { viewportH, remeasure } = useViewportH(scrollRef, [mode]);
  // The minimap gutter sits BESIDE the scroll container (panes own their
  // scrolling), so it needs the wrapper's box — and the wrapper is what is
  // measured, not the scroll area, so showing the gutter cannot change the width
  // that decides whether to show it (#161).
  const diffBox = useElementSize();
  const {
    win: varWin,
    onScroll: onDiffScroll,
    scrollTo: scrollDiffTo,
  } = useVariableWindow({
    heights,
    viewportH,
    scrollRef,
  });

  // Wrap makes row heights genuinely unknown — pre-wrap rows are as tall as they
  // need to be — so windowing is off and every row renders. A very large wrapped
  // diff stays slow; that combination is rare and this keeps the toggle.
  //
  // `wrap` is the ONLY thing that makes a row elastic, and it reaches the rows as
  // a prop now: unconditional `pre-wrap` under a fixed-pitch row is what drew each
  // long line over its neighbours, in every unified surface, whatever this toggle
  // said. Everything below that reads `heights` is switched off in the same
  // breath — the window here, the minimap and `scrollToHunk` further down — so one
  // heights array stays the single source of truth for whoever is still reading it.
  const win = wrap ? undefined : varWin;

  // Find in diff (#241) — over the ROW MODEL, not the rendered window, and
  // reached by offset. It replaces the line FILTER this screen used to call
  // "Find in diff": that rewrote the hunks down to matching lines, which meant
  // whole-file mode had to be switched off, "copy the file" meant "copy the
  // matches", and the one thing a reader actually wants - where in the file the
  // match is - was the one thing it could not say.
  //
  // Not offered in split mode (a different renderer, `PGSideBySideDiff`) nor in
  // WRAP mode: wrap makes `DiffRow.h` describe nothing, and a wrap caller drops
  // windowing, the minimap and offset scrolling together. Find is an
  // offset-scrolling consumer, so it drops with them — and `open && enabled`
  // means turning Wrap on closes an open bar rather than leaving one that
  // scrolls to the wrong line.
  const find = useDiffFind({
    paneIds: ["diff.files", "diff.view"],
    rows,
    heights,
    scrollRef,
    scrollTo: scrollDiffTo,
    enabled: mode === "unified" && !wrap && isTextualDiff(diff) && !!diff,
    resetKey: selectedPath,
  });

  // F7/⇧F7 walk the viewed file's hunks from either pane. Scroll to the hunk's
  // ANCHOR row BY OFFSET (#157): a querySelector would find nothing whenever that
  // row is outside the window, which for a line row is most of the time.
  const extents = React.useMemo(() => hunkExtentRows(rows), [rows]);
  const scrollToHunk = React.useCallback(
    (hunkIndex: number): boolean => {
      const el = scrollRef.current;
      const extent = extents[hunkIndex];
      if (!el || extent == null || extent.first < 0) return false;
      // CENTRED on the change — see `scrollTopForHunk`. This screen used to skip
      // the scroll entirely for a hunk already on screen, which is how one
      // keypress came to mean two different things depending on where the
      // previous one left the pane.
      const want = scrollTopForHunk(heights, extent, {
        scrollTop: el.scrollTop,
        viewportH: el.clientHeight,
        rowH,
      });
      // Through the window's own setter: a bare `el.scrollTop = …` leaves the
      // rendered range describing the old position until the engine gets round
      // to a scroll event, which on WebKitGTK can be seconds (issue 188).
      scrollDiffTo(want);
      // Confirm the write: a container shorter than the offset CLAMPS it (a pane
      // mid-refetch is), and a reveal that did not land must not count as this
      // file having been opened — see `useHunkNav`'s `scrollToHunk`.
      return Math.abs(el.scrollTop - want) <= 1;
    },
    [extents, heights, rowH, scrollDiffTo],
  );

  // Wrap mode, where `heights` no longer describes the rendered rows and the
  // offset arithmetic above would land on the wrong line. Windowing is off here,
  // so every row of the extent is MOUNTED and the DOM can be measured directly —
  // the one situation in which a querySelector cannot silently no-op (the #68 G10
  // trap). Measured through bounding rects rather than `offsetTop`, which is
  // relative to whichever ancestor happens to be positioned.
  //
  // Same rule as `scrollTopForHunk`, different ruler: centre the extent, degrade
  // to a lead-in above its top when it is taller than the pane. `useHunkNav`'s own
  // fallback would do `scrollIntoView({block: "start"})` and pin the change flush
  // against the top edge instead.
  const scrollToHunkInWrap = React.useCallback(
    (hunkIndex: number): boolean => {
      const el = scrollRef.current;
      const first = el?.querySelector<HTMLElement>(`[data-hunk-index="${hunkIndex}"]`);
      // `data-hunk-last-index` rides the same wrapper when the hunk changes one
      // line, and its own when it changes more. Falling back to the anchor keeps
      // this a scroll rather than a no-op if the markers ever come apart.
      const last =
        el?.querySelector<HTMLElement>(`[data-hunk-last-index="${hunkIndex}"]`) ??
        first;
      if (!el || !first || !last) return false;
      // Content coordinates: the container's own top, corrected for how far it is
      // already scrolled.
      const base = el.getBoundingClientRect().top - el.scrollTop;
      const top = first.getBoundingClientRect().top - base;
      const extentH = last.getBoundingClientRect().bottom - base - top;
      const viewportH = el.clientHeight;
      const lead = Math.min(HUNK_LEAD_ROWS * rowH, Math.max(0, viewportH - rowH));
      const want =
        extentH > viewportH ? top - lead : top + extentH / 2 - viewportH / 2;
      // No row-boundary snap here, unlike `scrollTopForHunk`: wrapped rows have no
      // uniform pitch, and `heights` — the only list of boundaries there is —
      // describes nothing in this mode.
      const clamped = Math.max(
        0,
        Math.min(Math.round(want), el.scrollHeight - viewportH),
      );
      scrollDiffTo(clamped);
      return Math.abs(el.scrollTop - clamped) <= 1;
    },
    [rowH, scrollDiffTo],
  );
  const hunkCursor = useHunkNav({
    paneIds: ["diff.files", "diff.view"],
    count: diff?.hunks.length ?? 0,
    resetKey: selectedPath,
    // Wrap mode measures the mounted rows instead of trusting `heights` — same
    // centring rule, different ruler.
    scrollToHunk: wrap ? scrollToHunkInWrap : scrollToHunk,
    // Split mode has no unified scroll container, and `useViewportH` keeps the
    // last height it managed to read rather than resetting to 0 when the element
    // goes away — so the mode is part of the question, not just the measurement.
    ready:
      mode === "unified" &&
      diffOpenReady({
        // The row model still describes the OUTGOING file for the render right
        // after a switch — the fetch is async — and auto-opening there would burn
        // the once-per-file budget on it.
        diffFor: diff?.path,
        showing: selectedPath,
        rowCount: rows.length,
        viewportH,
        gaps,
        text: diffText,
      }),
    // This screen's list is the filtered changed-file list — the one the pane
    // beside the diff renders, so moving `selectedPath` moves both.
    files: {
      count: filtered.length,
      index: filtered.findIndex((f) => f.path === selectedPath),
      select: (i) => {
        const f = filtered[i];
        if (f) setSelectedPath(f.path);
      },
    },
  });

  if (status.length === 0) {
    return (
      <PGEmpty icon="fileCode" title="Nothing to diff">
        Working tree is clean. Make a change and revisit.
      </PGEmpty>
    );
  }

  return (
    <>
      <PGToolbar
        left={
          <>
            <PGSearchInput
              value={filter}
              onChange={setFilter}
              placeholder="Filter files…"
              style={{ width: 280 }}
            />
            {current && (
              <>
                <div
                  style={{
                    width: 1,
                    height: 16,
                    background: "var(--border-1)",
                    margin: "0 4px",
                  }}
                />
                <PGStatusMark kind={statusMark(current)} />
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--fs-13)",
                  }}
                >
                  {current.path}
                </span>
                {isTextualDiff(diff) && diff && (
                  <>
                    <PGBadge tone="success">+{diff.additions}</PGBadge>
                    <PGBadge tone="danger">−{diff.deletions}</PGBadge>
                  </>
                )}
                {diff?.lfs && <PGBadge tone="accent">LFS</PGBadge>}
              </>
            )}
          </>
        }
        right={
          <>
            <WhitespaceToggle />
            <PGButtonGroup
              value={mode}
              onChange={setMode}
              options={[
                { value: "unified", label: "Unified" },
                { value: "split", label: "Split" },
              ]}
            />
            <PGToggle
              checked={wrap}
              onChange={setWrap}
              label="Wrap"
              testId="diff-wrap-toggle"
            />
            {/* Hidden rather than disabled when find cannot run (split, wrap,
                binary): the chord declines there too, and a button that quietly
                does nothing is worse than no button. */}
            {find.available && (
              <PGIconButton
                icon="search"
                size="md"
                title={`Find in diff (${chordFor("diff.find")})`}
                active={find.open}
                onClick={() => (find.open ? find.close() : find.openBar())}
              />
            )}
          </>
        }
      />
      <div
        ref={layout.ref}
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          background: "var(--bg-0)",
        }}
      >
        <PGPane
          id="diff.files"
          primary
          style={{
            width: listPane.size,
            flexShrink: 0,
            borderRight: "1px solid var(--border-0)",
            background: "var(--bg-1)",
            minWidth: 0,
          }}
        >
          <FocusableScroll style={{ height: "100%" }} ariaLabel="Changed files">
          {filtered.map((f) => (
            <div
              key={f.path}
              onClick={() => setSelectedPath(f.path)}
              data-pg-row=""
              data-selected={selectedPath === f.path ? "" : undefined}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "0 10px",
                height: "calc(24px + var(--row-step))",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--fs-12)",
                cursor: "pointer",
                color: "var(--fg-0)",
                borderLeft:
                  selectedPath === f.path
                    ? "2px solid var(--accent)"
                    : "2px solid transparent",
              }}
            >
              <PGStatusMark kind={statusMark(f)} />
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {f.path}
              </span>
            </div>
          ))}
          </FocusableScroll>
        </PGPane>
        <PGResizeHandle
          testId="diff-list-resize"
          onDrag={listPane.resize}
          onReset={listPane.reset}
        />
        <PGPane
          id="diff.view"
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {diffLoading && (
            <div
              style={{
                padding: 20,
                textAlign: "center",
                color: "var(--fg-2)",
              }}
            >
              <PGSpinner size={14} />
            </div>
          )}
          {!diffLoading && current?.embedded && (
            <PGEmpty icon="warn" title="Embedded git repository">
              <span data-testid="diff-embedded-note">
                <span className="mono">{current.path}</span>{" "}
                {EMBEDDED_REPO_HELP}
              </span>
            </PGEmpty>
          )}
          {!diffLoading && !current?.embedded && diffError && (
            <PGEmpty icon="warn" title="Couldn't load this diff">
              <span data-testid="diff-error">{diffError}</span>
            </PGEmpty>
          )}
          {!diffLoading && diff?.binary && (
            <PGEmpty icon="file" title="Binary file" />
          )}
          {/* An LFS pointer is TEXT, so `binary` is honestly false — without this
              the pane would render "2 lines changed" for a multi-megabyte asset
              (#93). `isTextualDiff` is the shared gate; the notice is the shared
              replacement. */}
          {!diffLoading && diff?.lfs && <LfsDiffNotice diff={diff} />}
          {!diffLoading && isTextualDiff(diff) && diff && mode === "unified" && (
            <>
            <DiffFindBar find={find} />
            <div
              ref={diffBox.ref}
              style={{ flex: 1, minWidth: 0, display: "flex", minHeight: 0 }}
            >
              <FocusableScroll
                style={{ flex: 1, minWidth: 0 }}
                ariaLabel="Diff"
                innerRef={scrollRef}
                onScroll={() => {
                  onDiffScroll();
                  remeasure();
                }}
                onContextMenu={(e) => diffCopyMenu.onContextMenu(e, undefined)}
              >
                <PGWindowedDiff
                  rows={rows}
                  window={win}
                  wrap={wrap}
                  activeHunk={hunkCursor >= 0 ? hunkCursor : undefined}
                  onExpandGap={expandGap}
                  findMarks={find.marksFor}
                />
              </FocusableScroll>
              {/* Wrap makes row heights genuinely unknown — the same reason
                  windowing is off — so `heights` no longer describes the rendered
                  file and a scrub would land on the wrong line. No gutter there. */}
              {!wrap && (
                <MinimapGutter
                  rows={rows}
                  heights={heights}
                  rowH={rowH}
                  viewportH={viewportH}
                  scrollRef={scrollRef}
                  containerWidth={diffBox.width}
                  containerHeight={diffBox.height}
                />
              )}
            </div>
            </>
          )}
          {!diffLoading && isTextualDiff(diff) && diff && mode === "split" && (
            <PGSideBySideDiff
              left={splitWithSyntax.left}
              right={splitWithSyntax.right}
              onContextMenu={(e) => diffCopyMenu.onContextMenu(e, undefined)}
            />
          )}
          {diffCopyMenu.menu}
        </PGPane>
      </div>
    </>
  );
}


/**
 * Flatten hunks into aligned left/right columns.
 *
 * Removals and additions are collected as RUNS and emitted side by side, so the
 * i-th removal shares a row with the i-th addition. Emitting each line as it came
 * let the columns drift apart on any hunk that mixed both, and paired rows are
 * also what intra-line word diff needs.
 *
 * Exported for its own test: the alignment invariant (both columns always the same
 * length, and the same index meaning the same place in the hunk) is the kind of
 * thing that regresses silently through the UI.
 */
export function diffToSplit(d: FileDiff | null): {
  left: SideLine[];
  right: SideLine[];
} {
  const left: SideLine[] = [];
  const right: SideLine[] = [];
  if (!d) return { left, right };

  for (const h of d.hunks) {
    left.push({ kind: "info", text: h.header });
    right.push({ kind: "info", text: h.header });

    let remRun: typeof h.lines = [];
    let addRun: typeof h.lines = [];

    const flush = () => {
      if (remRun.length === 0 && addRun.length === 0) return;
      const paired = pairChangedLines(
        remRun.map((l) => l.content),
        addRun.map((l) => l.content),
      );
      const rows = Math.max(remRun.length, addRun.length);
      for (let i = 0; i < rows; i++) {
        const r = remRun[i];
        const a = addRun[i];
        const p = paired[i] ?? null;
        left.push(
          r
            ? { kind: "rem", ln: r.oldLineno ?? undefined, text: r.content, spans: p?.old }
            : { kind: "empty", ln: "", text: "" },
        );
        right.push(
          a
            ? { kind: "add", ln: a.newLineno ?? undefined, text: a.content, spans: p?.new }
            : { kind: "empty", ln: "", text: "" },
        );
      }
      remRun = [];
      addRun = [];
    };

    for (const ln of h.lines) {
      const k = ln.kind.kind;
      if (k === "Deletion") remRun.push(ln);
      else if (k === "Addition") addRun.push(ln);
      else {
        flush();
        left.push({ kind: "ctx", ln: ln.oldLineno ?? undefined, text: ln.content });
        right.push({ kind: "ctx", ln: ln.newLineno ?? undefined, text: ln.content });
      }
    }
    flush();
  }
  return { left, right };
}
