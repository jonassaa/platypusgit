import React from "react";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import type { DiffSyntax } from "@/lib/syntax";

/**
 * The `wholeFile` option for `flattenDiffRows`, or undefined in chunked mode.
 *
 * One hook rather than the same ternary in four screens, so the surfaces cannot
 * drift on which setting they read or which side's text they pass.
 *
 * The text comes from `useDiffSyntax`, which already reads both sides in full to
 * tokenize them — so whole-file mode costs no additional IPC. Before the tokens
 * arrive the texts are null and `flattenDiffRows` renders chunked, then fills in
 * when they land; row geometry is the only thing that changes, and the window is
 * recomputed from the new heights.
 */
export function useWholeFile(
  syntax: DiffSyntax,
  o?: {
    /**
     * Force chunked regardless of the setting. The Diff screen sets this while a
     * find query is active: that view is a list of matching lines, and filler
     * rows are not matches.
     */
    disabled?: boolean;
  },
): { newText: string | null; oldText: string | null } | undefined {
  const mode = useSettingsStore((s) => s.diffContextMode);
  const disabled = o?.disabled ?? false;
  const { newText, oldText } = syntax;
  return React.useMemo(
    () =>
      mode === "wholeFile" && !disabled ? { newText, oldText } : undefined,
    [mode, disabled, newText, oldText],
  );
}
