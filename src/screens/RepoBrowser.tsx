import React from "react";
import {
  PGBadge,
  PGBranchPill,
  PGButton,
  PGButtonGroup,
  PGEmpty,
  PGFileTree,
  PGWindowedDiff,
  PGIconButton,
  PGInput,
  PGPanel,
  PGResizeHandle,
  PGSearchInput,
  PGSkeleton,
  PGStatusMark,
  PGToolbar,
  KV,
  fileMenuItems,
  FILE_TREE_ROW_BASE_H,
  flattenFileTree,
  multiFileMenuItems,
  pgConfirm,
  diffCopyMenuItems,
  useContextMenu,
  usePaneSize,
  PANE_HANDLE_PX,
  type ContextMenuItem,
  type PGFileTreeNode,
} from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { useDensityStep, useSettingsStore } from "@/features/settings/useSettingsStore";
import { useWindowedList } from "@/lib/useWindowedList";
import {
  currentBranch,
  isConflicted,
  isStaged,
  isTextualDiff,
  isUnstaged,
  isUntracked,
  relativeTime,
  statusMark,
} from "@/lib/derive";
import { LfsDiffNotice } from "@/features/lfs/LfsDiffNotice";
import {
  clickSelection,
  emptySelection,
  primarySelectedKey,
  pruneSelection,
  splitFileSelection,
  treeSelectionSource,
  type FileSelectionSplit,
  type Selection,
} from "@/lib/selection";
import { EMBEDDED_REPO_HELP, appErrorMessage } from "@/lib/errors";
import { useDiffSyntax, useSyntax } from "@/lib/syntax";
import {
  flattenDiffRows,
  hunkExtentRows,
  scrollTopForHunk,
} from "@/lib/diffRows";
import { useVariableWindow } from "@/lib/useVariableWindow";
import { useViewportH } from "@/lib/useViewportH";
import { useElementSize } from "@/lib/useElementSize";
import { MinimapGutter } from "@/features/diff/DiffMinimap";
import { useDiffRowHeight } from "@/lib/useDiffRowHeight";
import { buildLineSpans } from "@/lib/lineSpans";
import { splitCodeLines } from "@/lib/codeLines";
import { getDiff, readFileContent } from "@/lib/tauri";
import {
  buildStatusList,
  buildStatusTree,
  findStatusByTreeKey,
  treeKeyToPath,
} from "@/lib/tree";
import { useTreeViewMode } from "@/lib/useTreeViewMode";
import { StageDropBar, useDragSource, type DragPayload } from "@/features/dnd";
import { fuzzyMatch } from "@/features/palette/fuzzyMatch";
import { usePlatform } from "@/lib/platform";
import {
  WhitespaceToggle,
  useHunkActionsDisabledReason,
  useIgnoreWhitespace,
} from "@/features/diff/WhitespaceToggle";
import {
  diffOpenReady,
  useDiffGaps,
  useExpandedGaps,
} from "@/features/diff/useDiffGaps";
import {
  PGPane,
  FocusableScroll,
  useAction,
  useHunkNav,
  usePaneList,
} from "@/features/keymap";
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

/** The middle pane holds a file preview or a diff — it needs a code column. */
const PREVIEW_MIN_W = 360;
/** The inspector is a label/value list; this is its floor as well as its reserve. */
const INSPECTOR_MIN_W = 200;

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
  const ignoreWhitespace = useIgnoreWhitespace();
  const hunkActionsDisabled = useHunkActionsDisabledReason();
  const platform = usePlatform();

  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const [treeFilter, setTreeFilter] = React.useState("");
  const filterInputRef = React.useRef<HTMLInputElement>(null);
  const [sel, setSel] = React.useState<Selection>(emptySelection);
  /** Moving end of a keyboard Shift range — see the usePaneList block below. */
  const [leadKey, setLeadKey] = React.useState<string | null>(null);
  const [diff, setDiff] = React.useState<FileDiff | null>(null);
  const [diffLoading, setDiffLoading] = React.useState(false);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
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
  const [viewMode, setViewMode] = useTreeViewMode("pg-repo-view-mode");
  const setNavIntent = useNavStore((s) => s.setIntent);
  // Three panes in one container: tree | preview (flexible) | inspector (#162).
  // So each fixed pane caps itself against the preview's floor AND the other
  // fixed pane. The tree reserves the inspector's MINIMUM while the inspector
  // reserves the tree's ACTUAL size — one side has to be static or the two
  // clamps would be circular, and yielding to the tree keeps the preview's floor
  // exact (see paneSize.test.ts's three-pane invariant).
  const layout = useElementSize();
  const treePane = usePaneSize(280, {
    axis: "width",
    container: layout,
    min: 180,
    siblingMin: PREVIEW_MIN_W,
    reserve: INSPECTOR_MIN_W + PANE_HANDLE_PX,
    storageKey: "pg-repo-tree-w",
  });
  const inspectorPane = usePaneSize(260, {
    axis: "width",
    container: layout,
    min: INSPECTOR_MIN_W,
    siblingMin: PREVIEW_MIN_W,
    reserve: treePane.size + PANE_HANDLE_PX,
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
          base = status.filter(isConflicted);
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

  // Flat mode reuses the very same row component and row keys — only the
  // nesting differs — so selection, staging and context menus need no
  // per-mode branches anywhere below.
  const tree = React.useMemo<PGFileTreeNode[]>(() => {
    const t =
      viewMode === "flat"
        ? buildStatusList(filteredStatus)
        : buildStatusTree(filteredStatus);
    return sortMode === "desc" ? reverseTree(t) : t;
  }, [filteredStatus, sortMode, viewMode]);

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

  // Visible rows (folders included) for shift ranges and keyboard nav;
  // selection keys are PGFileTree keys of the form "/a/b/c".
  const flatRows = React.useMemo(
    () => flattenFileTree(tree, expandedForRender),
    [tree, expandedForRender],
  );
  const rowOrder = React.useMemo(() => flatRows.map((f) => f.key), [flatRows]);

  // "All files" lists every file in the repo, so only the visible slice is
  // mounted (#61 A8). This screen owns the window because it already owns both
  // the scroll element and the flattened row order `usePaneList` indexes.
  const treeScrollRef = React.useRef<HTMLDivElement>(null);
  const treeRowH = FILE_TREE_ROW_BASE_H + useDensityStep();
  const treeWin = useWindowedList({
    count: flatRows.length,
    rowHeight: treeRowH,
    viewportRef: treeScrollRef,
  });
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
      setLeadKey(key);
    },
    [rowOrder],
  );

  // Map selected tree keys to worktree statuses for multi-file operations.
  // A selected FOLDER key resolves to no file entry, so it expands to every
  // visible descendant file (against the tree's source set, `filteredStatus`)
  // — otherwise a selected folder is silently dropped from the count and from
  // Stage/Discard, under-counting a destructive op. In all-files mode
  // unmodified files only exist in allFiles, not status — they carry no
  // stage/unstage actions but still count and copy. The bucketing rules
  // themselves live in lib/selection so the commit panel cannot drift from
  // them (#47).
  const selectionSource = React.useMemo(
    () => treeSelectionSource(filteredStatus, status, allFiles),
    [filteredStatus, status, allFiles],
  );
  const splitSelection = React.useCallback(
    (keys: string[]): FileSelectionSplit =>
      splitFileSelection(keys, selectionSource),
    [selectionSource],
  );

  /**
   * Tri-state staging for every tree row, computed in one bottom-up walk.
   *
   * Per-row lookup would be O(rows x files) — a folder would rescan the whole
   * status list on every render — so counts roll up from the leaves instead:
   * a folder is "all" only when every stageable descendant is fully staged,
   * "none" when none are, "partial" otherwise. Rows with nothing to stage
   * (unmodified in All-files mode, embedded repos, folders holding only such
   * rows) are absent from the map and render no checkbox.
   */
  const stageStates = React.useMemo(() => {
    const out = new Map<string, "none" | "partial" | "all">();
    // Browsing a committed snapshot: there is no worktree to stage from.
    if (browsingRev) return out;
    const byPath = new Map<string, FileStatus>();
    for (const s of filteredStatus) byPath.set(s.path.replace(/\/+$/, ""), s);

    type Counts = { all: number; partial: number; none: number };
    const walk = (nodes: PGFileTreeNode[], parentKey: string): Counts => {
      const acc: Counts = { all: 0, partial: 0, none: 0 };
      for (const n of nodes) {
        const key = parentKey + "/" + n.name;
        if (n.children?.length) {
          const c = walk(n.children, key);
          const total = c.all + c.partial + c.none;
          if (total > 0) {
            out.set(
              key,
              c.all === total ? "all" : c.none === total ? "none" : "partial",
            );
          }
          acc.all += c.all;
          acc.partial += c.partial;
          acc.none += c.none;
          continue;
        }
        const st = byPath.get(key.replace(/^\//, ""));
        // An embedded repo can't be staged (it would write a bare gitlink), and
        // an unmodified file has nothing to stage.
        if (!st || st.embedded) continue;
        const staged = isStaged(st);
        const unstaged = isUnstaged(st);
        if (!staged && !unstaged) continue;
        const state = staged ? (unstaged ? "partial" : "all") : "none";
        out.set(key, state);
        acc[state] += 1;
      }
      return acc;
    };
    walk(tree, "");
    return out;
  }, [tree, filteredStatus, browsingRev]);

  // Stable identity: PGFileTree memoizes its checkbox-column scan on this
  // callback, so an inline arrow here would re-run that whole-tree walk on
  // every render of this screen.
  const stageStateForKey = React.useCallback(
    (k: string) => stageStates.get(k),
    [stageStates],
  );

  const onStageToggle = React.useCallback(
    (key: string, _node: PGFileTreeNode, next: boolean) => {
      // Reuse the selection splitter: it already expands a folder key to every
      // visible descendant and keeps embedded repos out of the batch.
      const { stagedPaths, unstagedPaths } = splitSelection([key]);
      const store = useRepoStore.getState();
      if (next) {
        if (unstagedPaths.length) void store.stage(unstagedPaths);
      } else if (stagedPaths.length) {
        void store.unstage(stagedPaths);
      }
    },
    [splitSelection],
  );

  // ── Drag to stage / unstage (#91) ─────────────────────────────────────────
  //
  // This screen has one tree and no staged/unstaged sections, so there is
  // nothing in the layout to drop onto — `StageDropBar` supplies the two targets
  // for the duration of the gesture and then disappears.
  //
  // The source is delegated from the scroller via `data-path`, so `PGFileTreeRow`
  // needs no new prop, and both the payload and the drop go through this screen's
  // `splitSelection` — i.e. the shared `splitFileSelection` (lib/selection.ts),
  // exactly as the checkbox and the context menu do. Folder expansion and the
  // embedded-repo exclusion therefore live in one place for all four.
  const treeDragSource = useDragSource(
    React.useCallback(
      (target: HTMLElement): DragPayload | null => {
        // Browsing a committed snapshot: there is no worktree to stage from.
        if (browsingRev) return null;
        const rowEl = target.closest("[data-path]") as HTMLElement | null;
        const dataPath = rowEl?.getAttribute("data-path");
        if (dataPath == null) return null;
        const key = `/${dataPath}`;
        const keys = sel.keys.length > 1 && sel.keys.includes(key) ? sel.keys : [key];
        const { stagedPaths, unstagedPaths } = splitSelection(keys);
        // The payload is just "these files" — one tree row can be partially
        // staged, so there is no single side it came from. `side` is required by
        // the type and unused by the bar, which is an explicit command surface
        // rather than a second list (see StageDropBar). Which of these paths is
        // actionable in a given direction is decided on drop, against live status.
        const paths = [...new Set([...unstagedPaths, ...stagedPaths])];
        if (paths.length === 0) return null;
        return {
          kind: "files",
          side: "unstaged",
          paths,
          label: paths.length === 1 ? paths[0] : `${paths.length} files`,
        };
      },
      [browsingRev, sel.keys, splitSelection],
    ),
  );

  const onStageBarDrop = React.useCallback(
    ({ action, paths }: { action: "stage" | "unstage"; paths: string[] }) => {
      const store = useRepoStore.getState();
      // Re-split against live status: the payload is "these files", and only the
      // ones that actually have something to stage (or unstage) may be sent.
      const keys = paths.map((p) => `/${p}`);
      const { stagedPaths, unstagedPaths } = splitSelection(keys);
      if (action === "stage") {
        if (unstagedPaths.length) void store.stage(unstagedPaths);
      } else if (stagedPaths.length) {
        void store.unstage(stagedPaths);
      }
    },
    [splitSelection],
  );

  // ── Keyboard (#61 A7) ─────────────────────────────────────────────────────
  // The tree now goes through the same `usePaneList` every flat pane uses, so
  // it gets Home/End, Shift+Arrow ranges, Space-to-stage and type-to-jump
  // speed-search for free instead of the bare-arrow-only handler it had.
  //
  // `leadKey` is the moving end of a Shift range, tracked separately from the
  // anchor: primarySelectedKey() returns the anchor while it stays selected,
  // so extending from it alone would make repeated Shift+↓ oscillate between
  // two rows instead of growing the range.
  React.useEffect(() => {
    setLeadKey((prev) => (prev && rowOrder.includes(prev) ? prev : null));
  }, [rowOrder]);

  // -1 while nothing is selected yet, so the first ↓ lands on row 0 instead of
  // skipping it (usePaneList clamps -1 ± 1 back into range).
  const cursorIdx =
    leadKey === null && selected === null
      ? -1
      : Math.max(0, rowOrder.indexOf(leadKey ?? selected ?? ""));
  const moveTo = React.useCallback(
    (i: number, range: boolean) => {
      const key = rowOrder[Math.max(0, Math.min(rowOrder.length - 1, i))];
      if (!key) return;
      setSel((prev) => clickSelection(rowOrder, prev, key, { range }));
      setLeadKey(key);
    },
    [rowOrder],
  );

  usePaneList({
    paneId: "repo.tree",
    count: rowOrder.length,
    selectedIndex: cursorIdx,
    // The tree is windowed, so the selected row is often unmounted and the
    // hook's DOM-query fallback would find nothing (#61 A8).
    scrollToIndex: treeWin.scrollToIndex,
    onSelect: (i) => moveTo(i, false),
    onExtendUp: () => moveTo(cursorIdx - 1, true),
    onExtendDown: () => moveTo(cursorIdx + 1, true),
    // → opens a collapsed folder, then walks into it; ← closes an open folder,
    // else jumps to the parent row (standard tree semantics).
    onExpand: (i) => {
      const row = flatRows[i];
      if (!row?.hasChildren) return;
      if (!row.isExpanded) setExpanded((e) => ({ ...e, [row.key]: true }));
      else moveTo(i + 1, false);
    },
    onCollapse: (i) => {
      const row = flatRows[i];
      if (row?.hasChildren && row.isExpanded) {
        setExpanded((e) => ({ ...e, [row.key]: false }));
        return;
      }
      const parentKey = row?.key.split("/").slice(0, -1).join("/");
      const parentIdx = parentKey ? rowOrder.indexOf(parentKey) : -1;
      if (parentIdx >= 0) moveTo(parentIdx, false);
    },
    onActivate: (i) => {
      const row = flatRows[i];
      if (row?.hasChildren) {
        setExpanded((e) => ({ ...e, [row.key]: !row.isExpanded }));
      }
    },
    // Space stages/unstages the row (file or whole folder), matching the
    // checkbox it drives.
    onToggle: (i) => {
      const row = flatRows[i];
      if (!row) return;
      const state = stageStates.get(row.key);
      if (state === undefined) return;
      onStageToggle(row.key, row.node, state !== "all");
    },
    // Type-to-jump over the visible path, so "feat" lands on src/features.
    searchText: (i) => rowOrder[i]?.replace(/^\//, "") ?? "",
  });

  // Right-click in the preview pane to copy. Read-only, so no line selection to
  // offer — the dragged text and the whole file, which is the part a windowed
  // selection cannot reach.
  const diffCopyMenu = useContextMenu<void>(() => diffCopyMenuItems({ diff }));

  const fileCtx = useContextMenu<{ key: string; node: PGFileTreeNode }>(
    ({ key, node }) => {
      if (sel.keys.length > 1 && sel.keys.includes(key)) {
        return multiFileMenuItems(splitSelection(sel.keys));
      }
      // Folder: act on every file beneath it — stage / unstage / discard all,
      // the same batch menu a multi-row selection gets.
      if (node.children?.length) return multiFileMenuItems(splitSelection([key]));
      const st = findStatusByTreeKey(key, status);
      // Act on the status entry's own path, not the key: an embedded repo's
      // path carries a trailing slash the key has already lost, and that slash
      // is what makes "Add to .gitignore" write valid directory syntax.
      const path = st?.path ?? treeKeyToPath(key);
      return fileMenuItems(
        {
          path,
          staged: !!st && isStaged(st) && !isUnstaged(st),
          embedded: !!st?.embedded,
          untracked: !!st && isUntracked(st),
          conflicted: !!st && isConflicted(st),
          // A registered submodule gets its own menu (#93) — the ordinary
          // file entries are all dead ends on a gitlink.
          submodule: !!st?.submodule,
        },
        platform,
      );
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
    () => status.filter(isConflicted).length,
    [status],
  );

  // Derive the FileStatus entry that corresponds to the selected path key.
  // PGFileTree keys are path-prefixed by PG_FILETREE in the form "/a/b/c".
  const selectedFile = React.useMemo<FileStatus | null>(() => {
    if (!selected) return null;
    if (browsingRev) return findStatusByTreeKey(selected, revFiles) ?? null;
    return findStatusByTreeKey(selected, status, allFiles) ?? null;
  }, [selected, status, allFiles, browsingRev, revFiles]);

  const selectedIsUnmodified =
    !!selectedFile &&
    selectedFile.worktree.kind === "Unmodified" &&
    selectedFile.index.kind === "Unmodified";
  const selectedIsEmbedded = !!selectedFile?.embedded;

  // This pane's diff pane went unhighlighted and unwindowed through the first
  // three slices of #104 — it is a fourth diff surface that is easy to miss. It
  // compares WorktreeToHead, same as the DiffViewer.
  const browserSyntax = useDiffSyntax({
    repoId: selectedFile && !selectedIsEmbedded ? (repo?.id ?? null) : null,
    path: selectedFile?.path ?? null,
    old: { kind: "rev", rev: "HEAD", path: diff?.oldPath },
    new: { kind: "worktree" },
  });
  const diffRowH = useDiffRowHeight();
  const diffFoldH = 22 + useDensityStep();
  const { expanded: expandedGaps, expand: expandGap } = useExpandedGaps(
    selectedFile?.path ?? null,
  );
  const { gaps: browserGaps, text: browserText } = useDiffGaps(browserSyntax);
  const diffRows = React.useMemo(
    () =>
      // `isTextualDiff` also excludes an LFS pointer diff (#93) — its hunks are
      // three lines of pointer text, which must never reach a diff renderer.
      flattenDiffRows(isTextualDiff(diff) && diff ? diff.hunks : [], {
        foldH: diffFoldH,
        rowH: diffRowH,
        syntax: browserSyntax,
        text: browserText,
        gaps: browserGaps,
        expandedGaps,
      }),
    [diff, diffFoldH, diffRowH, browserSyntax, browserText, browserGaps, expandedGaps],
  );
  const diffHeights = React.useMemo(() => diffRows.map((r) => r.h), [diffRows]);
  const diffScrollRef = React.useRef<HTMLDivElement>(null);
  const { viewportH: diffViewportH, remeasure: remeasureDiff } =
    useViewportH(diffScrollRef);
  // Measured on the WRAPPER holding the scroll area and the minimap, so adding
  // the gutter cannot change the width that decides whether to add it (#161).
  const diffBox = useElementSize();
  const {
    win: diffWin,
    onScroll: onDiffScroll,
    scrollTo: scrollDiffTo,
  } = useVariableWindow({
    heights: diffHeights,
    viewportH: diffViewportH,
    scrollRef: diffScrollRef,
  });
  // ── Hunk cursor + hunk-level chords (#157) ───────────────────────────────
  // This pane had no F7 either; the `@@` banner's Stage/Discard was mouse-only.
  // Scroll BY OFFSET — the anchor row is usually unmounted under windowing.
  const diffExtents = React.useMemo(() => hunkExtentRows(diffRows), [diffRows]);
  const scrollToHunk = React.useCallback(
    (hunkIndex: number): boolean => {
      const el = diffScrollRef.current;
      const extent = diffExtents[hunkIndex];
      if (!el || extent == null || extent.first < 0) return false;
      // Through the window's own setter — see `useVariableWindow.scrollTo`.
      // CENTRED on the change, never merely revealed: see `scrollTopForHunk`.
      const want = scrollTopForHunk(diffHeights, extent, {
        scrollTop: el.scrollTop,
        viewportH: el.clientHeight,
        rowH: diffRowH,
      });
      scrollDiffTo(want);
      // Confirm the write: a container shorter than the offset CLAMPS it (a pane
      // mid-refetch is), and a reveal that did not land must not count as this
      // file having been opened — see `useHunkNav`'s `scrollToHunk`.
      return Math.abs(el.scrollTop - want) <= 1;
    },
    [diffExtents, diffHeights, diffRowH, scrollDiffTo],
  );
  const hunkCursor = useHunkNav({
    paneIds: ["repo.tree", "repo.preview"],
    count: isTextualDiff(diff) && diff ? diff.hunks.length : 0,
    resetKey: selectedFile?.path ?? null,
    scrollToHunk,
    ready: diffOpenReady({
      // The fetch is async, so this pane renders once with the outgoing file's
      // rows while the selection already names the new one.
      diffFor: diff?.path,
      showing: selectedFile?.path,
      rowCount: diffRows.length,
      viewportH: diffViewportH,
      gaps: browserGaps,
      text: browserText,
    }),
    // NO `files` here, deliberately (issue 188). This pane's list is a TREE of
    // every tracked file, not a changed set, so "the next file" would have to mean
    // "the next file with changes" — a different list from the one the tree
    // renders and the one the reader is navigating, so the selection would jump
    // past rows they never asked to skip. It can also be showing a REVISION,
    // where the pane is a preview rather than a change set, and a tree's "next"
    // is not even defined without expanding folders. F7 stays inside the file
    // here; the changed-file surfaces are where crossing belongs.
  });
  const stageHunkAt = React.useCallback((i: number) => {
    const path = selectedFile?.path;
    if (!path) return;
    useRepoStore.getState().stageHunk(path, i);
  }, [selectedFile?.path]);
  const discardHunkAt = React.useCallback(
    async (i: number) => {
      const path = selectedFile?.path;
      if (!path) return;
      if (
        await pgConfirm({
          title: "Discard this hunk?",
          body: `The change to ${path} will be lost.`,
          danger: true,
          confirmLabel: "Discard hunk",
        })
      ) {
        useRepoStore.getState().discardHunk(path, i);
      }
    },
    [selectedFile?.path],
  );
  // Decline rather than guess at hunk 0 when there is no cursor at all: Discard is
  // destructive, and ignore-whitespace makes hunk indices unusable (#61 D2).
  // Since issue 188 an opened diff usually HAS a cursor at 0 — marked and scrolled
  // to, so acting on it is not a guess. `< 0` still covers an unmeasured pane and
  // a diff with no hunks.
  useAction(
    "diff.stageHunk",
    () => {
      if (hunkCursor < 0 || hunkActionsDisabled) return false;
      stageHunkAt(hunkCursor);
      return true;
    },
    [hunkCursor, hunkActionsDisabled, stageHunkAt],
    { paneId: "repo.preview" },
  );
  useAction(
    "diff.discardHunk",
    () => {
      if (hunkCursor < 0 || hunkActionsDisabled) return false;
      void discardHunkAt(hunkCursor);
      return true;
    },
    [hunkCursor, hunkActionsDisabled, discardHunkAt],
    { paneId: "repo.preview" },
  );

  React.useEffect(() => {
    if (!selectedFile || !repo) {
      setDiff(null);
      setFileContent(null);
      setPreviewError(null);
      return;
    }
    setPreviewError(null);
    // An embedded repo has no diff and no content — EmbeddedRepoPanel takes
    // over the pane, so don't ask the backend for either.
    if (selectedFile.embedded) {
      setDiff(null);
      setFileContent(null);
      setDiffLoading(false);
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
      getDiff(
        repo.id,
        selectedFile.path,
        "WorktreeToHead",
        diffContextLines,
        ignoreWhitespace,
      )
        .then((d) => {
          if (!cancelled) setDiff(d);
        })
        .catch((e) => {
          // Never swallow: a failed diff used to leave an unexplained empty
          // pane, which was the original embedded-repo symptom.
          if (!cancelled) {
            setDiff(null);
            setPreviewError(appErrorMessage(e));
          }
        })
        .finally(() => {
          if (!cancelled) setDiffLoading(false);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [selectedFile?.path, selectedFile?.embedded, selectedIsUnmodified, repo, browsingRev, rev, readFileContentAtRev, diffContextLines, ignoreWhitespace]);

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
      <div ref={layout.ref} style={{ flex: 1, minHeight: 0, display: "flex" }}>
        {/* File tree */}
        <PGPane
          id="repo.tree"
          primary
          style={{
            width: treePane.size,
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
                icon={viewMode === "tree" ? "viewTree" : "viewList"}
                size="sm"
                title={
                  viewMode === "tree"
                    ? "Tree view — switch to flat list"
                    : "Flat list — switch to tree view"
                }
                onClick={() =>
                  setViewMode(viewMode === "tree" ? "flat" : "tree")
                }
              />
              {/* Nothing to fold in a flat list. */}
              {viewMode === "tree" && (
                <>
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
                </>
              )}
            </div>
          </div>
          <div
            ref={treeScrollRef}
            onScroll={treeWin.onScroll}
            {...treeDragSource}
            style={{ flex: 1, overflow: "auto", padding: "4px 0" }}
          >
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
                style={{ padding: "4px 8px" }}
                aria-busy="true"
                aria-label="Loading files"
              >
                <PGSkeleton count={10} rowStep />
              </div>
            )}
            <PGFileTree
              nodes={tree}
              expanded={expandedForRender}
              onToggle={(k, next) => setExpanded((e) => ({ ...e, [k]: next }))}
              selected={selected ?? undefined}
              selectedKeys={selectedKeys}
              onSelect={onTreeSelect}
              onRowContextMenu={onTreeContextMenu}
              stageState={stageStateForKey}
              onStageToggle={onStageToggle}
              window={treeWin}
            />
            {fileCtx.menu}
            {diffCopyMenu.menu}
          </div>
          <StageDropBar onDrop={onStageBarDrop} />
        </PGPane>
        <PGResizeHandle onDrag={treePane.resize} onReset={treePane.reset} />

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
                {isTextualDiff(diff) && diff && (
                  <>
                    <PGBadge tone="success">+{diff.additions}</PGBadge>
                    <PGBadge tone="danger">−{diff.deletions}</PGBadge>
                  </>
                )}
                {diff?.binary && <PGBadge tone="muted">binary</PGBadge>}
                {diff?.lfs && <PGBadge tone="accent">LFS</PGBadge>}
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
            <WhitespaceToggle />
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
              disabled={!selectedFile || selectedIsEmbedded}
              title={
                selectedIsEmbedded
                  ? "Embedded git repositories have no blame"
                  : "Show blame"
              }
              onClick={() => {
                if (selectedFile)
                  setNavIntent({ kind: "blame", path: selectedFile.path });
              }}
            >
              Blame
            </PGButton>
          </div>
          <div
            ref={diffBox.ref}
            style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex" }}
          >
          <FocusableScroll
            style={{ flex: 1, minWidth: 0 }}
            ariaLabel="File preview"
            innerRef={diffScrollRef}
            onScroll={() => {
              onDiffScroll();
              remeasureDiff();
            }}
            onContextMenu={(e) => diffCopyMenu.onContextMenu(e, undefined)}
          >
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
              // Code lines, not list rows: --lh-code owns diff/preview
              // geometry, so this deliberately does NOT use rowStep (#61 B6).
              <div
                style={{ padding: 12 }}
                aria-busy="true"
                aria-label="Loading file"
              >
                <PGSkeleton count={14} height={10} gap={5} />
              </div>
            )}
            {selectedFile && selectedIsEmbedded && (
              <EmbeddedRepoPanel path={selectedFile.path} />
            )}
            {selectedFile && !diffLoading && !selectedIsEmbedded && previewError && (
              <PGEmpty icon="warn" title="Couldn't load this file">
                {previewError}
              </PGEmpty>
            )}
            {selectedFile && !diffLoading && isTextualDiff(diff) && diff && (
              <PGWindowedDiff
                rows={diffRows}
                window={diffWin}
                activeHunk={hunkCursor >= 0 ? hunkCursor : undefined}
                onExpandGap={expandGap}
                hunkActions={(i) => ({
                  staged: false,
                  actionsDisabledReason: hunkActionsDisabled,
                  onStage: () => stageHunkAt(i),
                  onDiscard: () => void discardHunkAt(i),
                })}
              />
            )}
            {selectedFile && !diffLoading && diff?.binary && (
              <PGEmpty icon="file" title="Binary file">
                Binary diffs aren&apos;t shown.
              </PGEmpty>
            )}
            {selectedFile && !diffLoading && diff?.lfs && (
              <LfsDiffNotice diff={diff} />
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
            {selectedFile && !diffLoading && !selectedIsEmbedded && !previewError &&
              !fileContent &&
              (!diff || diff.hunks.length === 0) && !diff?.binary && !diff?.lfs && (
                <PGEmpty icon="file" title="No diff available">
                  Couldn&apos;t produce a diff for this file.
                </PGEmpty>
              )}
          </FocusableScroll>
          {/* Only for a DIFF: this pane also renders plain file content, which has
              no row model and no heights array for a gutter to derive from. */}
          {selectedFile && !diffLoading && isTextualDiff(diff) && diff && (
            <MinimapGutter
              rows={diffRows}
              heights={diffHeights}
              rowH={diffRowH}
              viewportH={diffViewportH}
              scrollRef={diffScrollRef}
              containerWidth={diffBox.width}
              containerHeight={diffBox.height}
            />
          )}
          </div>
        </PGPane>

        <PGResizeHandle
          onDrag={(d) => inspectorPane.resize(-d)}
          onReset={inspectorPane.reset}
          side="left"
        />

        {/* Right inspector */}
        <PGPane
          id="repo.inspector"
          style={{
            width: inspectorPane.size,
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

/**
 * Preview pane for an embedded git repository. There is nothing to diff, so
 * explain what the row is and offer the way out instead of leaving the pane
 * blank (the original bug) or dumping a raw error into the global banner.
 */
function EmbeddedRepoPanel({ path }: { path: string }) {
  const appendGitignore = useRepoStore((s) => s.appendGitignore);
  return (
    <PGEmpty icon="warn" title="Embedded git repository">
      <div
        style={{ display: "flex", flexDirection: "column", gap: 10 }}
        data-testid="embedded-repo-panel"
      >
        <span>
          <span className="mono">{path}</span> {EMBEDDED_REPO_HELP}
        </span>
        <div>
          <PGButton
            size="sm"
            icon="trash"
            onClick={() => void appendGitignore(path)}
          >
            Add to .gitignore
          </PGButton>
        </div>
      </div>
    </PGEmpty>
  );
}

function FileContentView({ path, text }: { path: string; text: string }) {
  const lines = React.useMemo(() => splitCodeLines(text), [text]);
  // Tokens arrive after first paint; until then the rows render plain, which is
  // why nothing here waits on them.
  const syntax = useSyntax(path, text);

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
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-12)",
        lineHeight: "var(--lh-code)",
        background: "transparent",
        color: "var(--fg-0)",
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
          >
            {line === ""
              ? " "
              : buildLineSpans(line, syntax?.[i] ?? null, undefined).map((s, k) => (
                  <span key={k} className={s.cls}>
                    {line.slice(s.start, s.end)}
                  </span>
                ))}
          </span>
        </div>
      ))}
    </div>
  );
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
