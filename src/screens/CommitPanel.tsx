import React from "react";
import {
  PGAvatar,
  PGBadge,
  PGButton,
  PGButtonGroup,
  PGChangeRow,
  PGCheckbox,
  PGEmpty,
  PGFileTree,
  PGWindowedDiff,
  PGIconButton,
  PGInput,
  PGSideBySideDiff,
  PGSpinner,
  PGStatusMark,
  PGResizeHandle,
  PGTextarea,
  fileMenuItems,
  multiFileMenuItems,
  pgConfirm,
  pgFlash,
  pgPrompt,
  useContextMenu,
  usePaneSize,
  PANE_HANDLE_PX,
  type PGFileTreeNode,
  type PGStageState,
  type SideLine,
} from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { useDensityStep, useSettingsStore } from "@/features/settings/useSettingsStore";
import {
  PGPane,
  FocusableScroll,
  usePaneList,
  useAction,
  useDiffLineFocus,
  useHunkNav,
  type DiffLineTarget,
} from "@/features/keymap";
import { stageablePaths } from "@/features/repo/ops";
import {
  currentBranch,
  isConflicted,
  isStaged,
  isTextualDiff,
  isUnstaged,
  isUntracked,
  sideAdditions,
  sideDeletions,
  statusMark,
} from "@/lib/derive";
import { LfsDiffNotice } from "@/features/lfs/LfsDiffNotice";
import { EMBEDDED_REPO_HELP, appErrorMessage } from "@/lib/errors";
import {
  clickSelection,
  emptySelection,
  primarySelectedKey,
  pruneSelection,
  sidedFileKey,
  sidedFolderKey,
  sidedSelectionSource,
  splitFileSelection,
  type Selection,
} from "@/lib/selection";
import { getDiff, getLogPage } from "@/lib/tauri";
import { useDiffSyntax } from "@/lib/syntax";
import {
  flattenDiffRows,
  hunkAnchorRows,
  scrollTopForRow,
} from "@/lib/diffRows";
import { useVariableWindow } from "@/lib/useVariableWindow";
import { useViewportH } from "@/lib/useViewportH";
import { useElementSize } from "@/lib/useElementSize";
import { MinimapGutter } from "@/features/diff/DiffMinimap";
import { useDiffRowHeight } from "@/lib/useDiffRowHeight";
import {
  WhitespaceToggle,
  useHunkActionsDisabledReason,
  useIgnoreWhitespace,
} from "@/features/diff/WhitespaceToggle";
import { useDiffGaps, useExpandedGaps } from "@/features/diff/useDiffGaps";
import { buildStatusTree, findStatusByTreeKey, treeKeyToPath } from "@/lib/tree";
import { useTreeViewMode } from "@/lib/useTreeViewMode";
import {
  resolveStagingDrop,
  useDragSource,
  useDropZone,
  type DragPayload,
} from "@/features/dnd";
import type {
  AuthorOverride,
  CommitInfo,
  DiffKind,
  FileDiff,
  FileStatus,
} from "@/lib/types";

/** The middle column renders a diff — a code column is its reason to exist. */
const DIFF_MIN_W = 360;
/** The composer's floor, and what the changes list reserves for it. */
const COMPOSER_MIN_W = 280;

interface FileSlot {
  path: string;
  status: FileStatus;
  side: "staged" | "unstaged";
}

export function CommitPanelScreen() {
  const repo = useRepoStore((s) => s.current);
  const status = useRepoStore((s) => s.status);
  const branches = useRepoStore((s) => s.branches);
  const remotes = useRepoStore((s) => s.remotes);
  const loading = useRepoStore((s) => s.loading);
  const stage = useRepoStore((s) => s.stage);
  const unstage = useRepoStore((s) => s.unstage);
  const commitAction = useRepoStore((s) => s.commit);
  const pushAction = useRepoStore((s) => s.push);
  const activity = useRepoStore((s) => s.activity);
  const commits = useRepoStore((s) => s.commits);
  const setNavIntent = useNavStore((s) => s.setIntent);
  const addSignoff = useSettingsStore((s) => s.addSignoff);
  const setSetting = useSettingsStore((s) => s.set);
  const diffContextLines = useSettingsStore((s) => s.diffContextLines);
  const ignoreWhitespace = useIgnoreWhitespace();
  const hunkActionsDisabled = useHunkActionsDisabledReason();
  // One box for the whole commit message: first line is the subject, the rest
  // is the body — the same shape git itself stores, so nothing is re-joined on
  // the way out.
  const [message, setMessage] = React.useState("");
  const [amend, setAmend] = React.useState(false);
  // The draft that amend's prefill displaced, restored when amend is unchecked.
  const draftRef = React.useRef<string | null>(null);
  // Generation counter for in-flight amend prefills (see toggleAmend).
  const amendReqRef = React.useRef(0);
  // Sign-off toggle seeds from the persisted preference; toggling it writes back.
  const [signoff, setSignoff] = React.useState(addSignoff);
  // Signing (#61 D6). null = follow the setting, which itself defaults to
  // following commit.gpgsign; a per-commit toggle overrides just this commit.
  const [signOverride, setSignOverride] = React.useState<boolean | null>(null);
  const signSetting = useSettingsStore((s) => s.signCommits);
  const signForCommit =
    signOverride ??
    (signSetting === "always" ? true : signSetting === "never" ? false : null);
  // Attribution (#61 D1). Blank author = repo config identity, the normal case.
  const [authorAs, setAuthorAs] = React.useState("");
  const [coAuthors, setCoAuthors] = React.useState("");
  const [diffMode, setDiffMode] = React.useState<"unified" | "split">("unified");
  const [viewMode, setViewMode] = useTreeViewMode("pg-commit-view-mode", "flat");
  const [stagedExpanded, setStagedExpanded] = React.useState<
    Record<string, boolean>
  >({});
  const [unstagedExpanded, setUnstagedExpanded] = React.useState<
    Record<string, boolean>
  >({});
  const [sel, setSel] = React.useState<Selection>(emptySelection);
  // Three panes: changes | diff (flexible) | composer (#162). Same asymmetry
  // RepoBrowser uses — the first pane reserves the composer's MINIMUM, the
  // composer reserves the changes list's ACTUAL size, so the two clamps are not
  // circular and the diff column keeps its floor either way.
  const layout = useElementSize();
  const changesPane = usePaneSize(320, {
    axis: "width",
    container: layout,
    min: 220,
    siblingMin: DIFF_MIN_W,
    reserve: COMPOSER_MIN_W + PANE_HANDLE_PX,
    storageKey: "pg-commit-changes-w",
  });
  const composerPane = usePaneSize(360, {
    axis: "width",
    container: layout,
    min: COMPOSER_MIN_W,
    siblingMin: DIFF_MIN_W,
    reserve: changesPane.size + PANE_HANDLE_PX,
    storageKey: "pg-commit-composer-w",
  });
  const [diff, setDiff] = React.useState<FileDiff | null>(null);
  const [diffLoading, setDiffLoading] = React.useState(false);
  const [diffError, setDiffError] = React.useState<string | null>(null);

  // Folder rows (tree mode only) get the batch menu over everything beneath
  // them — stage / unstage / discard all — same as a multi-row selection.
  const { onContextMenu: onFolderCtx, menu: folderMenu } = useContextMenu<string>(
    (navKey) =>
      multiFileMenuItems(
        splitFileSelection(navKey ? [navKey] : [], selectionSource),
      ),
  );

  const { onContextMenu: onFileCtx, menu: fileMenu } = useContextMenu<FileSlot>(
    (f) => {
      if (f && sel.keys.length > 1 && sel.keys.includes(keyOf(f))) {
        return multiFileMenuItems(splitFileSelection(sel.keys, selectionSource));
      }
      return fileMenuItems({
        path: f?.path,
        staged: f?.side === "staged",
        embedded: f?.status.embedded,
        untracked: !!f && f.side === "unstaged" && isUntracked(f.status),
        conflicted: !!f && isConflicted(f.status),
        submodule: !!f?.status.submodule,
      });
    },
  );

  const moreMenu = useContextMenu<{ path: string; diff: FileDiff | null }>(
    (p) => [
      { __menuTitle: p?.path || "file" },
      {
        icon: "copy",
        label: "Copy path",
        onClick: () => {
          if (!p?.path) return;
          navigator.clipboard?.writeText(p.path);
          pgFlash("copied path");
        },
      },
      {
        icon: "copy",
        label: "Copy diff as text",
        onClick: () => {
          if (!p?.diff) return;
          const text = p.diff.hunks
            .map(
              (h) =>
                `${h.header}\n${h.lines
                  .map((ln) => {
                    const k = ln.kind.kind;
                    const prefix = k === "Addition" ? "+" : k === "Deletion" ? "-" : " ";
                    return `${prefix}${ln.content}`;
                  })
                  .join("")}`,
            )
            .join("\n");
          navigator.clipboard?.writeText(text);
          pgFlash("copied diff");
        },
      },
      { divider: true },
      {
        icon: "edit",
        label: "Open in editor",
        onClick: () => {
          if (p?.path) useRepoStore.getState().openInEditor(p.path);
        },
      },
      {
        icon: "history",
        label: "Show file history",
        onClick: () => {
          if (p?.path) setNavIntent({ kind: "file-history", path: p.path });
        },
      },
    ],
  );

  // Recent commit messages, newest-first, deduped by full message. Sourced from
  // the already-loaded log so no extra backend round-trip is needed.
  const recentMessages = React.useMemo(() => recentCommitMessages(commits), [
    commits,
  ]);

  const applyRecent = React.useCallback((r: RecentMessage) => {
    setMessage(r.body ? `${r.subject}\n\n${r.body}` : r.subject);
  }, []);

  const recentsMenu = useContextMenu<void>(() =>
    recentMessages.length === 0
      ? [{ __menuTitle: "No recent messages" }]
      : [
          { __menuTitle: "Recent messages" },
          ...recentMessages.map((r) => ({
            icon: "commit" as const,
            label: r.subject,
            onClick: () => applyRecent(r),
          })),
        ],
  );

  const staged = React.useMemo(
    () =>
      status
        .filter(isStaged)
        .map((s) => ({ path: s.path, status: s, side: "staged" as const })),
    [status],
  );
  const unstaged = React.useMemo(
    () =>
      status
        .filter(isUnstaged)
        .map((s) => ({ path: s.path, status: s, side: "unstaged" as const })),
    [status],
  );

  // Selection keys → path buckets. Folder keys expand within their own section
  // and embedded repos stay out of the stage/unstage/discard subsets; the rules
  // are shared with the repo browser (lib/selection) so the two cannot drift.
  const selectionSource = React.useMemo(
    () => sidedSelectionSource(staged, unstaged),
    [staged, unstaged],
  );

  // Visible row order (staged block above changes block) — shift-click ranges
  // extend over this order and may cross the staged/unstaged boundary.
  const rowOrder = React.useMemo(
    () => [...staged.map(keyOf), ...unstaged.map(keyOf)],
    [staged, unstaged],
  );
  const selectedKeys = React.useMemo(() => new Set(sel.keys), [sel]);

  // ── Tree ⇄ flat (#61 A6) ──────────────────────────────────────────────────
  // Both sections render the same rows either way; only the nesting differs.
  // Tree keys are "/a/b" while this screen's selection keys are "side:path",
  // so each section converts between the two at its edges — the selection
  // model, staging and context menus stay in one key space.
  const stagedTree = React.useMemo(
    () => (viewMode === "tree" ? buildStatusTree(staged.map((f) => f.status)) : []),
    [staged, viewMode],
  );
  const unstagedTree = React.useMemo(
    () => (viewMode === "tree" ? buildStatusTree(unstaged.map((f) => f.status)) : []),
    [unstaged, viewMode],
  );

  // Selection is local state keyed by side:path — reset on repo switch and
  // prune keys whose rows disappeared (refresh, stage/unstage moving files).
  React.useEffect(() => {
    setSel(emptySelection);
  }, [repo?.id]);
  React.useEffect(() => {
    const valid = new Set(rowOrder);
    setSel((s) => pruneSelection(s, valid));
  }, [rowOrder]);

  const onRowClick = (f: FileSlot) => (e: React.MouseEvent) => {
    setSel((s) =>
      clickSelection(rowOrder, s, keyOf(f), {
        toggle: e.metaKey || e.ctrlKey,
        range: e.shiftKey,
      }),
    );
  };

  // Right-click inside the multi-selection acts on it; outside collapses the
  // selection to the clicked row first (standard desktop-list behavior).
  const onRowContextMenu = (f: FileSlot) => (e: React.MouseEvent) => {
    const key = keyOf(f);
    if (!(sel.keys.length > 1 && sel.keys.includes(key))) {
      setSel({ keys: [key], anchor: key });
    }
    onFileCtx(e, f);
  };

  // ── Tree-mode row handlers ────────────────────────────────────────────────
  // Tree rows arrive already translated to this screen's `side:path` (or
  // `side:dir:path`) key space, so these mirror the flat handlers above and
  // additionally cope with a folder key having no FileSlot behind it.
  const slotForKey = React.useCallback(
    (navKey: string): FileSlot | null =>
      [...staged, ...unstaged].find((f) => keyOf(f) === navKey) ?? null,
    [staged, unstaged],
  );

  const onNavSelect = React.useCallback(
    (navKey: string, e?: React.MouseEvent) => {
      setSel((s) =>
        clickSelection(rowOrder, s, navKey, {
          toggle: !!e && (e.metaKey || e.ctrlKey),
          // A folder is not in rowOrder, so a range through it would collapse
          // to a single row — treat Shift on a folder as a plain click.
          range: !!e?.shiftKey && rowOrder.includes(navKey),
        }),
      );
    },
    [rowOrder],
  );

  const onNavContextMenu = React.useCallback(
    (e: React.MouseEvent, navKey: string) => {
      const slot = slotForKey(navKey);
      if (!(sel.keys.length > 1 && sel.keys.includes(navKey))) {
        setSel({ keys: [navKey], anchor: navKey });
      }
      // A folder has no single-file menu — give it the batch menu over
      // everything beneath it, matching the repo browser.
      if (!slot) {
        onFolderCtx(e, navKey);
        return;
      }
      onFileCtx(e, slot);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sel, slotForKey, onFileCtx],
  );

  const onNavStageToggle = React.useCallback(
    (navKey: string, next: boolean) => {
      const split = splitFileSelection([navKey], selectionSource);
      if (next) {
        if (split.unstagedPaths.length) stage(split.unstagedPaths);
      } else if (split.stagedPaths.length) {
        unstage(split.stagedPaths);
      }
    },
    [selectionSource, stage, unstage],
  );

  // Checkbox on a row inside the multi-selection stages/unstages every
  // selected row on that side; on an unselected row it stays single-file.
  const togglePaths = (f: FileSlot): string[] => {
    if (sel.keys.length > 1 && sel.keys.includes(keyOf(f))) {
      const split = splitFileSelection(sel.keys, selectionSource);
      const paths = f.side === "staged" ? split.stagedPaths : split.unstagedPaths;
      if (paths.length > 0) return paths;
    }
    return [f.path];
  };

  /** Stage the row's toggle target, unless it is an embedded repo. */
  const stageToggled = (f: FileSlot) => {
    if (f.status.embedded) {
      pgFlash(EMBEDDED_REPO_HELP);
      return;
    }
    stage(togglePaths(f));
  };

  // ── Drag to stage / unstage (#91) ─────────────────────────────────────────
  //
  // The gesture is delegated from the SECTION, resolving the grabbed row through
  // `data-path` — an attribute PGChangeRow and PGFileTreeRow already carry. So no
  // prop is threaded into either row component, and the tree⇄flat toggle needs no
  // per-mode branch: in flat mode `data-path` is the file path, in tree mode it
  // is the tree key minus its leading slash, and `findStatusByTreeKey` turns
  // either into the same slot (`lib/tree.ts` emits the same row keys for both —
  // that property is what makes this work).
  const navKeyForRow = React.useCallback(
    (side: FileSlot["side"], dataPath: string): string => {
      const files: FileSlot[] = side === "staged" ? staged : unstaged;
      const slot = findStatusByTreeKey(`/${dataPath}`, files);
      // No slot behind it → a folder row, which acts on everything beneath it,
      // exactly as its checkbox and its context menu do.
      return slot ? keyOf(slot) : dirKeyOf(side, dataPath);
    },
    [staged, unstaged],
  );

  /**
   * The payload for a drag starting on `target`, or null for a spot that carries
   * no row. Paths come out of `splitFileSelection` with this screen's own
   * `selectionSource` — the exact call the checkbox makes (see `togglePaths`), so
   * folder expansion, multi-selection bucketing and the embedded-repo exclusion
   * are shared with it rather than re-derived.
   */
  const dragPayloadFor = React.useCallback(
    (side: FileSlot["side"], target: HTMLElement): DragPayload | null => {
      const row = target.closest("[data-path]") as HTMLElement | null;
      const dataPath = row?.getAttribute("data-path");
      if (!dataPath) return null;
      const navKey = navKeyForRow(side, dataPath);
      const keys =
        sel.keys.length > 1 && sel.keys.includes(navKey) ? sel.keys : [navKey];
      const split = splitFileSelection(keys, selectionSource);
      const paths = side === "staged" ? split.stagedPaths : split.unstagedPaths;
      // Nothing actionable — an embedded repo is the usual reason. No drag, and
      // no message either: this runs on pointerDOWN, so flashing here would fire
      // on a plain click. A row that cannot be staged simply is not draggable,
      // the same as empty space.
      if (paths.length === 0) return null;
      return {
        kind: "files",
        side,
        paths,
        label: paths.length === 1 ? paths[0] : `${paths.length} files`,
      };
    },
    [navKeyForRow, sel.keys, selectionSource],
  );

  const applyStagingDrop = React.useCallback(
    (payload: DragPayload, targetSide: FileSlot["side"]) => {
      if (payload.kind !== "files") return;
      const drop = resolveStagingDrop(payload, targetSide);
      if (!drop) return;
      // The store's stage/unstage already refresh STATUS only — an index-only
      // mutation must not pull the whole log and branch list behind it.
      if (drop.action === "stage") void stage(drop.paths);
      else void unstage(drop.paths);
    },
    [stage, unstage],
  );

  const stagedSource = useDragSource((t) => dragPayloadFor("staged", t));
  const unstagedSource = useDragSource((t) => dragPayloadFor("unstaged", t));
  const stagedZone = useDropZone({
    id: "commit.drop.staged",
    accepts: (p) => p.kind === "files" && p.side !== "staged",
    onDrop: (p) => applyStagingDrop(p, "staged"),
  });
  const unstagedZone = useDropZone({
    id: "commit.drop.unstaged",
    accepts: (p) => p.kind === "files" && p.side !== "unstaged",
    onDrop: (p) => applyStagingDrop(p, "unstaged"),
  });

  const primaryKey = primarySelectedKey(sel);
  const selected = React.useMemo(() => {
    if (!primaryKey) return unstaged[0] ?? staged[0] ?? null;
    return (
      [...staged, ...unstaged].find((f) => keyOf(f) === primaryKey) ??
      unstaged[0] ??
      staged[0] ??
      null
    );
  }, [primaryKey, staged, unstaged]);

  // Line-level staging selection, keyed by hunk index (#61 D7).
  //
  // It lives here rather than in PGHunk: a primitive owning its own selection
  // plus the global key dispatcher would both answer the same input and the
  // selection would move twice — the same rule that keeps tree keyboard
  // handling in the screen instead of PGFileTree.
  const [lineSel, setLineSel] = React.useState<Record<number, number[]>>({});
  const [lineAnchor, setLineAnchor] = React.useState<number | null>(null);

  const clearLineSel = React.useCallback(() => {
    setLineSel({});
    setLineAnchor(null);
  }, []);

  const onLineClick = React.useCallback(
    (hunkIndex: number, changedIndex: number, range: boolean) => {
      setLineSel((prev) => {
        const cur = prev[hunkIndex] ?? [];
        if (range && lineAnchor != null) {
          const lo = Math.min(lineAnchor, changedIndex);
          const hi = Math.max(lineAnchor, changedIndex);
          const span: number[] = [];
          for (let k = lo; k <= hi; k++) span.push(k);
          return { ...prev, [hunkIndex]: span };
        }
        const next = cur.includes(changedIndex)
          ? cur.filter((x) => x !== changedIndex)
          : [...cur, changedIndex].sort((a, b) => a - b);
        return { ...prev, [hunkIndex]: next };
      });
      if (!range) setLineAnchor(changedIndex);
    },
    [lineAnchor],
  );

  // Row highlight: explicit selection when present, else the derived primary
  // (first unstaged file) so the keyboard always has a visible anchor.
  const effectiveKeys = React.useMemo(() => {
    if (sel.keys.length > 0) return selectedKeys;
    return new Set(selected ? [keyOf(selected)] : []);
  }, [sel.keys.length, selectedKeys, selected]);

  // Tokens come from exactly the two sides the diff was computed from:
  // IndexToHead for a staged row, WorktreeToIndex otherwise. Reading the index
  // directly is what makes a partially staged file colour correctly — HEAD and
  // the worktree disagree with it precisely in that case.
  const syntax = useDiffSyntax({
    repoId: selected && !selected.status.embedded ? (repo?.id ?? null) : null,
    path: selected?.path ?? null,
    old:
      selected?.side === "staged"
        ? { kind: "rev", rev: "HEAD", path: diff?.oldPath }
        : { kind: "index" },
    new: selected?.side === "staged" ? { kind: "index" } : { kind: "worktree" },
  });

  // ── Windowed diff rows ───────────────────────────────────────────────────
  // No wrap toggle in this pane, so rows are always fixed-pitch and windowing is
  // always on. Row heights are known, so the window needs no measurement.
  const rowH = useDiffRowHeight();
  const foldH = 22 + useDensityStep();
  // Chunked mode only: which folded runs the reader asked to see. Took the place
  // of the per-hunk `collapsed` set, which #157 retired.
  const { expanded: expandedGaps, expand: expandGap } = useExpandedGaps(
    `${selected?.path ?? ""}:${selected?.side ?? ""}`,
  );

  // Whole file is the default here too: each change block keeps its own
  // Stage/Discard and line selection while the file reads continuously around it,
  // with nothing announcing a boundary the reader cannot see (#157). Hunk indices
  // are the canonical ones either way.
  const { gaps, text: diffText } = useDiffGaps(syntax);
  const rows = React.useMemo(
    () =>
      // Also excludes an LFS pointer diff (#93): its "hunks" are pointer text.
      flattenDiffRows(isTextualDiff(diff) && diff ? diff.hunks : [], {
        foldH,
        rowH,
        syntax,
        text: diffText,
        gaps,
        expandedGaps,
      }),
    [diff, foldH, rowH, syntax, diffText, gaps, expandedGaps],
  );
  const heights = React.useMemo(() => rows.map((r) => r.h), [rows]);
  // Split mode's model, memoized: computed inline in JSX it re-derived the
  // whole two-column model (word diff included) on every render of this panel
  // — which happens per keystroke in the commit message box.
  const split = React.useMemo(
    () => (diffMode === "split" && isTextualDiff(diff) && diff ? diffToSplit(diff) : null),
    [diffMode, diff],
  );
  const diffScrollRef = React.useRef<HTMLDivElement>(null);
  const { viewportH: diffViewportH, remeasure: remeasureDiff } = useViewportH(
    diffScrollRef,
    [diffMode],
  );
  // Measured on the WRAPPER holding the scroll area and the minimap, so adding
  // the gutter cannot change the width that decides whether to add it (#161).
  const diffBox = useElementSize();
  const { win, onScroll: onDiffScroll } = useVariableWindow({
    heights,
    viewportH: diffViewportH,
    scrollRef: diffScrollRef,
  });

  React.useEffect(() => {
    if (!selected || !repo) {
      setDiff(null);
      return;
    }
    const kind: DiffKind =
      selected.side === "staged" ? "IndexToHead" : "WorktreeToIndex";
    setDiffError(null);
    // An embedded repo has no diff — say what the row is instead of asking for
    // one and rendering the backend's terse refusal.
    if (selected.status.embedded) {
      setDiff(null);
      setDiffLoading(false);
      setDiffError(`${selected.path} — ${EMBEDDED_REPO_HELP}`);
      return;
    }
    let cancelled = false;
    setDiffLoading(true);
    getDiff(repo.id, selected.path, kind, diffContextLines, ignoreWhitespace)
      .then((d) => {
        if (!cancelled) setDiff(d);
      })
      .catch((e) => {
        if (!cancelled) setDiffError(appErrorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `status` is in here on purpose, as the signal that the file's staging state
    // moved. Nothing else in this list changes when the SAME file is partially
    // staged: path and side stay put, and additions/deletions are HEAD→worktree
    // totals that a stage does not alter. Without it the pane kept showing the
    // pre-stage diff, and the next line selection addressed indices into that
    // stale diff while the backend recomputed a fresh one — staging lines other
    // than the highlighted ones. `refreshStatus` replaces the array, so identity
    // is the dependency; the cost is one diff fetch per status refresh.
  }, [
    selected?.path,
    selected?.side,
    selected?.status.embedded,
    status,
    repo,
    diffContextLines,
    ignoreWhitespace,
  ]);

  // A line selection stops meaning the same thing once the file, the side, or
  // the diff shape changes — the indices would then address different lines.
  React.useEffect(() => {
    clearLineSel();
  }, [selected?.path, selected?.side, diff, clearLineSel]);

  // ── Line-level keyboard focus (#61 D7 step 5) ────────────────────────────
  // Scroll BY OFFSET: the focused row is usually not mounted in a windowed diff,
  // so a DOM query would find nothing and arrow keys would stop scrolling with no
  // error (#68 G10). clientHeight is read live so the callback's identity does
  // not change with the viewport — usePaneList's scroll effect depends on it.
  const scrollDiffRowIntoView = React.useCallback(
    (rowIndex: number) => {
      const el = diffScrollRef.current;
      if (!el) return;
      el.scrollTop = scrollTopForRow(heights, rowIndex, {
        scrollTop: el.scrollTop,
        viewportH: el.clientHeight,
      });
    },
    [heights],
  );

  /**
   * Space on the focused line, staging on the unstaged side and unstaging on the
   * staged side — the same direction rule the hunk header's button uses.
   *
   * Acts on the whole line selection when the focused line is part of it, exactly
   * as Space on the file list acts on the whole multi-selection when the row is
   * part of it. Otherwise it acts on the focused line alone, so Space is useful
   * without selecting anything first.
   */
  const toggleFocusedLine = React.useCallback(
    (t: DiffLineTarget) => {
      if (!selected) return;
      const inSelection = (lineSel[t.hunkIndex] ?? []).includes(t.changedIndex);
      // One index space throughout: whether it came from the selection or from
      // the cursor, every element is a changedIndex.
      const targets = inSelection ? lineSel[t.hunkIndex] : [t.changedIndex];
      const store = useRepoStore.getState();
      if (selected.side === "staged") {
        store.unstageLines(selected.path, t.hunkIndex, targets);
      } else {
        store.stageLines(selected.path, t.hunkIndex, targets);
      }
      clearLineSel();
    },
    [selected, lineSel, clearLineSel],
  );

  const lineFocus = useDiffLineFocus({
    paneId: "commit.diff",
    rows,
    // Same trigger as the selection clear above: a refetched diff renumbers.
    resetKey: diff,
    // Ignore-whitespace rewrites hunk boundaries, so neither the mouse nor the
    // keyboard may address lines through indices git would not honor (#61 D2).
    disabled: !!hunkActionsDisabled,
    scrollToRow: scrollDiffRowIntoView,
    onToggle: toggleFocusedLine,
  });

  // ── Hunk cursor + hunk-level chords (#157) ───────────────────────────────
  // This pane had no F7 at all before, so the `@@` banner's Stage/Discard was
  // mouse-only. Both now hang off the hunk cursor.
  const anchorRows = React.useMemo(() => hunkAnchorRows(rows), [rows]);
  const scrollToHunk = React.useCallback(
    (hunkIndex: number) => {
      const rowIndex = anchorRows[hunkIndex];
      if (rowIndex == null || rowIndex < 0) return;
      scrollDiffRowIntoView(rowIndex);
    },
    [anchorRows, scrollDiffRowIntoView],
  );
  const hunkCursor = useHunkNav({
    paneIds: ["commit.diff"],
    count: isTextualDiff(diff) && diff ? diff.hunks.length : 0,
    resetKey: `${selected?.path ?? ""}:${selected?.side ?? ""}`,
    scrollToHunk,
  });

  /**
   * Which hunk a hunk-level chord acts on: the F7 cursor when it has moved, else
   * the hunk the line cursor sits in. `null` declines the chord rather than
   * guessing at hunk 0 — Discard is destructive.
   */
  const chordHunk =
    hunkCursor >= 0 ? hunkCursor : (lineFocus.focused?.hunkIndex ?? null);

  /**
   * Stage (or unstage, on the staged side) a whole hunk — or the line selection
   * inside it, which is the direction rule the cluster's button has always used.
   */
  const stageHunkAt = React.useCallback(
    (i: number) => {
      if (!selected) return;
      const sel = lineSel[i] ?? [];
      const store = useRepoStore.getState();
      if (selected.side === "staged") {
        if (sel.length) store.unstageLines(selected.path, i, sel);
        else store.unstageHunk(selected.path, i);
      } else {
        if (sel.length) store.stageLines(selected.path, i, sel);
        else store.stageHunk(selected.path, i);
      }
      clearLineSel();
    },
    [selected, lineSel, clearLineSel],
  );

  const discardHunkAt = React.useCallback(
    async (i: number) => {
      if (!selected) return;
      const sel = lineSel[i] ?? [];
      if (
        await pgConfirm({
          title: sel.length
            ? `Discard ${sel.length} selected line${sel.length === 1 ? "" : "s"}?`
            : "Discard this hunk?",
          body: `The change to ${selected.path} will be lost.`,
          danger: true,
          confirmLabel: sel.length ? "Discard lines" : "Discard hunk",
        })
      ) {
        const store = useRepoStore.getState();
        if (sel.length) store.discardLines(selected.path, i, sel);
        else store.discardHunk(selected.path, i);
        clearLineSel();
      }
    },
    [selected, lineSel, clearLineSel],
  );

  // Both decline (returning false) when there is no hunk to act on or when
  // ignore-whitespace has made hunk indices unusable — the same gate the buttons
  // and the line cursor sit behind (#61 D2). Declining lets the chord fall
  // through instead of being swallowed.
  useAction(
    "diff.stageHunk",
    () => {
      if (chordHunk == null || hunkActionsDisabled) return false;
      stageHunkAt(chordHunk);
      return true;
    },
    [chordHunk, hunkActionsDisabled, stageHunkAt],
    { paneId: "commit.diff" },
  );
  useAction(
    "diff.discardHunk",
    () => {
      if (chordHunk == null || hunkActionsDisabled) return false;
      void discardHunkAt(chordHunk);
      return true;
    },
    [chordHunk, hunkActionsDisabled, discardHunkAt],
    { paneId: "commit.diff" },
  );

  const headBranch = currentBranch(branches);
  const defaultRemote = remotes[0] ?? null;

  // The composer's summary describes THE COMMIT, so it counts the staged side
  // only. `additions`/`deletions` are both sides combined, which overstated the
  // commit whenever a staged file had further unstaged edits.
  const stagedAdd = React.useMemo(
    () => staged.reduce((s, f) => s + sideAdditions(f.status, "staged"), 0),
    [staged],
  );
  const stagedDel = React.useMemo(
    () => staged.reduce((s, f) => s + sideDeletions(f.status, "staged"), 0),
    [staged],
  );

  // Keyboard: one selection across both sections (staged first, matching the
  // rendered order). Space stages/unstages the selected file, Rider-style.
  const combined = React.useMemo(() => [...staged, ...unstaged], [staged, unstaged]);
  const combinedIndex = Math.max(
    0,
    combined.findIndex((f) => selected && keyOf(f) === keyOf(selected)),
  );
  usePaneList({
    paneId: "commit.files",
    count: combined.length,
    selectedIndex: combinedIndex,
    onSelect: (i) => {
      const f = combined[i];
      if (f) setSel({ keys: [keyOf(f)], anchor: keyOf(f) });
    },
    onToggle: (i) => {
      const f = combined[i];
      if (!f) return;
      // Space acts on the whole multi-selection when the row is part of it.
      if (f.side === "staged") unstage(togglePaths(f));
      else stageToggled(f);
    },
    searchText: (i) => combined[i]?.path ?? "",
  });

  // Commit chords (⌘↵ / ⌘⇧↵ / ⌘⇧M). Shared with the two buttons below so the
  // chord and click paths cannot drift. Handlers decline exactly when the
  // matching button is disabled, letting the chord fall through.
  // A typed-but-unparseable author blocks the commit rather than being silently
  // ignored — landing the wrong author in history costs a rewrite to fix.
  const authorIdentity = React.useMemo(
    () => (authorAs.trim() ? parseIdentity(authorAs) : null),
    [authorAs],
  );
  const authorInvalid = authorAs.trim().length > 0 && authorIdentity === null;
  const coAuthorCount = React.useMemo(
    () => coAuthorTrailers(coAuthors).length,
    [coAuthors],
  );
  // Only the first line counts against the 50-char subject budget; everything
  // below it is body text nobody truncates.
  const subjectLength = message.split("\n", 1)[0].length;
  const canCommit =
    (amend || staged.length > 0) && !!message.trim() && !authorInvalid;
  const canCommitAndPush = canCommit && !!headBranch && !!defaultRemote;
  // Guards against a second commit firing before the first resolves and clears
  // the message/staged state — key auto-repeat (holding ⌘↵) and double-taps
  // both re-dispatch the chord while canCommit is still true.
  const committingRef = React.useRef(false);
  const doCommit = async (): Promise<string | null> => {
    if (committingRef.current) return null;
    committingRef.current = true;
    try {
      const full = buildMessage(message, coAuthorTrailers(coAuthors));
      const oid = await commitAction(
        full,
        amend,
        signoff,
        authorIdentity,
        signForCommit,
      );
      if (oid) {
        setMessage("");
        setAmend(false);
        draftRef.current = null;
        // Per-commit signing override is not sticky: it is an override, and
        // carrying it silently into the next commit would surprise.
        setSignOverride(null);
        // Attribution is sticky: pairing usually spans several commits, so
        // clearing it after each one would mean retyping every time.
      }
      return oid;
    } finally {
      committingRef.current = false;
    }
  };
  const doCommitAndPush = async (): Promise<void> => {
    if (!headBranch || !defaultRemote) return;
    const oid = await doCommit();
    if (!oid) return;
    await pushAction(defaultRemote.name, headBranch.name);
  };
  useAction(
    "commit.commit",
    () => {
      if (!canCommit) return false;
      void doCommit();
      return true;
    },
    [canCommit, message, amend, signoff, authorIdentity, coAuthors],
  );
  useAction(
    "commit.commitAndPush",
    () => {
      if (!canCommitAndPush) return false;
      void doCommitAndPush();
      return true;
    },
    [
      canCommitAndPush,
      message,
      amend,
      signoff,
      authorIdentity,
      coAuthors,
      headBranch,
      defaultRemote,
    ],
  );
  // Checking amend pulls HEAD's message into the box (that's the message being
  // rewritten), stashing whatever draft was there so unchecking gives it back.
  const toggleAmend = React.useCallback(
    async (next: boolean) => {
      // Every toggle voids the one before it: unchecking while the HEAD read is
      // still in flight must not have the message replaced out from under it.
      const req = (amendReqRef.current += 1);
      if (!next) {
        setAmend(false);
        if (draftRef.current !== null) {
          setMessage(draftRef.current);
          draftRef.current = null;
        }
        return;
      }
      if (!repo) return;
      setAmend(true);
      try {
        // HEAD, never the browsed log ref — History may be scoped to another
        // branch, but amend always rewrites the commit this repo is sitting on.
        const page = await getLogPage(repo.id, null, 1);
        if (amendReqRef.current !== req) return;
        const head = page.commits[0];
        if (!head) {
          setAmend(false);
          pgFlash("No commit to amend yet");
          return;
        }
        draftRef.current = message;
        setMessage(headMessage(head));
      } catch (e) {
        if (amendReqRef.current !== req) return;
        setAmend(false);
        pgFlash(appErrorMessage(e));
      }
    },
    [repo, message],
  );
  useAction(
    "commit.toggleAmend",
    () => {
      void toggleAmend(!amend);
      return true;
    },
    [amend, toggleAmend],
  );

  // A clean tree still has one thing worth doing: fixing the message of the
  // commit that just landed. Checking amend brings the composer back.
  if (!loading && staged.length === 0 && unstaged.length === 0 && !amend) {
    return (
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <PGEmpty
          icon="check"
          title="Working tree clean"
          action={
            <PGButton
              icon="commit"
              onClick={() => void toggleAmend(true)}
              data-testid="amend-last-commit"
            >
              Amend last commit
            </PGButton>
          }
        >
          No changes to commit.
        </PGEmpty>
      </div>
    );
  }

  return (
    <div ref={layout.ref} style={{ flex: 1, display: "flex", minHeight: 0 }}>
      {/* Column 1: change list */}
      <PGPane
        id="commit.files"
        primary
        style={{
          width: changesPane.size,
          flexShrink: 0,
          background: "var(--bg-1)",
          borderRight: "1px solid var(--border-0)",
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
        }}
      >
        <div
          data-testid="staged-list"
          ref={stagedZone.ref}
          {...stagedSource}
          style={{
            borderBottom: "1px solid var(--border-0)",
            position: "relative",
          }}
        >
          {stagedZone.isOver && <DropHint label="Drop to stage" />}
          <Header
            title="STAGED"
            badge={<PGBadge tone="success">{staged.length}</PGBadge>}
            action={
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                {/* One toggle for the whole pane — both sections follow it. */}
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
                <PGButton
                  size="xs"
                  variant="ghost"
                  onClick={() => unstage(staged.map((f) => f.path))}
                  disabled={staged.length === 0}
                >
                  Unstage all
                </PGButton>
              </div>
            }
          />
          {staged.length === 0 && (
            <div
              style={{
                padding: 12,
                color: "var(--fg-3)",
                fontSize: "var(--fs-11)",
                textAlign: "center",
              }}
            >
              Nothing staged
            </div>
          )}
          {viewMode === "tree" ? (
            <SectionTree
              side="staged"
              nodes={stagedTree}
              files={staged}
              expanded={stagedExpanded}
              onExpandedChange={(k, next) =>
                setStagedExpanded((e) => ({ ...e, [k]: next }))
              }
              selectedKeys={effectiveKeys}
              onSelect={onNavSelect}
              onRowContextMenu={onNavContextMenu}
              onStageToggle={onNavStageToggle}
            />
          ) : (
            staged.map((f) => (
              <PGChangeRow
                key={`s:${f.path}`}
                path={f.path}
                status={statusMark(f.status)}
                staged
                additions={sideAdditions(f.status, "staged")}
                deletions={sideDeletions(f.status, "staged")}
                selected={effectiveKeys.has(keyOf(f))}
                onClick={onRowClick(f)}
                onContextMenu={onRowContextMenu(f)}
                onToggle={() => unstage(togglePaths(f))}
              />
            ))
          )}
        </div>
        <FocusableScroll
          testId="changes-list"
          style={{ flex: 1 }}
          ariaLabel="Changed files"
        >
          {/* The zone wraps the section INSIDE the scroller and claims its full
              height, so the empty space under the last row is a drop target too
              — "drop into CHANGES" must not require hitting a row. */}
          <div
            ref={unstagedZone.ref}
            {...unstagedSource}
            style={{ minHeight: "100%", position: "relative" }}
          >
          {unstagedZone.isOver && <DropHint label="Drop to unstage" />}
          <Header
            title="CHANGES"
            badge={<PGBadge tone="warn">{unstaged.length}</PGBadge>}
            action={
              <div style={{ display: "flex", gap: 4 }}>
                <PGButton
                  size="xs"
                  variant="ghost"
                  onClick={() => stage(stageablePaths(status))}
                  disabled={unstaged.length === 0}
                >
                  Stage all
                </PGButton>
                <PGButton
                  size="xs"
                  variant="ghost"
                  disabled={unstaged.length === 0 && staged.length === 0}
                  onClick={async () => {
                    const message = await pgPrompt({
                      title: "Stash changes",
                      body: "Saves your working tree and resets it to HEAD. Untracked files are included.",
                      placeholder: "Message (optional)",
                      confirmLabel: "Stash",
                    });
                    if (message === null) return;
                    await useRepoStore.getState().stashSave({
                      message: message || null,
                      includeUntracked: true,
                      keepIndex: false,
                    });
                  }}
                >
                  Stash
                </PGButton>
              </div>
            }
            border
          />
          {viewMode === "tree" ? (
            <SectionTree
              side="unstaged"
              nodes={unstagedTree}
              files={unstaged}
              expanded={unstagedExpanded}
              onExpandedChange={(k, next) =>
                setUnstagedExpanded((e) => ({ ...e, [k]: next }))
              }
              selectedKeys={effectiveKeys}
              onSelect={onNavSelect}
              onRowContextMenu={onNavContextMenu}
              onStageToggle={onNavStageToggle}
            />
          ) : (
            unstaged.map((f) => (
              <PGChangeRow
                key={`u:${f.path}`}
                path={f.path}
                status={statusMark(f.status)}
                staged={false}
                additions={sideAdditions(f.status, "unstaged")}
                deletions={sideDeletions(f.status, "unstaged")}
                selected={effectiveKeys.has(keyOf(f))}
                onClick={onRowClick(f)}
                onContextMenu={onRowContextMenu(f)}
                onToggle={() => stageToggled(f)}
              />
            ))
          )}
          </div>
        </FocusableScroll>
      </PGPane>
      <PGResizeHandle onDrag={changesPane.resize} onReset={changesPane.reset} />

      {/* Column 2: diff */}
      <PGPane
        id="commit.diff"
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
            padding: "0 12px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: "var(--bg-1)",
            borderBottom: "1px solid var(--border-0)",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-12)",
          }}
        >
          {selected && <PGStatusMark kind={statusMark(selected.status)} />}
          <span>{selected?.path ?? "no file selected"}</span>
          <div style={{ flex: 1 }} />
          <WhitespaceToggle />
          <PGButtonGroup
            value={diffMode}
            onChange={(v) => setDiffMode(v as typeof diffMode)}
            options={[
              { value: "unified", label: "Unified" },
              { value: "split", label: "Split" },
            ]}
            size="sm"
          />
          <PGIconButton
            icon="more"
            size="sm"
            title="File actions"
            onClick={(e) => {
              if (!selected) return;
              moreMenu.openAt(e.clientX, e.clientY + 4, {
                path: selected.path,
                diff,
              });
            }}
          />
        </div>
        <div
          ref={diffBox.ref}
          style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex" }}
        >
        <FocusableScroll
          style={{ flex: 1, minWidth: 0 }}
          ariaLabel="Diff"
          innerRef={diffScrollRef}
          onScroll={() => {
            onDiffScroll();
            remeasureDiff();
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
          {!diffLoading && diffError && (
            <div
              style={{
                padding: 20,
                color: "var(--git-removed)",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--fs-12)",
              }}
            >
              {diffError}
            </div>
          )}
          {!diffLoading && !diffError && diff && diff.binary && (
            <PGEmpty icon="file" title="Binary file">
              Binary diffs aren&apos;t shown.
            </PGEmpty>
          )}
          {!diffLoading && !diffError && diff?.lfs && <LfsDiffNotice diff={diff} />}
          {!diffLoading && !diffError && isTextualDiff(diff) && diff &&
            diff.hunks.length === 0 && (
              <PGEmpty icon="file" title="No diff">
                File is tracked but no hunks were produced.
              </PGEmpty>
            )}
          {!diffLoading && !diffError && isTextualDiff(diff) && diff && diff.hunks.length > 0 &&
            diffMode === "unified" && (
              <PGWindowedDiff
                rows={rows}
                window={win}
                activeHunk={hunkCursor >= 0 ? hunkCursor : undefined}
                onExpandGap={expandGap}
                selectedLines={(i) => lineSel[i] ?? []}
                onLineClick={onLineClick}
                focusedRow={lineFocus.focused?.rowIndex ?? null}
                hunkActions={(i) => ({
                  staged: selected?.side === "staged",
                  actionsDisabledReason: hunkActionsDisabled,
                  onStage: () => stageHunkAt(i),
                  onDiscard: () => void discardHunkAt(i),
                })}
              />
            )}
          {!diffLoading && !diffError && isTextualDiff(diff) && diff && diff.hunks.length > 0 &&
            diffMode === "split" && split && (
              <PGSideBySideDiff {...split} />
            )}
        </FocusableScroll>
        {diffMode === "unified" && (
          <MinimapGutter
            rows={rows}
            heights={heights}
            rowH={rowH}
            viewportH={diffViewportH}
            scrollRef={diffScrollRef}
            containerWidth={diffBox.width}
            containerHeight={diffBox.height}
          />
        )}
        </div>
        {moreMenu.menu}
      </PGPane>

      <PGResizeHandle
        onDrag={(d) => composerPane.resize(-d)}
        onReset={composerPane.reset}
        side="left"
      />

      {/* Column 3: message composer */}
      <PGPane
        id="commit.message"
        style={{
          width: composerPane.size,
          flexShrink: 0,
          background: "var(--bg-1)",
          borderLeft: "1px solid var(--border-0)",
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
        }}
      >
        <Header
          title="COMMIT MESSAGE"
          action={
            <PGButton
              size="xs"
              variant="ghost"
              icon="history"
              disabled={recentMessages.length === 0}
              title="Insert a recent commit message"
              onClick={(e) => {
                const r = (
                  e.currentTarget as HTMLElement
                ).getBoundingClientRect();
                recentsMenu.openAt(r.left, r.bottom + 4, undefined);
              }}
            >
              Recent
            </PGButton>
          }
        />
        {recentsMenu.menu}
        <div
          style={{
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            flex: 1,
          }}
        >
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <LabelRow
              label="Message"
              right={
                <span
                  style={{
                    display: "flex",
                    gap: 6,
                    fontSize: "var(--fs-10)",
                    fontFamily: "var(--font-mono)",
                    color: "var(--fg-3)",
                  }}
                >
                  <span
                    data-testid="commit-subject-count"
                    style={{
                      color:
                        subjectLength > 50
                          ? "var(--git-modified)"
                          : "var(--fg-3)",
                    }}
                  >
                    {subjectLength}/50
                  </span>
                  <span>wrap at 72</span>
                </span>
              }
            />
            <PGTextarea
              value={message}
              onChange={setMessage}
              rows={10}
              mono
              placeholder="Subject line, blank line, then body"
              data-testid="commit-message"
              data-pg-focus-target=""
              className="focusable"
              style={{ flex: 1 }}
            />
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              padding: "8px 0",
              borderTop: "1px solid var(--border-0)",
              borderBottom: "1px solid var(--border-0)",
            }}
          >
            <PGCheckbox
              checked={amend}
              onChange={(v) => void toggleAmend(v)}
              label="Amend previous commit"
            />
            <PGCheckbox
              checked={signoff}
              onChange={(v) => {
                setSignoff(v);
                setSetting("addSignoff", v);
              }}
              label="Add Signed-off-by trailer"
            />
            {/*
              Signing (#61 D6), three states rather than two. Indeterminate is
              "follow commit.gpgsign", which the frontend cannot read — showing
              it as plain unchecked would claim the commit is unsigned in a repo
              that has signing on. Checked/unchecked force it for this commit
              only. A signing failure fails the commit; it never silently
              produces an unsigned one.
            */}
            <PGCheckbox
              checked={signForCommit === true}
              indeterminate={signForCommit === null}
              onChange={(v) => setSignOverride(v)}
              label={
                signForCommit === null
                  ? "Sign this commit — following git config"
                  : signForCommit
                    ? "Sign this commit"
                    : "Don't sign this commit"
              }
            />
          </div>

          {/* Attribution (#61 D1). Both blank is the normal case. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <PGInput
              value={authorAs}
              onChange={setAuthorAs}
              placeholder="Author — Name <email>, blank for git config"
              icon="user"
              size="sm"
              mono
              error={authorInvalid}
              title="Commit as another author. The committer stays your git config identity, matching `git commit --author`."
              data-testid="commit-author"
            />
            <PGInput
              value={coAuthors}
              onChange={setCoAuthors}
              placeholder="Co-authors — Name <email>, comma-separated"
              icon="user"
              size="sm"
              mono
              title="Appended as Co-Authored-By trailers."
              data-testid="commit-coauthors"
            />
          </div>

          <div
            style={{
              display: "flex",
              gap: 4,
              alignItems: "center",
              fontSize: "var(--fs-11)",
              color: authorInvalid ? "var(--git-removed)" : "var(--fg-2)",
              fontFamily: "var(--font-mono)",
            }}
            data-testid="commit-attribution"
          >
            <PGAvatar name={authorIdentity?.name ?? "you"} size={14} />
            {authorInvalid
              ? "Author must look like: Name <email@example.com>"
              : authorIdentity
                ? `${authorIdentity.name} <${authorIdentity.email}> — you stay the committer`
                : "(signature will come from git config)"}
            {coAuthorCount > 0 && !authorInvalid && (
              <span style={{ color: "var(--fg-3)" }}>
                {" "}
                +{coAuthorCount} co-author{coAuthorCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <div
            style={{
              fontSize: "var(--fs-11)",
              color: "var(--fg-2)",
              fontFamily: "var(--font-mono)",
              padding: "6px 8px",
              background: "var(--bg-2)",
              borderRadius: "var(--r-3)",
            }}
          >
            {staged.length} file{staged.length !== 1 ? "s" : ""},{" "}
            <span style={{ color: "var(--git-added)" }}>+{stagedAdd}</span>{" "}
            <span style={{ color: "var(--git-removed)" }}>−{stagedDel}</span>
          </div>

          <div style={{ display: "flex", gap: 6 }}>
            <PGButton
              variant="default"
              fullWidth
              disabled={!canCommit}
              onClick={() => void doCommit()}
              data-testid="commit-button"
            >
              {amend ? "Amend" : "Commit"}
            </PGButton>
            <PGButton
              variant="primary"
              icon="push"
              fullWidth
              loading={!!activity.push}
              disabled={!canCommitAndPush}
              title={
                !headBranch
                  ? "Detached HEAD — no branch to push"
                  : !defaultRemote
                    ? "No remote configured"
                    : `Commit then push to ${defaultRemote.name}/${headBranch.name}`
              }
              onClick={() => void doCommitAndPush()}
            >
              Commit & Push
            </PGButton>
          </div>
        </div>
      </PGPane>
      {fileMenu}
      {folderMenu}
    </div>
  );
}

/**
 * What a hovered staging zone will do, said in words. The accent ring from
 * `[data-pg-drop-over]` already says "here"; this says "and this is what
 * happens". Absolutely positioned and `pointerEvents: none` so hovering a zone
 * neither shifts the rows under the cursor nor shadows the hit test.
 */
function DropHint({ label }: { label: string }) {
  return (
    <div
      data-testid="drop-hint"
      style={{
        position: "absolute",
        top: 4,
        right: 8,
        zIndex: 2,
        pointerEvents: "none",
        padding: "1px 6px",
        borderRadius: "var(--r-2)",
        border: "1px solid var(--accent)",
        background: "var(--bg-2)",
        color: "var(--accent)",
        fontSize: "var(--fs-10)",
        fontFamily: "var(--font-mono)",
      }}
    >
      {label}
    </div>
  );
}

function keyOf(f: FileSlot): string {
  return sidedFileKey(f.side, f.path);
}

/**
 * Selection key for a folder row in tree mode. The `dir:` marker keeps folder
 * keys out of the file key space (`side:path`), so nothing can mistake a
 * directory for a file with an unlucky name.
 */
function dirKeyOf(side: FileSlot["side"], dirPath: string): string {
  return sidedFolderKey(side, dirPath);
}

/**
 * One change section (STAGED or CHANGES) rendered as a nested tree.
 *
 * Translates at its edges only: PGFileTree speaks "/a/b" row keys, this screen
 * speaks `side:path`. Every file row therefore carries the exact key its flat
 * PGChangeRow twin would, so selection, staging and the context menu behave
 * identically in both view modes.
 */
function SectionTree({
  side,
  nodes,
  files,
  expanded,
  onExpandedChange,
  selectedKeys,
  onSelect,
  onRowContextMenu,
  onStageToggle,
}: {
  side: FileSlot["side"];
  nodes: PGFileTreeNode[];
  files: FileSlot[];
  expanded: Record<string, boolean>;
  onExpandedChange: (key: string, next: boolean) => void;
  selectedKeys: ReadonlySet<string>;
  onSelect: (navKey: string, e?: React.MouseEvent) => void;
  onRowContextMenu: (e: React.MouseEvent, navKey: string) => void;
  onStageToggle: (navKey: string, next: boolean) => void;
}) {
  // Tree key → slot, built once per file list. findStatusByTreeKey is a linear
  // scan, and PGFileTree asks stageState for every row — per-row .find made the
  // section quadratic in changed files, paid on every keystroke in the message
  // box (the whole panel re-renders per keystroke).
  const slotByTreeKey = React.useMemo(() => {
    const out = new Map<string, FileSlot>();
    for (const f of files) out.set(`/${f.path.replace(/\/+$/, "")}`, f);
    return out;
  }, [files]);

  const navKeyFor = React.useCallback(
    (treeKey: string): string => {
      const slot = slotByTreeKey.get(treeKey);
      return slot ? keyOf(slot) : dirKeyOf(side, treeKeyToPath(treeKey));
    },
    [slotByTreeKey, side],
  );

  // Every row in a section shares that section's staged-ness: the STAGED list
  // only holds staged work, CHANGES only unstaged. Embedded repos are the one
  // exception — they can't be staged at all, so they get no checkbox.
  const stageState = React.useCallback(
    (treeKey: string): PGStageState | undefined => {
      const slot = slotByTreeKey.get(treeKey);
      if (slot?.status.embedded) return undefined;
      return side === "staged" ? "all" : "none";
    },
    [slotByTreeKey, side],
  );

  const treeSelectedKeys = React.useMemo(
    () =>
      new Set(
        [...selectedKeys]
          .filter((k) => k.startsWith(`${side}:`))
          .map((k) =>
            k.startsWith(`${side}:dir:`)
              ? `/${k.slice(`${side}:dir:`.length)}`
              : `/${k.slice(`${side}:`.length)}`,
          )
          // An embedded repo's status path keeps a trailing slash the row key
          // has already lost.
          .map((k) => k.replace(/\/+$/, "")),
      ),
    [selectedKeys, side],
  );

  return (
    <PGFileTree
      nodes={nodes}
      expanded={expanded}
      onToggle={onExpandedChange}
      selectedKeys={treeSelectedKeys}
      onSelect={(treeKey, _node, e) => onSelect(navKeyFor(treeKey), e)}
      onRowContextMenu={(e, treeKey) => onRowContextMenu(e, navKeyFor(treeKey))}
      stageState={stageState}
      onStageToggle={(treeKey, _node, next) => onStageToggle(navKeyFor(treeKey), next)}
    />
  );
}

/**
 * Parse a `Name <email>` identity. Returns null for anything else, which is
 * what gates the commit button — a half-typed author is a mistake worth
 * catching before it lands in history, where fixing it means a rewrite.
 */
export function parseIdentity(raw: string): AuthorOverride | null {
  const m = /^\s*(\S.*?)\s*<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/.exec(raw);
  if (!m) return null;
  return { name: m[1], email: m[2] };
}

/**
 * `Co-Authored-By:` trailers for a comma/newline-separated list of identities.
 * Unparseable entries are dropped rather than emitted malformed — GitHub only
 * credits a trailer it can parse.
 */
export function coAuthorTrailers(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const chunk of raw.split(/[\n,]/)) {
    const id = parseIdentity(chunk);
    if (!id) continue;
    const line = `Co-Authored-By: ${id.name} <${id.email}>`;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

function buildMessage(message: string, coAuthors: string[] = []): string {
  const trimmed = message.trimEnd();
  // Trailers go in their own block after one blank line — that separation is
  // what `git interpret-trailers` (and GitHub) key on. Skip any the message
  // already spells out, so hand-written and generated trailers can't double up.
  const fresh = coAuthors.filter(
    (t) => !trimmed.toLowerCase().includes(t.toLowerCase()),
  );
  return fresh.length ? `${trimmed}\n\n${fresh.join("\n")}` : trimmed;
}

/**
 * HEAD's message as the composer holds it: subject line, blank line, body.
 * `summary` + `body` round-trip the raw message for any commit whose subject
 * is a single line — which is every commit written to convention.
 */
function headMessage(c: CommitInfo): string {
  const body = (c.body ?? "").trim();
  return body ? `${c.summary}\n\n${body}` : c.summary;
}

export interface RecentMessage {
  subject: string;
  body: string;
}

/**
 * Recent commit messages for the dropdown, newest-first, deduped by full
 * message text. Strips any `Signed-off-by:` trailer so re-selecting a message
 * doesn't carry a stale sign-off (the toggle re-adds it on commit). Drops
 * merge commits, which rarely make useful templates.
 */
export function recentCommitMessages(
  commits: CommitInfo[],
  limit = 15,
): RecentMessage[] {
  const out: RecentMessage[] = [];
  const seen = new Set<string>();
  for (const c of commits) {
    if (c.parents.length > 1) continue; // skip merge commits
    const subject = c.summary.trim();
    if (!subject) continue;
    const body = stripSignoff(c.body ?? "").trim();
    const dedupeKey = `${subject}\n${body}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({ subject, body });
    if (out.length >= limit) break;
  }
  return out;
}

function stripSignoff(body: string): string {
  return body
    .split("\n")
    .filter((line) => !/^Signed-off-by:\s/i.test(line.trim()))
    .join("\n");
}

function diffToSplit(d: FileDiff): { left: SideLine[]; right: SideLine[] } {
  const left: SideLine[] = [];
  const right: SideLine[] = [];
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


function Header({
  title,
  badge,
  action,
  border,
}: {
  title: string;
  badge?: React.ReactNode;
  action?: React.ReactNode;
  border?: boolean;
}) {
  return (
    <div
      style={{
        height: 28,
        padding: "0 10px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "var(--bg-2)",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-11)",
        color: "var(--fg-1)",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        borderBottom: border ? "1px solid var(--border-0)" : undefined,
      }}
    >
      <span>{title}</span>
      {badge}
      <div style={{ flex: 1 }} />
      {action}
    </div>
  );
}

function LabelRow({
  label,
  right,
}: {
  label: string;
  right?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        marginBottom: 4,
      }}
    >
      <span
        style={{
          fontSize: "var(--fs-11)",
          color: "var(--fg-2)",
          fontFamily: "var(--font-mono)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {label}
      </span>
      {right}
    </div>
  );
}
