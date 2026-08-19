import React from "react";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import type { DiffSyntax } from "@/lib/syntax";

/**
 * What `flattenDiffRows` should do with the unchanged runs around the hunks, plus
 * the text to do it from.
 *
 * One hook rather than the same ternary in four screens, so the surfaces cannot
 * drift on which setting they read or which side's text they pass.
 *
 * The text comes from `useDiffSyntax`, which already reads both sides in full to
 * tokenize them — so whole-file mode costs no additional IPC. It is handed over in
 * BOTH modes now (#157): chunked mode needs it to expand a folded gap and to know
 * how long the trailing remainder is. Before the tokens arrive the texts are null
 * and `flattenDiffRows` renders fold separators, then fills in when they land; row
 * geometry is the only thing that changes, and the window is recomputed from the
 * new heights.
 */
export function useDiffGaps(
  syntax: DiffSyntax,
  o?: {
    /**
     * Force chunked regardless of the setting. The Diff screen sets this while a
     * find query is active: that view is a list of matching lines, and filler
     * rows are not matches.
     */
    disabled?: boolean;
  },
): {
  gaps: "fill" | "fold";
  text: { newText: string | null; oldText: string | null };
} {
  const mode = useSettingsStore((s) => s.diffContextMode);
  const disabled = o?.disabled ?? false;
  const { newText, oldText } = syntax;
  return React.useMemo(
    () => ({
      gaps: mode === "wholeFile" && !disabled ? ("fill" as const) : ("fold" as const),
      text: { newText, oldText },
    }),
    [mode, disabled, newText, oldText],
  );
}

/**
 * The set of folded gaps the reader has expanded, for a fold separator's expand
 * control.
 *
 * Replaces the per-hunk `collapsed` set each diff screen used to hold, so this is
 * net-zero state. `resetKey` is the viewed file / diff: gap indices are positions
 * in THIS diff's hunk list, so a refetch renumbers them and a carried-over set
 * would expand the wrong run.
 */
export function useExpandedGaps(resetKey: unknown): {
  expanded: ReadonlySet<number>;
  expand: (gapIndex: number) => void;
} {
  const [expanded, setExpanded] = React.useState<ReadonlySet<number>>(new Set());
  React.useEffect(() => {
    setExpanded((prev) => (prev.size === 0 ? prev : new Set()));
  }, [resetKey]);
  const expand = React.useCallback((gapIndex: number) => {
    setExpanded((prev) => {
      if (prev.has(gapIndex)) return prev;
      const next = new Set(prev);
      next.add(gapIndex);
      return next;
    });
  }, []);
  return { expanded, expand };
}

/**
 * May a diff surface auto-scroll to its first change yet? (issue 188)
 *
 * One answer for the four surfaces, next to the hook that already keeps them from
 * drifting on which gap mode they read — the same inputs decide both.
 *
 * Four conditions, each of which cost something to learn:
 *
 * - **Rows.** Nothing to scroll to in an empty row model: an identical file, a
 *   binary one, an LFS pointer. Those must not scroll at all.
 * - **A MEASURED viewport.** 0 means UNMEASURED, never "no space" — WebKitGTK 605
 *   has no ResizeObserver, and `scrollTopForRow` deliberately no-ops on a
 *   viewport of 0 rather than jumping to the top. Read first, observe second.
 * - **A settled row model.** Whole-file mode ("fill") renders fold separators
 *   until the file text arrives and then fills every gap in, which moves every
 *   anchor row far down the list. Scrolling to the first change before that lands
 *   on a row that is about to move, i.e. back at the top of the file — the exact
 *   bug this is meant to fix. Chunked mode ("fold") never waits: its geometry
 *   does not depend on the text.
 *
 * Consequence worth knowing: a fill-mode diff whose two sides BOTH read as null
 * text never settles, so it keeps today's behaviour (no auto-open) rather than
 * risking a scroll to a row that may still move. "Not loaded yet" and "there is
 * no text" are the same value here, and guessing wrong is worse than not moving.
 *
 * The FOURTH condition, `diffFor === showing`, is the one that only a real webview
 * found. A file switch renders once with the OUTGOING diff still in state — the
 * fetch is async, so `rows`, `count` and (for one commit) even the file text all
 * still describe the file being left — while `resetKey` has already changed. The
 * auto-open would fire there, spend its once-per-file budget on the wrong row
 * model, and then decline to run again when the real one arrived, leaving the pane
 * scrolled to an offset that means nothing in it. MEASURED on WebKitGTK: the
 * second file opened at line 1 every time. Note this must NOT be solved by keying
 * the hook's `resetKey` to the diff instead — a diff is refetched whenever the
 * status changes, so staging a hunk would then yank the reader back to the first
 * change.
 */
export function diffOpenReady(o: {
  /**
   * Identity of the file the ROW MODEL was built from — `FileDiff.path`, plus
   * whatever else the surface keys its fetch on (the commit panel also has a
   * SIDE, and the two sides of one file are two different diffs).
   */
  diffFor: string | null | undefined;
  /** Identity of the file the surface is showing — the hook's own `resetKey`. */
  showing: string | null | undefined;
  /** Length of the flattened `DiffRow[]`. */
  rowCount: number;
  /** Measured height of the scroll container. 0 = unmeasured. */
  viewportH: number;
  gaps: "fill" | "fold";
  text: { newText: string | null; oldText: string | null };
}): boolean {
  if (!o.diffFor || o.diffFor !== o.showing) return false;
  if (o.rowCount === 0 || o.viewportH <= 0) return false;
  if (o.gaps === "fold") return true;
  // Same side preference `flattenDiffRows` uses: the new side, or the old one for
  // a deleted file.
  return o.text.newText !== null || o.text.oldText !== null;
}
