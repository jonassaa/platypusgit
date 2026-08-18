// Flat renderer for a file's diff rows, with an optional window.
//
// Reuses PGDiffRow, PGFoldSeparator and PGHunkActions rather than restating their
// markup, so the windowed and unwindowed paths cannot drift. `window` omitted
// renders everything — that is the wrap-on case, where row heights are unknown.
// `wrap` and `window` therefore travel together: wrapping makes rows elastic, so
// it is only legal for a caller that has also dropped its window (and its minimap
// and its offset-based hunk scroll). See the `wrap` prop.
//
// There is no `@@` banner (#157). data-hunk-index / data-hunk-active — which F7
// navigation and the e2e specs address hunks through — live on each hunk's ANCHOR
// row, the first changed line, marked as such by flattenDiffRows. The hunk's
// Stage/Discard cluster is pinned to that same row.
import React from "react";
import type { DiffRow } from "@/lib/diffRows";
import type { WindowRange } from "@/lib/useWindowedList";
import { PGDiffRow, PGFoldSeparator, PGHunkActions } from "./git-components";

export interface PGWindowedDiffProps {
  rows: DiffRow[];
  /** Omit to render every row. */
  window?: WindowRange;
  /** Hunk index F7/⇧F7 currently sits on. */
  activeHunk?: number;
  /** Per-hunk stage/discard wiring, looked up by hunk index. */
  hunkActions?: (hunkIndex: number) => {
    staged?: boolean;
    onStage?: () => void;
    onDiscard?: () => void;
    actionsDisabledReason?: string;
  };
  /** Selected changed-line indices for a hunk (#61 D7 index space). */
  selectedLines?: (hunkIndex: number) => number[];
  onLineClick?: (hunkIndex: number, changedIndex: number, range: boolean) => void;
  /**
   * Reveal the unchanged lines a fold separator hides (chunked mode). Omit and the
   * separators stay informational.
   */
  onExpandGap?: (gapIndex: number) => void;
  /**
   * Flat row index the keyboard line cursor sits on (#61 D7 step 5).
   *
   * A ROW index rather than a (hunk, changedIndex) pair: this renderer already
   * knows each row's absolute index, so matching is one comparison and cannot
   * mistake a refetched hunk's line for the focused one.
   */
  focusedRow?: number | null;
  /**
   * Soft-wrap long code lines. Forwarded to every `PGDiffRow`, which then renders
   * an ELASTIC row — so a caller passing this must also omit `window` and switch
   * off every other heights consumer it owns (minimap, hunk scroll), because
   * `DiffRow.h` no longer describes what is on screen. Default off: with wrapping
   * on and fixed-pitch rows, each long line draws over the rows beneath it.
   */
  wrap?: boolean;
}

export function PGWindowedDiff({
  rows,
  window: win,
  activeHunk,
  hunkActions,
  selectedLines,
  onLineClick,
  onExpandGap,
  focusedRow,
  wrap,
}: PGWindowedDiffProps) {
  const start = win?.start ?? 0;
  const end = win?.end ?? rows.length;
  const slice = rows.slice(start, end);

  // Stable per-hunk click handlers, so PGDiffRow's React.memo holds: an inline
  // closure per row would hand every row a fresh prop each render and re-render
  // the whole window slice for any parent state change. Each wrapper's identity
  // is permanent (keyed by hunk index) and it reads the LATEST onLineClick
  // through a ref at call time, so no row ever sees a stale handler.
  const onLineClickRef = React.useRef(onLineClick);
  onLineClickRef.current = onLineClick;
  const hunkClickHandlers = React.useRef(
    new Map<number, (changedIndex: number, range: boolean) => void>(),
  );
  const clickHandlerFor = (hunkIndex: number) => {
    let h = hunkClickHandlers.current.get(hunkIndex);
    if (!h) {
      h = (changedIndex, range) =>
        onLineClickRef.current?.(hunkIndex, changedIndex, range);
      hunkClickHandlers.current.set(hunkIndex, h);
    }
    return h;
  };

  return (
    <div>
      {win && win.topPad > 0 && (
        <div data-pg-spacer="top" style={{ height: `${win.topPad}px` }} />
      )}
      {slice.map((row, i) => {
        // Whole-file filler: an unchanged line outside every hunk. It belongs to
        // no hunk, so it gets no selection and no click target — there is no hunk
        // index it could stage.
        if (row.kind === "fill") {
          return <PGDiffRow key={`f${start + i}`} line={row.line} wrap={wrap} />;
        }
        if (row.kind === "fold") {
          return (
            <PGFoldSeparator
              key={`g${row.gapIndex}`}
              hiddenLines={row.hiddenLines}
              fromR={row.fromR}
              onExpand={onExpandGap ? () => onExpandGap(row.gapIndex) : undefined}
            />
          );
        }
        const sel = selectedLines?.(row.hunkIndex) ?? [];
        const actions = hunkActions?.(row.hunkIndex);
        // Line selection is meaningless when the hunk's own indices don't address
        // what git would apply — the same condition that disables Stage/Discard
        // (#61 D2). PGHunk enforced this internally; the rule lives here now.
        const disabled = !!actions?.actionsDisabledReason;
        const line = (
          <PGDiffRow
            // Keyed by ABSOLUTE row index: a slice-relative key would make React
            // reuse a different line's DOM node as the window scrolls.
            key={`l${start + i}`}
            line={row.line}
            selected={
              row.line.changedIndex != null && sel.includes(row.line.changedIndex)
            }
            focused={focusedRow === start + i}
            wrap={wrap}
            onLineClick={
              onLineClick && !disabled ? clickHandlerFor(row.hunkIndex) : undefined
            }
          />
        );
        if (!row.hunkAnchor) return line;
        // The anchor row is the hunk's addressable host: F7's cursor lands here
        // and the action cluster hangs off it. `position: relative` only — the
        // wrapper must not add height, or the window's arithmetic goes out of
        // step with what is rendered.
        return (
          <div
            key={`a${start + i}`}
            data-hunk-index={row.hunkIndex}
            data-hunk-active={activeHunk === row.hunkIndex ? "" : undefined}
            style={{ position: "relative" }}
          >
            {line}
            {actions && (actions.onStage || actions.onDiscard) && (
              <PGHunkActions
                {...actions}
                selCount={sel.length}
              />
            )}
          </div>
        );
      })}
      {win && win.bottomPad > 0 && (
        <div data-pg-spacer="bottom" style={{ height: `${win.bottomPad}px` }} />
      )}
    </div>
  );
}
