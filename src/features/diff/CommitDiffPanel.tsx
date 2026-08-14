import React from "react";
import { PGIcon, PGResizeHandle, PGSkeleton, usePaneWidth } from "@/design";
import { PGPane, FocusableScroll, usePaneList, useHunkNav } from "@/features/keymap";
import { fileIconSpec } from "@/lib/fileIcon";
import { WhitespaceToggle } from "./WhitespaceToggle";
import { SignatureBadge } from "@/features/signing/SignatureBadge";
import { useDiffSyntax, type DiffSyntax, type SideSource } from "@/lib/syntax";
import { buildLineSpans } from "@/lib/lineSpans";
import { pairChangedLines } from "@/lib/pairChangedLines";
import type { WordSpan } from "@/lib/wordDiff";
import type { DiffLine, FileDiff } from "@/lib/types";

/**
 * One diff row's text: syntax classes plus intra-line change marks, through the
 * same tiling builder the design-system rows use.
 *
 * Side rule matches everywhere else: a removal reads the old file, an addition or
 * context row the new one.
 */
function CommitDiffText({
  line,
  syntax,
  spans,
}: {
  line: DiffLine;
  syntax: DiffSyntax;
  spans?: WordSpan[];
}) {
  const isRem = line.kind.kind === "Deletion";
  const sideLines = isRem ? syntax.old : syntax.new;
  const lineNo = isRem ? line.oldLineno : (line.newLineno ?? line.oldLineno);
  const tokens = sideLines && lineNo ? (sideLines[lineNo - 1] ?? null) : null;
  const rendered = buildLineSpans(line.content, tokens, spans);
  if (rendered.length === 1 && !rendered[0].cls && !rendered[0].changed) {
    return <>{line.content}</>;
  }
  const tint = isRem
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
          {line.content.slice(s.start, s.end)}
        </span>
      ))}
    </>
  );
}

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

  const hunkCursor = useHunkNav({
    paneIds: [filesPaneId, viewPaneId],
    count: current?.hunks.length ?? 0,
    resetKey: selected,
  });

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

  /**
   * Word spans for the selected file, keyed hunk index → line index within that
   * hunk. Runs of removals and additions pair positionally through the shared
   * rule; a run with no counterpart gets nothing.
   */
  const wordSpansByHunk = React.useMemo(() => {
    return (current?.hunks ?? []).map((h) => {
      const spans = new Map<number, WordSpan[]>();
      let remIdx: number[] = [];
      let addIdx: number[] = [];
      const flush = () => {
        if (remIdx.length && addIdx.length) {
          const paired = pairChangedLines(
            remIdx.map((i) => h.lines[i].content),
            addIdx.map((i) => h.lines[i].content),
          );
          paired.forEach((p, k) => {
            if (!p) return;
            spans.set(remIdx[k], p.old);
            spans.set(addIdx[k], p.new);
          });
        }
        remIdx = [];
        addIdx = [];
      };
      h.lines.forEach((ln, i) => {
        const k = ln.kind.kind;
        if (k === "Deletion") remIdx.push(i);
        else if (k === "Addition") addIdx.push(i);
        else flush();
      });
      flush();
      return spans;
    });
  }, [current]);

  // Per mount site: History's bottom panel is wide and short, the full-screen
  // commit diff is not, so one shared width would fit neither.
  const filesPane = usePaneWidth(240, {
    min: 140,
    max: 640,
    storageKey: `pg-${paneIdPrefix.replace(/\./g, "-")}-files-w`,
  });

  return (
    <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
      <PGPane
        id={filesPaneId}
        style={{
          width: filesPane.width,
          // The column never shrinks, so cap it against the panel: in the
          // narrow side-by-side History layout a wide drag would otherwise
          // push the diff out of the detail pane entirely.
          maxWidth: "60%",
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
      />
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
                    <CommitDiffText
                      line={ln}
                      syntax={syntax}
                      spans={wordSpansByHunk[i]?.get(j)}
                    />
                  </div>
                ))}
              </div>
            ))}
        </FocusableScroll>
      </PGPane>
    </div>
  );
}
