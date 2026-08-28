// useDiffLineFocus — a per-line keyboard cursor for a diff pane, plus the Space
// chord that stages/unstages the line it sits on (#61 D7, step 5).
//
// D7 landed line-level staging with click and shift-click only: the diff pane had
// no per-line focus model, because useHunkNav moves a HUNK cursor, so there was
// nothing for Space to act on. This is that missing cursor.
//
// The cursor walks the CHANGED (+/-) lines ONLY. Context rows and whole-file
// `fill` rows are skipped for two reasons: Space could do nothing on them, and
// skipping them is what keeps this cursor addressable in the ONE index space the
// line ops speak — "index among the hunk's changed lines" (see DiffLineTarget).
// A cursor over every rendered row would need a second mapping, and a diff in
// whole-file mode is mostly rows that map to nothing.
//
// Independent of useHunkNav on purpose. F7/⇧F7 bind different actions and move a
// different cursor, so neither claims the other's chord; the two coexist as
// "jump to the next change block" and "step through changed lines".
//
// Independent is not the same as unaware, though (#297). The arrows are not the
// only thing that moves a reader through a diff: F7 jumps to the next change, the
// auto-open jumps to the first one, and a click picks a line. Each of those used
// to leave the caret where it was, so the text cursor and the row the reader was
// actually looking at were different places — and the next arrow key went back to
// the wrong one. `focusRow` is the entry point all three come in through.

import React from "react";
import type { DiffRow } from "@/lib/diffRows";
import { useAction } from "./useAction";
import { usePaneList } from "./usePaneList";

export interface DiffLineTarget {
  /**
   * Index into the flat `DiffRow[]`. What the focus ring and scrolling address —
   * NOT a value any backend op accepts.
   */
  rowIndex: number;
  hunkIndex: number;
  /**
   * Index among the hunk's changed (`+`/`-`) lines, counted from 0. THE wire
   * contract shared with the backend's `Patch::line_in_hunk` (#61 D7): never a
   * plain index into `hunk.lines`, which also carries header and context rows.
   * Read straight off the row — assigned once by `flattenDiffRows`, so this
   * introduces no second index space.
   */
  changedIndex: number;
}

/** The focusable (changed) lines of a flat diff, in render order. */
export function diffLineTargets(rows: DiffRow[]): DiffLineTarget[] {
  const out: DiffLineTarget[] = [];
  rows.forEach((row, rowIndex) => {
    // `header` has no line; `fill` has no hunkIndex to stage against.
    if (row.kind !== "line") return;
    const changedIndex = row.line.changedIndex;
    // Context rows are unnumbered by withChangedIndices, which is exactly the
    // "not stageable" test.
    if (changedIndex == null) return;
    out.push({ rowIndex, hunkIndex: row.hunkIndex, changedIndex });
  });
  return out;
}

export interface DiffLineFocus {
  targets: DiffLineTarget[];
  /** -1 while the pane has no cursor yet. */
  index: number;
  focused: DiffLineTarget | null;
  /**
   * Put the caret on the changed line at a FLAT ROW index, for a reader who was
   * moved by something other than the arrow keys — F7's landing, the auto-open's,
   * a click.
   *
   * Returns whether it found one, and declines rather than approximating: a row
   * with no `changedIndex` (context, whole-file fill, a fold separator) is not in
   * this cursor's index space, and putting the caret there would both park it
   * where Space cannot act and break the one mapping the backend's line ops
   * speak. `null` is accepted and declined, so a caller with no row to offer —
   * an empty hunk, a diff still loading — needs no guard of its own.
   *
   * Identity is stable across renders: surfaces hand this to `useHunkNav` as
   * `onLand`, and a new function per render would re-register the F7 actions on
   * every render of the screen.
   */
  focusRow: (rowIndex: number | null | undefined) => boolean;
  /**
   * The same move addressed in the BACKEND's index space — the pair a click
   * already carries (`onLineClick`), rather than the flat row index only the
   * renderer knows.
   *
   * Clicking a line without this leaves the caret where it was, which is the
   * arrow-key bug in mouse form: click line 40 to stage it, press the down arrow,
   * and the cursor resumes from line 12 where you last left it.
   */
  focusLine: (hunkIndex: number, changedIndex: number) => boolean;
}

export function useDiffLineFocus(opts: {
  paneId: string;
  rows: DiffRow[];
  /** Cursor resets when this changes — the viewed file, its side, or the diff. */
  resetKey: unknown;
  /** Space. Omit to leave the chord unclaimed for this pane. */
  onToggle?: (t: DiffLineTarget) => void;
  /**
   * Scroll a flat row index into view. Windowed panes MUST supply this: the
   * focused row is frequently unmounted, so a DOM query finds nothing and
   * keyboard navigation silently stops scrolling (#68 G10).
   */
  scrollToRow?: (rowIndex: number) => void;
  /**
   * No cursor and no toggling — for the ignore-whitespace case, where hunk
   * indices do not address what git would apply (#61 D2). Same gate the click
   * path already honors, so the keyboard cannot reach what the mouse cannot.
   */
  disabled?: boolean;
}): DiffLineFocus {
  const { paneId, rows, resetKey, onToggle, scrollToRow, disabled } = opts;

  const targets = React.useMemo(
    () => (disabled ? [] : diffLineTargets(rows)),
    [rows, disabled],
  );

  // -1 = no cursor yet, so entering the pane does not paint a ring on a line the
  // user never asked about. usePaneList clamps, so the first ArrowUp OR
  // ArrowDown lands on target 0 — the same entry behavior every other list has.
  const [index, setIndex] = React.useState(-1);
  React.useEffect(() => {
    setIndex(-1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, disabled]);

  // A shrinking diff must not leave the cursor past the end: the row it named is
  // gone, and a stale index would stage a different line.
  const cursor = index >= targets.length ? -1 : index;
  const focused = cursor >= 0 ? targets[cursor] : null;

  // Memoized, or usePaneList's scroll effect re-runs on every parent render —
  // which includes every scroll event, so the pane would snap back to the cursor
  // the moment the user scrolled away from it.
  const scrollToIndex = React.useCallback(
    (i: number) => {
      const t = targets[i];
      if (t) scrollToRow?.(t.rowIndex);
    },
    [targets, scrollToRow],
  );

  // Read through a ref so `focusRow` can keep one identity for the life of the
  // pane while still seeing the current targets — `targets` changes with every
  // refetch, and this is called from another hook's effects.
  const targetsRef = React.useRef(targets);
  targetsRef.current = targets;
  const focusRow = React.useCallback(
    (rowIndex: number | null | undefined): boolean => {
      if (rowIndex == null) return false;
      const i = targetsRef.current.findIndex((t) => t.rowIndex === rowIndex);
      if (i < 0) return false;
      setIndex(i);
      return true;
    },
    [],
  );

  const focusLine = React.useCallback(
    (hunkIndex: number, changedIndex: number): boolean => {
      const t = targetsRef.current.find(
        (x) => x.hunkIndex === hunkIndex && x.changedIndex === changedIndex,
      );
      return focusRow(t?.rowIndex);
    },
    [focusRow],
  );

  usePaneList({
    paneId,
    count: targets.length,
    selectedIndex: cursor,
    onSelect: setIndex,
    // Deliberately no onToggle: usePaneList would then claim Space as
    // `list.toggle`, and the chord would read as a list action in the cheat
    // sheet. It registers a declining handler instead, and the dispatcher falls
    // through to `diff.toggleLine` below.
    scrollToIndex,
  });

  useAction(
    "diff.toggleLine",
    () => {
      // Decline with no cursor, so Space is not swallowed before the user has
      // moved into the lines.
      if (!focused || !onToggle) return false;
      onToggle(focused);
      return true;
    },
    [focused, onToggle],
    { paneId },
  );

  return { targets, index: cursor, focused, focusRow, focusLine };
}
