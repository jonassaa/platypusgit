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
  PGInput,
  PGPanel,
  PGResizeHandle,
  PGSearchInput,
  PGSpinner,
  PGStatusMark,
  PGToolbar,
  KV,
  fileMenuItems,
  flattenFileTree,
  multiFileMenuItems,
  useContextMenu,
  usePaneWidth,
  type ContextMenuItem,
  type DiffLineData,
  type PGFileTreeNode,
} from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import {
  currentBranch,
  isStaged,
  isUnstaged,
  relativeTime,
  statusMark,
} from "@/lib/derive";
import {
  clickSelection,
  emptySelection,
  primarySelectedKey,
  pruneSelection,
  type Selection,
} from "@/lib/selection";
import { highlightFile } from "@/lib/highlight";
import { getDiff, readFileContent } from "@/lib/tauri";
import { buildStatusTree } from "@/lib/tree";
import { fuzzyMatch } from "@/features/palette/fuzzyMatch";
import { PGPane, FocusableScroll, useAction } from "@/features/keymap";
import type {
  BranchInfo,
  FileContent,
  FileDiff,
  FileStatus,
  StatusFlag,
  TagInfo,
} from "@/lib/types";

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
  const tags = useRepoStore((s) => s.tags);
  const commits = useRepoStore((s) => s.commits);
  const loading = useRepoStore((s) => s.loading);
  const refreshAllFiles = useRepoStore((s) => s.refreshAllFiles);
  const listFilesAtRev = useRepoStore((s) => s.listFilesAtRev);
  const readFileContentAtRev = useRepoStore((s) => s.readFileContentAtRev);
  const diffContextLines = useSettingsStore((s) => s.diffContextLines);

  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const [treeFilter, setTreeFilter] = React.useState("");
  const filterInputRef = React.useRef<HTMLInputElement>(null);
  const [sel, setSel] = React.useState<Selection>(emptySelection);
  const [diff, setDiff] = React.useState<FileDiff | null>(null);
  const [diffLoading, setDiffLoading] = React.useState(false);
  const [fileContent, setFileContent] = React.useState<FileContent | null>(null);
  const [filterMode, setFilterMode] = React.useState<
    "all" | "changes" | "conflicts"
  >("changes");
  // Revision being browsed. null = working tree / HEAD (default behavior).
  // When set, the tree and previews come from that committed tree snapshot.
  const [rev, setRev] = React.useState<string | null>(null);
  const [revFiles, setRevFiles] = React.useState<FileStatus[]>([]);
  const [revLoading, setRevLoading] = React.useState(false);
  const browsingRev = rev !== null;
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

  // Reset browse state when the repo changes (switch repos / close). Otherwise
  // the previous repo's revspec lingers, applied to the new repo — surfacing a
  // spurious InvalidRef. Working tree (null) is the default.
  React.useEffect(() => {
    setRev(null);
    setSel(emptySelection);
  }, [repo?.id]);

  // Refresh the full file list each time the user picks "All" so the tree
  // reflects newly created / deleted files.
  React.useEffect(() => {
    if (filterMode === "all" && repo) {
      refreshAllFiles();
    }
  }, [filterMode, repo, refreshAllFiles]);

  // Load the file tree of the selected revision. Clears when back to HEAD.
  React.useEffect(() => {
    if (!repo || rev === null) {
      setRevFiles([]);
      return;
    }
    let cancelled = false;
    setRevLoading(true);
    listFilesAtRev(rev)
      .then((files) => {
        if (!cancelled) setRevFiles(files ?? []);
      })
      .finally(() => {
        if (!cancelled) setRevLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repo, rev, listFilesAtRev]);

  const filteredStatus = React.useMemo<FileStatus[]>(() => {
    let base: FileStatus[];
    // Browsing a committed revision: show its whole tree, no status filtering.
    if (browsingRev) {
      base = revFiles;
    } else {
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
      if (hiddenKinds.size > 0) {
        base = base.filter((s) => !isHidden(s, hiddenKinds));
      }
    }
    // Live fuzzy filter from the "Find in tree" box — matches the full path.
    const q = treeFilter.trim();
    if (q) base = base.filter((s) => fuzzyMatch(q, s.path).matched);
    return base;
  }, [status, allFiles, filterMode, hiddenKinds, browsingRev, revFiles, treeFilter]);

  const tree = React.useMemo<PGFileTreeNode[]>(() => {
    const t = buildStatusTree(filteredStatus);
    return sortMode === "desc" ? reverseTree(t) : t;
  }, [filteredStatus, sortMode]);

  // Expand-all / collapse-all: set every folder key true / false. Collapse must
  // write explicit `false` (not clear the map) to override defaultExpanded.
  const folderKeys = React.useMemo(() => collectFolderKeys(tree), [tree]);
  const expandAll = React.useCallback(
    () => setExpanded(Object.fromEntries(folderKeys.map((k) => [k, true]))),
    [folderKeys],
  );
  const collapseAll = React.useCallback(
    () => setExpanded(Object.fromEntries(folderKeys.map((k) => [k, false]))),
    [folderKeys],
  );

  // While the filter box is active, expand every folder so matches show
  // regardless of the persisted expand state.
  const filtering = treeFilter.trim().length > 0;
  const expandedForRender = React.useMemo(
    () =>
      filtering
        ? Object.fromEntries(folderKeys.map((k) => [k, true]))
        : expanded,
    [filtering, folderKeys, expanded],
  );

  // Visible row order (folders included) for shift-click ranges; selection
  // keys are PGFileTree keys of the form "/a/b/c".
  const rowOrder = React.useMemo(
    () => flattenFileTree(tree, expandedForRender).map((f) => f.key),
    [tree, expandedForRender],
  );
  const selectedKeys = React.useMemo(() => new Set(sel.keys), [sel]);
  const selected = primarySelectedKey(sel);

  // ⌘⇧F focuses the filter box (chord advertised by the search chip).
  useAction(
    "tree.find",
    () => {
      filterInputRef.current?.focus();
      filterInputRef.current?.select();
      return true;
    },
    [],
  );

  // Prune selection when rows disappear (filter/rev/sort change, refresh).
  // Validity is against the full tree, not just visible rows — collapsing a
  // folder hides rows without deselecting them.
  React.useEffect(() => {
    setSel((s) => pruneSelection(s, new Set(flattenAllKeys(tree))));
  }, [tree]);

  const onTreeSelect = React.useCallback(
    (key: string, _node: PGFileTreeNode, e?: React.MouseEvent) => {
      setSel((s) =>
        clickSelection(rowOrder, s, key, {
          toggle: !!e && (e.metaKey || e.ctrlKey),
          range: !!e?.shiftKey,
        }),
      );
    },
    [rowOrder],
  );

  // Map selected tree keys to worktree statuses for multi-file operations.
  // A selected FOLDER key resolves to no file entry, so expand it to every
  // visible descendant file (against the tree's source set, `filteredStatus`)
  // — otherwise a selected folder is silently dropped from the count and from
  // Stage/Discard, under-counting a destructive op. In all-files mode
  // unmodified files only exist in allFiles, not status — they carry no
  // stage/unstage actions but still count and copy.
  const splitSelection = React.useCallback(
    (
      keys: string[],
    ): { stagedPaths: string[]; unstagedPaths: string[]; paths: string[] } => {
      const stagedPaths: string[] = [];
      const unstagedPaths: string[] = [];
      const paths: string[] = [];
      const seen = new Set<string>();
      const add = (st: FileStatus) => {
        if (seen.has(st.path)) return;
        seen.add(st.path);
        paths.push(st.path);
        if (isStaged(st)) stagedPaths.push(st.path);
        if (isUnstaged(st)) unstagedPaths.push(st.path);
      };
      for (const key of keys) {
        const path = key.replace(/^\//, "");
        const st =
          status.find((s) => s.path === path) ??
          allFiles.find((s) => s.path === path);
        if (st) {
          add(st);
          continue;
        }
        // Folder key: pull in every visible file beneath it.
        const prefix = path + "/";
        for (const child of filteredStatus) {
          if (child.path.startsWith(prefix)) add(child);
        }
      }
      return { stagedPaths, unstagedPaths, paths };
    },
    [status, allFiles, filteredStatus],
  );

  const fileCtx = useContextMenu<{ key: string; node: PGFileTreeNode }>(
    ({ key, node }) => {
      if (sel.keys.length > 1 && sel.keys.includes(key)) {
        return multiFileMenuItems(splitSelection(sel.keys));
      }
      if (node.children?.length) return [];
      const path = key.replace(/^\//, "");
      const st = status.find((s) => s.path === path);
      return fileMenuItems({ path, staged: !!st && isStaged(st) && !isUnstaged(st) });
    },
  );

  const onTreeContextMenu = React.useCallback(
    (e: React.MouseEvent, key: string, node: PGFileTreeNode) => {
      if (browsingRev) return; // committed snapshot — no worktree to act on
      if (!(sel.keys.length > 1 && sel.keys.includes(key))) {
        setSel({ keys: [key], anchor: key });
      }
      fileCtx.onContextMenu(e, { key, node });
    },
    [browsingRev, sel, fileCtx],
  );

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
    if (browsingRev) {
      return revFiles.find((s) => s.path === path) ?? null;
    }
    return (
      status.find((s) => s.path === path) ??
      allFiles.find((s) => s.path === path) ??
      null
    );
  }, [selected, status, allFiles, browsingRev, revFiles]);

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
    if (browsingRev && rev) {
      // Historical snapshot: always show the file's content at that revision.
      setDiff(null);
      readFileContentAtRev(rev, selectedFile.path)
        .then((c) => {
          if (!cancelled) setFileContent(c);
        })
        .finally(() => {
          if (!cancelled) setDiffLoading(false);
        });
    } else if (selectedIsUnmodified) {
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
      getDiff(repo.id, selectedFile.path, "WorktreeToHead", diffContextLines)
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
  }, [selectedFile?.path, selectedIsUnmodified, repo, browsingRev, rev, readFileContentAtRev, diffContextLines]);

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
            {browsingRev ? (
              <PGBadge tone="muted" icon="history">
                Browsing {rev}
              </PGBadge>
            ) : (
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
            )}
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
        <PGPane
          id="repo.tree"
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
              flexDirection: "column",
              gap: 6,
            }}
          >
            <RevisionBar
              rev={rev}
              onChange={(r) => {
                setRev(r);
                setSel(emptySelection);
              }}
              branches={branches}
              tags={tags}
            />
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <PGSearchInput
                inputRef={filterInputRef}
                value={treeFilter}
                onChange={setTreeFilter}
                placeholder="Find in tree…"
                shortcut="⌘⇧F"
                style={{ flex: 1, minWidth: 0 }}
              />
              <PGIconButton
                icon="expandAll"
                size="sm"
                title="Expand all"
                onClick={expandAll}
              />
              <PGIconButton
                icon="collapseAll"
                size="sm"
                title="Collapse all"
                onClick={collapseAll}
              />
            </div>
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: "4px 0" }}>
            {tree.length === 0 && !loading && !revLoading && (
              <div
                style={{
                  padding: 14,
                  color: "var(--fg-3)",
                  fontSize: "var(--fs-11)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {filtering
                  ? `No files match "${treeFilter.trim()}".`
                  : browsingRev
                    ? "No files at this revision."
                    : filterMode === "all"
                      ? "No files."
                      : filterMode === "conflicts"
                        ? "No conflicts."
                        : "Working tree clean."}
              </div>
            )}
            {(loading || revLoading) && tree.length === 0 && (
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
              expanded={expandedForRender}
              onToggle={(k) =>
                setExpanded((e) => ({ ...e, [k]: !e[k] }))
              }
              selected={selected ?? undefined}
              selectedKeys={selectedKeys}
              onSelect={onTreeSelect}
              onActivate={(k, n) => onTreeSelect(k, n)}
              onRowContextMenu={onTreeContextMenu}
            />
            {fileCtx.menu}
          </div>
        </PGPane>
        <PGResizeHandle onDrag={treePane.resize} />

        {/* Preview + meta */}
        <PGPane
          id="repo.preview"
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
                {browsingRev ? (
                  <PGBadge tone="muted">@ {rev}</PGBadge>
                ) : (
                  fileContent?.fromHead && (
                    <PGBadge tone="muted">from HEAD</PGBadge>
                  )
                )}
              </>
            ) : (
              <span style={{ color: "var(--fg-3)" }}>
                {browsingRev
                  ? `Select a file to view its content at ${rev}`
                  : filterMode === "all"
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
          <FocusableScroll style={{ flex: 1 }} ariaLabel="File preview">
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
          </FocusableScroll>
        </PGPane>

        <PGResizeHandle
          onDrag={(d) => inspectorPane.resize(-d)}
          side="left"
        />

        {/* Right inspector */}
        <PGPane
          id="repo.inspector"
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
        </PGPane>
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

/** Every key in the tree regardless of expansion — collapsed rows stay selected. */
function flattenAllKeys(nodes: PGFileTreeNode[]): string[] {
  const out: string[] = [];
  const walk = (list: PGFileTreeNode[], parentKey: string) => {
    for (const n of list) {
      const key = parentKey + "/" + n.name;
      out.push(key);
      if (n.children) walk(n.children, key);
    }
  };
  walk(nodes, "");
  return out;
}

/** Keys of every folder (node with children) — the set expand/collapse-all toggles. */
function collectFolderKeys(nodes: PGFileTreeNode[]): string[] {
  const out: string[] = [];
  const walk = (list: PGFileTreeNode[], parentKey: string) => {
    for (const n of list) {
      const key = parentKey + "/" + n.name;
      if (n.children && n.children.length) {
        out.push(key);
        walk(n.children, key);
      }
    }
  };
  walk(nodes, "");
  return out;
}

function reverseTree(nodes: PGFileTreeNode[]): PGFileTreeNode[] {
  const copy = [...nodes].reverse();
  return copy.map((n) =>
    n.children
      ? { ...n, children: reverseTree(n.children) }
      : n,
  );
}

/**
 * Revision selector for the repo browser. Default (null) browses the working
 * tree / HEAD. Pick a branch/tag from the quick menu, or type any revspec
 * (commit SHA, `HEAD~3`, `tag^{}`, …) and press Enter.
 */
function RevisionBar({
  rev,
  onChange,
  branches,
  tags,
}: {
  rev: string | null;
  onChange: (rev: string | null) => void;
  branches: BranchInfo[];
  tags: TagInfo[];
}) {
  const [draft, setDraft] = React.useState(rev ?? "");

  // Keep the input in sync when the rev changes from outside (e.g. quick-pick).
  React.useEffect(() => {
    setDraft(rev ?? "");
  }, [rev]);

  const commit = () => {
    const v = draft.trim();
    onChange(v === "" ? null : v);
  };

  const { openAt, menu } = useContextMenu<null>(() => {
    const items: ContextMenuItem[] = [
      {
        icon: rev === null ? "check" : "history",
        label: "Working tree (HEAD)",
        onClick: () => onChange(null),
      },
    ];
    const localBranches = branches.filter((b) => !b.isRemote);
    if (localBranches.length) {
      items.push({ __menuTitle: "Branches" });
      for (const b of localBranches) {
        items.push({
          icon: rev === b.name ? "check" : "branch",
          label: b.name,
          onClick: () => onChange(b.name),
        });
      }
    }
    if (tags.length) {
      items.push({ __menuTitle: "Tags" });
      for (const t of tags) {
        items.push({
          icon: rev === t.name ? "check" : "tag",
          label: t.name,
          onClick: () => onChange(t.name),
        });
      }
    }
    return items;
  });

  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      <PGInput
        value={draft}
        onChange={setDraft}
        placeholder="HEAD"
        icon="history"
        size="sm"
        mono
        title="Browse a revision — commit SHA, branch, tag, or revspec"
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          else if (e.key === "Escape") setDraft(rev ?? "");
        }}
        onBlur={commit}
        style={{ flex: 1, minWidth: 0 }}
      />
      <PGIconButton
        icon="chevronDown"
        size="sm"
        title="Pick branch or tag"
        active={rev !== null}
        onClick={(e) => openAt(e.clientX, e.clientY + 4, null)}
      />
      {rev !== null && (
        <PGIconButton
          icon="x"
          size="sm"
          title="Back to working tree"
          onClick={() => onChange(null)}
        />
      )}
      {menu}
    </div>
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
