// Flat renderer for a file's diff rows, with an optional window.
//
// Reuses PGHunkHeader and PGDiffRow rather than restating their markup, so the
// windowed and unwindowed paths cannot drift. `window` omitted renders
// everything — that is the wrap-on case, where row heights are unknown.
//
// data-hunk-index stays on header rows: F7 navigation and the e2e specs address
// hunks through it, and it must survive windowing.
import type { DiffRow } from "@/lib/diffRows";
import type { WindowRange } from "@/lib/useWindowedList";
import { PGDiffRow, PGHunkHeader } from "./git-components";

export interface PGWindowedDiffProps {
  rows: DiffRow[];
  /** Omit to render every row. */
  window?: WindowRange;
  /** Hunk index F7/⇧F7 currently sits on. */
  activeHunk?: number;
  collapsed?: ReadonlySet<number>;
  onToggleHunk?: (hunkIndex: number) => void;
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
   * Flat row index the keyboard line cursor sits on (#61 D7 step 5).
   *
   * A ROW index rather than a (hunk, changedIndex) pair: this renderer already
   * knows each row's absolute index, so matching is one comparison and cannot
   * mistake a collapsed or refetched hunk's line for the focused one.
   */
  focusedRow?: number | null;
}

export function PGWindowedDiff({
  rows,
  window: win,
  activeHunk,
  collapsed,
  onToggleHunk,
  hunkActions,
  selectedLines,
  onLineClick,
  focusedRow,
}: PGWindowedDiffProps) {
  const start = win?.start ?? 0;
  const end = win?.end ?? rows.length;
  const slice = rows.slice(start, end);

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
          return <PGDiffRow key={`f${start + i}`} line={row.line} />;
        }
        if (row.kind === "header") {
          const actions = hunkActions?.(row.hunkIndex) ?? {};
          return (
            <div
              key={`h${row.hunkIndex}`}
              data-hunk-index={row.hunkIndex}
              data-hunk-active={activeHunk === row.hunkIndex ? "" : undefined}
            >
              <PGHunkHeader
                header={row.header.replace(/^@@\s*|\s*@@$/g, "").trim()}
                expanded={!collapsed?.has(row.hunkIndex)}
                onToggle={onToggleHunk ? () => onToggleHunk(row.hunkIndex) : undefined}
                selCount={selectedLines?.(row.hunkIndex).length ?? 0}
                {...actions}
              />
            </div>
          );
        }
        const sel = selectedLines?.(row.hunkIndex) ?? [];
        // Line selection is meaningless when the hunk's own indices don't address
        // what git would apply — the same condition that disables Stage/Discard
        // (#61 D2). PGHunk enforced this internally; the rule lives here now.
        const disabled = !!hunkActions?.(row.hunkIndex).actionsDisabledReason;
        return (
          <PGDiffRow
            // Keyed by ABSOLUTE row index: a slice-relative key would make React
            // reuse a different line's DOM node as the window scrolls.
            key={`l${start + i}`}
            line={row.line}
            selected={
              row.line.changedIndex != null && sel.includes(row.line.changedIndex)
            }
            focused={focusedRow === start + i}
            onLineClick={
              onLineClick && !disabled
                ? (changedIndex, range) => onLineClick(row.hunkIndex, changedIndex, range)
                : undefined
            }
          />
        );
      })}
      {win && win.bottomPad > 0 && (
        <div data-pg-spacer="bottom" style={{ height: `${win.bottomPad}px` }} />
      )}
    </div>
  );
}
