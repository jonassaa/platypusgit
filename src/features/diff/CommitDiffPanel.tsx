import React from "react";
import { PGIcon, PGSkeleton } from "@/design";
import { PGPane, FocusableScroll, usePaneList, useHunkNav } from "@/features/keymap";
import { fileIconSpec } from "@/lib/fileIcon";
import { WhitespaceToggle } from "./WhitespaceToggle";
import type { FileDiff } from "@/lib/types";

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

  const hunkCursor = useHunkNav({
    paneIds: [filesPaneId, viewPaneId],
    count: current?.hunks.length ?? 0,
    resetKey: selected,
  });

  return (
    <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
      <PGPane
        id={filesPaneId}
        style={{
          width: 240,
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
      <PGPane
        id={viewPaneId}
        style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}
      >
        <FocusableScroll style={{ flex: 1, padding: 12 }} ariaLabel="Diff">
          {current?.binary && (
            <div style={{ color: "var(--fg-3)", fontSize: "var(--fs-12)" }}>
              Binary file — no textual diff.
            </div>
          )}
          {current &&
            current.hunks.map((h, i) => (
              <div
                key={i}
                data-hunk-index={i}
                data-hunk-active={hunkCursor === i ? "" : undefined}
                style={{ marginBottom: 16 }}
              >
                <div
                  style={{
                    color: "var(--fg-3)",
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--fs-12)",
                  }}
                >
                  {h.header}
                </div>
                {h.lines.map((ln, j) => (
                  <div
                    key={j}
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--fs-12)",
                      whiteSpace: "pre",
                      color:
                        ln.kind.kind === "Addition"
                          ? "var(--git-added)"
                          : ln.kind.kind === "Deletion"
                            ? "var(--git-removed)"
                            : "var(--fg-0)",
                    }}
                  >
                    {ln.kind.kind === "Addition"
                      ? "+"
                      : ln.kind.kind === "Deletion"
                        ? "-"
                        : " "}
                    {ln.content}
                  </div>
                ))}
              </div>
            ))}
        </FocusableScroll>
      </PGPane>
    </div>
  );
}
