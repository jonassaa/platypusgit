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
  usePaneWidth,
  type SideLine,
} from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import {
  WhitespaceToggle,
  useIgnoreWhitespace,
} from "@/features/diff/WhitespaceToggle";
import { statusMark } from "@/lib/derive";
import { EMBEDDED_REPO_HELP, appErrorMessage } from "@/lib/errors";
import { getDiff } from "@/lib/tauri";
import { useDiffSyntax } from "@/lib/syntax";
import { flattenDiffRows, rowOffset, windowVariable } from "@/lib/diffRows";
import { useDiffRowHeight } from "@/lib/useDiffRowHeight";
import { useDensityStep } from "@/features/settings/useSettingsStore";
import { pairChangedLines } from "@/lib/pairChangedLines";
import { PGPane, FocusableScroll, usePaneList, useHunkNav } from "@/features/keymap";
import type { FileDiff } from "@/lib/types";

export function DiffViewerScreen() {
  const repo = useRepoStore((s) => s.current);
  const status = useRepoStore((s) => s.status);
  const diffContextLines = useSettingsStore((s) => s.diffContextLines);
  const ignoreWhitespace = useIgnoreWhitespace();
  const [mode, setMode] = React.useState<"unified" | "split">("unified");
  const [wrap, setWrap] = React.useState(false);
  const [filter, setFilter] = React.useState("");
  const [findQuery, setFindQuery] = React.useState("");
  const [findOpen, setFindOpen] = React.useState(false);
  const findInputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (findOpen) findInputRef.current?.focus();
  }, [findOpen]);
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const [diff, setDiff] = React.useState<FileDiff | null>(null);
  const [diffLoading, setDiffLoading] = React.useState(false);
  const [diffError, setDiffError] = React.useState<string | null>(null);
  const listPane = usePaneWidth(280, {
    min: 180,
    max: 600,
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

  const findFiltered = React.useMemo<FileDiff | null>(() => {
    if (!diff || !findQuery.trim()) return diff;
    const q = findQuery.toLowerCase();
    const hunks = diff.hunks
      .map((h) => ({
        ...h,
        lines: h.lines.filter((ln) => ln.content.toLowerCase().includes(q)),
      }))
      .filter((h) => h.lines.length > 0);
    return { ...diff, hunks };
  }, [diff, findQuery]);

  const split = React.useMemo(() => diffToSplit(findFiltered), [findFiltered]);

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

  // F7/⇧F7 walk the viewed file's hunks from either pane.
  const hunkCursor = useHunkNav({
    paneIds: ["diff.files", "diff.view"],
    count: findFiltered?.hunks.length ?? 0,
    resetKey: selectedPath,
  });

  // ── Windowed rows ────────────────────────────────────────────────────────
  const rowH = useDiffRowHeight();
  const headerH = 26 + useDensityStep();
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<number>>(new Set());
  const toggleHunk = React.useCallback((i: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }, []);
  React.useEffect(() => setCollapsed(new Set()), [selectedPath]);

  const rows = React.useMemo(
    () =>
      flattenDiffRows(findFiltered?.hunks ?? [], {
        headerH,
        rowH,
        collapsed,
        syntax,
      }),
    [findFiltered, headerH, rowH, collapsed, syntax],
  );
  const heights = React.useMemo(() => rows.map((r) => r.h), [rows]);

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [viewportH, setViewportH] = React.useState(0);
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    setViewportH(el.clientHeight);
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode]);

  // Wrap makes row heights genuinely unknown — pre-wrap rows are as tall as they
  // need to be — so windowing is off and every row renders. A very large wrapped
  // diff stays slow; that combination is rare and this keeps the toggle.
  const win = React.useMemo(
    () =>
      wrap ? undefined : windowVariable(heights, { scrollTop, viewportH, overscan: 8 }),
    [wrap, heights, scrollTop, viewportH],
  );

  // Scroll F7's target hunk into view BY OFFSET. A querySelector would find
  // nothing whenever the target row is outside the window.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el || hunkCursor == null) return;
    const idx = rows.findIndex((r) => r.kind === "header" && r.hunkIndex === hunkCursor);
    if (idx < 0) return;
    const top = rowOffset(heights, idx);
    if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - headerH) {
      el.scrollTop = top;
    }
  }, [hunkCursor, rows, heights, headerH]);

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
                {diff && !diff.binary && (
                  <>
                    <PGBadge tone="success">+{diff.additions}</PGBadge>
                    <PGBadge tone="danger">−{diff.deletions}</PGBadge>
                  </>
                )}
              </>
            )}
          </>
        }
        right={
          <>
            <WhitespaceToggle />
            <PGButtonGroup
              value={mode}
              onChange={(v) => setMode(v as typeof mode)}
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
            <PGIconButton
              icon="search"
              size="md"
              title="Find in diff"
              active={findOpen}
              onClick={() => {
                setFindOpen((v) => {
                  if (v) setFindQuery("");
                  return !v;
                });
              }}
            />
          </>
        }
      />
      {findOpen && (
        <div
          style={{
            padding: "6px 10px",
            borderBottom: "1px solid var(--border-0)",
            background: "var(--bg-1)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <PGSearchInput
            value={findQuery}
            onChange={setFindQuery}
            placeholder="Find in diff…"
            inputRef={findInputRef}
            style={{ width: 320 }}
          />
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-11)",
              color: "var(--fg-2)",
            }}
          >
            {findQuery.trim()
              ? `${findFiltered?.hunks.reduce((n, h) => n + h.lines.length, 0) ?? 0} matches`
              : ""}
          </span>
        </div>
      )}
      <div
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
            width: listPane.width,
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
        <PGResizeHandle onDrag={listPane.resize} />
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
          {!diffLoading && findFiltered && !findFiltered.binary && mode === "unified" && (
            <FocusableScroll
              style={{ flex: 1 }}
              ariaLabel="Diff"
              innerRef={scrollRef}
              onScroll={() => setScrollTop(scrollRef.current?.scrollTop ?? 0)}
            >
              {findFiltered.hunks.length === 0 && findQuery.trim() && (
                <PGEmpty icon="search" title="No matches" />
              )}
              <PGWindowedDiff
                rows={rows}
                window={win}
                activeHunk={hunkCursor ?? undefined}
                collapsed={collapsed}
                onToggleHunk={toggleHunk}
              />
            </FocusableScroll>
          )}
          {!diffLoading && findFiltered && !findFiltered.binary && mode === "split" && (
            <PGSideBySideDiff
              left={splitWithSyntax.left}
              right={splitWithSyntax.right}
            />
          )}
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
