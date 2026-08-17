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
