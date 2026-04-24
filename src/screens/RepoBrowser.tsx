import React from "react";
import {
  PGBadge,
  PGBranchPill,
  PGButton,
  PGButtonGroup,
  PGEmpty,
  PGFileTree,
  PGHunk,
  PGIconButton,
  PGPanel,
  PGResizeHandle,
  PGSearchInput,
  PGSpinner,
  PGStatusMark,
  PGToolbar,
  KV,
  useContextMenu,
  usePaneWidth,
  type DiffLineData,
  type PGFileTreeNode,
} from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import {
  currentBranch,
  relativeTime,
  statusMark,
} from "@/lib/derive";
import { highlightFile } from "@/lib/highlight";
import { getDiff, readFileContent } from "@/lib/tauri";
import { buildStatusTree } from "@/lib/tree";
import type { FileContent, FileDiff, FileStatus, StatusFlag } from "@/lib/types";

type SortMode = "asc" | "desc";
type HideKind = "Untracked" | "Ignored" | "Deleted";

function PGBreadcrumb({ items }: { items: string[] }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        fontSize: "var(--fs-12)",
        fontFamily: "var(--font-mono)",
      }}
    >
      {items.map((it, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span style={{ color: "var(--fg-3)" }}>›</span>}
          <span
            style={{
              color: i === items.length - 1 ? "var(--fg-0)" : "var(--fg-2)",
              padding: "0 2px",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {it}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}

export function RepoBrowserScreen() {
  const repo = useRepoStore((s) => s.current);
  const status = useRepoStore((s) => s.status);
  const allFiles = useRepoStore((s) => s.allFiles);
  const branches = useRepoStore((s) => s.branches);
  const commits = useRepoStore((s) => s.commits);
  const loading = useRepoStore((s) => s.loading);
  const refreshAllFiles = useRepoStore((s) => s.refreshAllFiles);

  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const [selected, setSelected] = React.useState<string | null>(null);
  const [diff, setDiff] = React.useState<FileDiff | null>(null);
  const [diffLoading, setDiffLoading] = React.useState(false);
  const [fileContent, setFileContent] = React.useState<FileContent | null>(null);
  const [filterMode, setFilterMode] = React.useState<
    "all" | "changes" | "conflicts"
  >("changes");
  const [hiddenKinds, setHiddenKinds] = React.useState<Set<HideKind>>(
    () => new Set(),
  );
  const [sortMode, setSortMode] = React.useState<SortMode>("asc");
  const setNavIntent = useNavStore((s) => s.setIntent);
  const treePane = usePaneWidth(280, {
    min: 180,
    max: 600,
    storageKey: "pg-repo-tree-w",
  });
  const inspectorPane = usePaneWidth(260, {
    min: 200,
    max: 520,
    storageKey: "pg-repo-inspector-w",
  });

  const head = currentBranch(branches);

  // Refresh the full file list each time the user picks "All" so the tree
  // reflects newly created / deleted files.
  React.useEffect(() => {
    if (filterMode === "all" && repo) {
      refreshAllFiles();
    }
  }, [filterMode, repo, refreshAllFiles]);

  const filteredStatus = React.useMemo<FileStatus[]>(() => {
    let base: FileStatus[];
    switch (filterMode) {
      case "conflicts":
        base = status.filter(
          (s) =>
            s.worktree.kind === "Conflicted" || s.index.kind === "Conflicted",
        );
        break;
      case "changes":
        base = status.filter(
          (s) =>
            s.worktree.kind !== "Unmodified" ||
            s.index.kind !== "Unmodified",
        );
        break;
      case "all":
      default:
        base = allFiles;
    }
    if (hiddenKinds.size === 0) return base;
    return base.filter((s) => !isHidden(s, hiddenKinds));
  }, [status, allFiles, filterMode, hiddenKinds]);

  const tree = React.useMemo<PGFileTreeNode[]>(() => {
    const t = buildStatusTree(filteredStatus);
    return sortMode === "desc" ? reverseTree(t) : t;
  }, [filteredStatus, sortMode]);

  const conflictCount = React.useMemo(
    () =>
      status.filter(
        (s) =>
          s.worktree.kind === "Conflicted" || s.index.kind === "Conflicted",
      ).length,
    [status],
  );

  // Derive the FileStatus entry that corresponds to the selected path key.
  // PGFileTree keys are path-prefixed by PG_FILETREE in the form "/a/b/c".
  const selectedFile = React.useMemo<FileStatus | null>(() => {
    if (!selected) return null;
    const path = selected.replace(/^\//, "");
    return (
      status.find((s) => s.path === path) ??
      allFiles.find((s) => s.path === path) ??
      null
    );
  }, [selected, status, allFiles]);

  const selectedIsUnmodified =
    !!selectedFile &&
    selectedFile.worktree.kind === "Unmodified" &&
    selectedFile.index.kind === "Unmodified";

  React.useEffect(() => {
    if (!selectedFile || !repo) {
      setDiff(null);
      setFileContent(null);
      return;
    }
    let cancelled = false;
    setDiffLoading(true);
    if (selectedIsUnmodified) {
      setDiff(null);
      readFileContent(repo.id, selectedFile.path)
        .then((c) => {
          if (!cancelled) setFileContent(c);
        })
        .catch(() => {
          if (!cancelled) setFileContent(null);
        })
        .finally(() => {
          if (!cancelled) setDiffLoading(false);
        });
    } else {
      setFileContent(null);
      getDiff(repo.id, selectedFile.path, "WorktreeToHead")
        .then((d) => {
          if (!cancelled) setDiff(d);
        })
        .catch(() => {
          if (!cancelled) setDiff(null);
        })
        .finally(() => {
          if (!cancelled) setDiffLoading(false);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [selectedFile?.path, selectedIsUnmodified, repo]);

  const breadcrumbItems = React.useMemo(() => {
    const root = repo?.path.split("/").filter(Boolean).pop() ?? "repository";
    if (!selectedFile) return [root];
    return [root, ...selectedFile.path.split("/")];
  }, [repo, selectedFile]);

  return (
    <>
      <PGToolbar
        left={<PGBreadcrumb items={breadcrumbItems} />}
        right={
          <>
            <PGButtonGroup
              value={filterMode}
              onChange={(v) =>
                setFilterMode(v as "all" | "changes" | "conflicts")
              }
              options={[
                { value: "all", label: "All", icon: "folder" },
                { value: "changes", label: "Changes", icon: "edit" },
                {
                  value: "conflicts",
                  label: conflictCount > 0
                    ? `Conflicts (${conflictCount})`
                    : "Conflicts",
                  icon: "conflict",
                },
              ]}
            />
            <FilterMenuButton hiddenKinds={hiddenKinds} onToggle={(k) => {
              setHiddenKinds((prev) => {
                const next = new Set(prev);
                if (next.has(k)) next.delete(k); else next.add(k);
                return next;
              });
            }} />
            <SortMenuButton sortMode={sortMode} onChange={setSortMode} />
          </>
        }
      />
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        {/* File tree */}
        <div
          style={{
            width: treePane.width,
            flexShrink: 0,
            borderRight: "1px solid var(--border-0)",
            display: "flex",
            flexDirection: "column",
            background: "var(--bg-1)",
            minWidth: 0,
          }}
        >
          <div
            style={{
              padding: "6px 8px",
              borderBottom: "1px solid var(--border-0)",
              display: "flex",
              gap: 4,
            }}
          >
            <PGSearchInput
              placeholder="Find in tree…"
              shortcut="⌘⇧F"
              style={{ flex: 1, minWidth: 0 }}
            />
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: "4px 0" }}>
            {tree.length === 0 && !loading && (
              <div
                style={{
                  padding: 14,
                  color: "var(--fg-3)",
                  fontSize: "var(--fs-11)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {filterMode === "all"
                  ? "No files."
                  : filterMode === "conflicts"
                    ? "No conflicts."
                    : "Working tree clean."}
              </div>
            )}
            {loading && tree.length === 0 && (
              <div
                style={{
                  padding: 14,
                  textAlign: "center",
                  color: "var(--fg-2)",
                }}
              >
                <PGSpinner size={14} />
              </div>
            )}
            <PGFileTree
              nodes={tree}
              expanded={expanded}
              onToggle={(k) =>
                setExpanded((e) => ({ ...e, [k]: !e[k] }))
              }
              selected={selected ?? undefined}
              onSelect={(k) => setSelected(k)}
              onActivate={(k) => setSelected(k)}
            />
          </div>
        </div>
        <PGResizeHandle onDrag={treePane.resize} />

        {/* Preview + meta */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              height: 32,
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "0 12px",
              background: "var(--bg-1)",
              borderBottom: "1px solid var(--border-0)",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-12)",
            }}
          >
            {selectedFile ? (
              <>
                <PGStatusMark kind={statusMark(selectedFile)} />
                <span style={{ color: "var(--fg-0)" }}>{selectedFile.path}</span>
                {diff && !diff.binary && (
                  <>
                    <PGBadge tone="success">+{diff.additions}</PGBadge>
                    <PGBadge tone="danger">−{diff.deletions}</PGBadge>
                  </>
                )}
                {diff?.binary && <PGBadge tone="muted">binary</PGBadge>}
                {fileContent?.binary && (
                  <PGBadge tone="muted">binary</PGBadge>
                )}
                {fileContent?.fromHead && (
                  <PGBadge tone="muted">from HEAD</PGBadge>
                )}
              </>
            ) : (
              <span style={{ color: "var(--fg-3)" }}>
                {filterMode === "all"
                  ? "Select a file to preview its content"
                  : "Select a changed file to preview its diff"}
              </span>
            )}
            <div style={{ flex: 1 }} />
            <PGButton
              size="xs"
              variant="ghost"
              icon="eye"
              disabled={!selectedFile}
              title="Open in external editor"
              onClick={() => {
                if (selectedFile)
                  useRepoStore.getState().openInEditor(selectedFile.path);
              }}
            >
              Open
            </PGButton>
            <PGButton
              size="xs"
              variant="ghost"
              icon="edit"
              disabled={!selectedFile}
              title="Edit in external editor"
              onClick={() => {
                if (selectedFile)
                  useRepoStore.getState().openInEditor(selectedFile.path);
              }}
            >
              Edit
            </PGButton>
            <PGButton
              size="xs"
              variant="ghost"
              icon="history"
              disabled={!selectedFile}
              title="Show blame"
              onClick={() => {
                if (selectedFile)
                  setNavIntent({ kind: "blame", path: selectedFile.path });
              }}
            >
              Blame
            </PGButton>
          </div>
          <div style={{ flex: 1, overflow: "auto" }}>
            {!selectedFile && (
              <PGEmpty
                icon="fileCode"
                title={
                  status.length === 0 ? "Working tree clean" : "Pick a file"
                }
              >
                {status.length === 0
                  ? "No uncommitted changes in this repository."
                  : "Click a file in the tree on the left to see its diff."}
              </PGEmpty>
            )}
            {selectedFile && diffLoading && (
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
            {selectedFile && !diffLoading && diff && !diff.binary &&
              diff.hunks.map((h, i) => (
                <PGHunk
                  key={i}
                  header={h.header.replace(/^@@\s*|\s*@@$/g, "").trim()}
                  lines={h.lines.map(toUiLine)}
                  expanded={true}
                  staged={false}
                  onStage={() => {
                    if (!selectedFile) return;
                    useRepoStore.getState().stageHunk(selectedFile.path, i);
                  }}
                  onDiscard={() => {
                    if (!selectedFile) return;
                    if (window.confirm("Discard this hunk? The change will be lost.")) {
                      useRepoStore.getState().discardHunk(selectedFile.path, i);
                    }
                  }}
                />
              ))}
            {selectedFile && !diffLoading && diff?.binary && (
              <PGEmpty icon="file" title="Binary file">
                Binary diffs aren&apos;t shown.
              </PGEmpty>
            )}
            {selectedFile && !diffLoading && fileContent?.binary && (
              <PGEmpty icon="file" title="Binary file">
                Binary contents aren&apos;t shown.
              </PGEmpty>
            )}
            {selectedFile && !diffLoading && fileContent && !fileContent.binary &&
              fileContent.text !== null && (
                <FileContentView
                  path={fileContent.path}
                  text={fileContent.text}
                />
              )}
            {selectedFile && !diffLoading && !fileContent &&
              (!diff || diff.hunks.length === 0) && !diff?.binary && (
                <PGEmpty icon="file" title="No diff available">
                  Couldn&apos;t produce a diff for this file.
                </PGEmpty>
              )}
          </div>
        </div>

        <PGResizeHandle
          onDrag={(d) => inspectorPane.resize(-d)}
          side="left"
        />

        {/* Right inspector */}
        <div
          style={{
            width: inspectorPane.width,
            flexShrink: 0,
            borderLeft: "1px solid var(--border-0)",
            background: "var(--bg-1)",
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
          }}
        >
          <PGPanel
            title="FILE INFO"
            flush
            style={{
              border: "none",
              borderRadius: 0,
              borderBottom: "1px solid var(--border-0)",
            }}
          >
            <div
              style={{
                padding: 10,
                fontSize: "var(--fs-12)",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {selectedFile ? (
                <>
                  <KV
                    k="Path"
                    v={<span className="mono">{selectedFile.path}</span>}
                  />
                  <KV k="Worktree" v={selectedFile.worktree.kind} />
                  <KV k="Index" v={selectedFile.index.kind} />
                  {head && (
                    <KV
                      k="Branch"
                      v={<PGBranchPill name={head.name} />}
                    />
                  )}
                </>
              ) : (
                <span style={{ color: "var(--fg-3)" }}>
                  No file selected.
                </span>
              )}
            </div>
          </PGPanel>
          <PGPanel
            title="HISTORY (LAST 5)"
            flush
            style={{ border: "none", borderRadius: 0, flex: 1 }}
          >
            <div>
              {commits.slice(0, 5).map((c) => (
                <div
                  key={c.oid}
                  style={{
                    padding: "8px 10px",
                    borderBottom: "1px solid var(--border-0)",
                    fontSize: "var(--fs-12)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      alignItems: "center",
                      marginBottom: 2,
                    }}
                  >
                    <span
                      className="mono"
                      style={{
                        color: "var(--accent)",
                        fontSize: "var(--fs-11)",
                      }}
                    >
                      {c.shortOid}
                    </span>
                    <span
                      style={{
                        color: "var(--fg-3)",
                        fontSize: "var(--fs-10)",
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      {relativeTime(c.timestamp)}
                    </span>
                  </div>
                  <div
                    style={{
                      color: "var(--fg-1)",
                      fontSize: "var(--fs-12)",
                      lineHeight: 1.3,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {c.summary}
                  </div>
                </div>
              ))}
              {commits.length === 0 && (
                <div
                  style={{
                    padding: 12,
                    color: "var(--fg-3)",
                    fontSize: "var(--fs-11)",
                    textAlign: "center",
                  }}
                >
                  No commit history
                </div>
              )}
            </div>
          </PGPanel>
          {repo && (
            <div
              style={{
                padding: 8,
                borderTop: "1px solid var(--border-0)",
                fontSize: "var(--fs-10)",
                color: "var(--fg-3)",
                fontFamily: "var(--font-mono)",
                wordBreak: "break-all",
              }}
            >
              {repo.path}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function FileContentView({ path, text }: { path: string; text: string }) {
  const highlighted = React.useMemo(() => highlightFile(path, text), [path, text]);
  const lines = highlighted.lines;

  if (lines.length === 0) {
    return (
      <PGEmpty icon="file" title="Empty file">
        This file has no content.
      </PGEmpty>
    );
  }

  const gutterWidth = Math.max(32, String(lines.length).length * 9 + 16);

  return (
    <div
      className="hljs"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-12)",
        lineHeight: "var(--lh-code)",
        background: "transparent",
      }}
    >
      {lines.map((line, i) => (
        <div key={i} style={{ display: "flex", minHeight: 18 }}>
          <span
            style={{
              width: gutterWidth,
              flexShrink: 0,
              textAlign: "right",
              paddingRight: 10,
              color: "var(--fg-3)",
              userSelect: "none",
              borderRight: "1px solid var(--border-0)",
            }}
          >
            {i + 1}
          </span>
          <span
            style={{
              flex: 1,
              whiteSpace: "pre-wrap",
              paddingLeft: 10,
              paddingRight: 10,
            }}
            dangerouslySetInnerHTML={{ __html: line || "&nbsp;" }}
          />
        </div>
      ))}
    </div>
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

function isHidden(s: FileStatus, hidden: Set<HideKind>): boolean {
  const sides: StatusFlag[] = [s.worktree, s.index];
  for (const k of hidden) {
    if (sides.some((x) => x.kind === k)) return true;
  }
  return false;
}

function reverseTree(nodes: PGFileTreeNode[]): PGFileTreeNode[] {
  const copy = [...nodes].reverse();
  return copy.map((n) =>
    n.children
      ? { ...n, children: reverseTree(n.children) }
      : n,
  );
}

function FilterMenuButton({
  hiddenKinds,
  onToggle,
}: {
  hiddenKinds: Set<HideKind>;
  onToggle: (k: HideKind) => void;
}) {
  const { openAt, menu } = useContextMenu<null>(() => [
    { __menuTitle: "Hide by status" },
    {
      icon: hiddenKinds.has("Untracked") ? "check" : "dot",
      label: "Hide untracked",
      onClick: () => onToggle("Untracked"),
    },
    {
      icon: hiddenKinds.has("Ignored") ? "check" : "dot",
      label: "Hide ignored",
      onClick: () => onToggle("Ignored"),
    },
    {
      icon: hiddenKinds.has("Deleted") ? "check" : "dot",
      label: "Hide deleted",
      onClick: () => onToggle("Deleted"),
    },
  ]);
  return (
    <>
      <PGIconButton
        icon="filter"
        size="md"
        title="Filter"
        active={hiddenKinds.size > 0}
        onClick={(e) => openAt(e.clientX, e.clientY + 4, null)}
      />
      {menu}
    </>
  );
}

function SortMenuButton({
  sortMode,
  onChange,
}: {
  sortMode: SortMode;
  onChange: (m: SortMode) => void;
}) {
  const { openAt, menu } = useContextMenu<null>(() => [
    { __menuTitle: "Sort order" },
    {
      icon: sortMode === "asc" ? "check" : "dot",
      label: "Name (A → Z)",
      onClick: () => onChange("asc"),
    },
    {
      icon: sortMode === "desc" ? "check" : "dot",
      label: "Name (Z → A)",
      onClick: () => onChange("desc"),
    },
  ]);
  return (
    <>
      <PGIconButton
        icon="sort"
        size="md"
        title="Sort"
        active={sortMode !== "asc"}
        onClick={(e) => openAt(e.clientX, e.clientY + 4, null)}
      />
      {menu}
    </>
  );
}
