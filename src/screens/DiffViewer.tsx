import React from "react";
import {
  PGBadge,
  PGButtonGroup,
  PGEmpty,
  PGHunk,
  PGIconButton,
  PGResizeHandle,
  PGSearchInput,
  PGSideBySideDiff,
  PGSpinner,
  PGStatusMark,
  PGToggle,
  PGToolbar,
  usePaneWidth,
  type DiffLineData,
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
import { getDiff, readFileContent, readFileContentAtRev } from "@/lib/tauri";
import { useSyntax } from "@/lib/syntax";
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

  // Whole-file text for both sides, because a hunk is only a window into a
  // file: a block comment or template literal opening above it would mis-colour
  // every line below. A failed read leaves that side plain rather than breaking
  // the diff — an added or deleted file legitimately has only one side.
  const [sides, setSides] = React.useState<{ old: string | null; new: string | null }>({
    old: null,
    new: null,
  });

  React.useEffect(() => {
    if (!repo || !current || current.embedded) {
      setSides({ old: null, new: null });
      return;
    }
    let cancelled = false;
    Promise.all([
      readFileContentAtRev(repo.id, "HEAD", current.path).catch(() => null),
      readFileContent(repo.id, current.path).catch(() => null),
    ]).then(([o, n]) => {
      if (!cancelled) setSides({ old: o?.text ?? null, new: n?.text ?? null });
    });
    return () => {
      cancelled = true;
    };
  }, [repo, current?.path, current?.embedded]);

  const oldSyntax = useSyntax(current?.path ?? null, sides.old);
  const newSyntax = useSyntax(current?.path ?? null, sides.new);
  const syntax = React.useMemo(
    () => ({ old: oldSyntax, new: newSyntax }),
    [oldSyntax, newSyntax],
  );

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
            <PGToggle checked={wrap} onChange={setWrap} label="Wrap" />
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
            <FocusableScroll style={{ flex: 1 }} ariaLabel="Diff">
              {findFiltered.hunks.length === 0 && findQuery.trim() && (
                <PGEmpty icon="search" title="No matches" />
              )}
              {findFiltered.hunks.map((h, i) => (
                <div
                  key={i}
                  data-hunk-index={i}
                  data-hunk-active={hunkCursor === i ? "" : undefined}
                >
                  <PGHunk
                    header={h.header.replace(/^@@\s*|\s*@@$/g, "").trim()}
                    lines={h.lines.map(toUiLine)}
                    expanded={true}
                    syntax={syntax}
                  />
                </div>
              ))}
            </FocusableScroll>
          )}
          {!diffLoading && findFiltered && !findFiltered.binary && mode === "split" && (
            <PGSideBySideDiff left={split.left} right={split.right} />
          )}
        </PGPane>
      </div>
    </>
  );
}

function toUiLine(l: {
  kind: { kind: string };
  oldLineno: number | null;
  newLineno: number | null;
  content: string;
}): DiffLineData {
  const k = l.kind.kind;
  if (k === "Addition")
    return { kind: "add", lnR: l.newLineno ?? undefined, text: l.content };
  if (k === "Deletion")
    return { kind: "rem", lnL: l.oldLineno ?? undefined, text: l.content };
  return {
    kind: "ctx",
    lnL: l.oldLineno ?? undefined,
    lnR: l.newLineno ?? undefined,
    text: l.content,
  };
}

function diffToSplit(d: FileDiff | null): {
  left: SideLine[];
  right: SideLine[];
} {
  const left: SideLine[] = [];
  const right: SideLine[] = [];
  if (!d) return { left, right };
  for (const h of d.hunks) {
    left.push({ kind: "info", text: h.header });
    right.push({ kind: "info", text: h.header });
    for (const ln of h.lines) {
      const k = ln.kind.kind;
      if (k === "Addition") {
        left.push({ kind: "empty", ln: "", text: "" });
        right.push({
          kind: "add",
          ln: ln.newLineno ?? undefined,
          text: ln.content,
        });
      } else if (k === "Deletion") {
        left.push({
          kind: "rem",
          ln: ln.oldLineno ?? undefined,
          text: ln.content,
        });
        right.push({ kind: "empty", ln: "", text: "" });
      } else {
        left.push({
          kind: "ctx",
          ln: ln.oldLineno ?? undefined,
          text: ln.content,
        });
        right.push({
          kind: "ctx",
          ln: ln.newLineno ?? undefined,
          text: ln.content,
        });
      }
    }
  }
  return { left, right };
}
