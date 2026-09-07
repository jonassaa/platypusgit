/**
 * The app's icon set.
 *
 * Glyphs come from `lucide-react`. This module is the ONLY place that imports
 * it: every surface renders `<PGIcon name="…" />` with a name from
 * {@link IconName}, so swapping the underlying set again is a one-file change
 * and a name that nobody draws is caught by the type checker rather than by a
 * blank gap in the UI.
 *
 * Two things are deliberate:
 *
 * - **Stroke width is expressed on a 16 grid.** The hand-drawn set this
 *   replaced used a 16-unit viewBox at `strokeWidth: 1.5`; lucide draws on a
 *   24-unit grid. A stroke's rendered thickness is `strokeWidth * size / grid`,
 *   so the width handed to lucide is scaled by {@link STROKE_GRID_SCALE}
 *   (24/16). `strokeWidth={1.5}` therefore renders at exactly the weight it
 *   always did, at every `size` — including the size-10 checkbox glyphs that
 *   ask for 2.5.
 * - **An unknown name renders a visible dashed square**, not nothing. A typo'd
 *   name is then obvious on screen instead of silently collapsing the row.
 */
import type { CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Archive,
  ArrowDownToLine,
  ArrowUpDown,
  ArrowUpFromLine,
  Bell,
  BookMarked,
  Bug,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  CircleSmall,
  CircleX,
  Clock,
  CloudDownload,
  Combine,
  Copy,
  Database,
  Download,
  Ellipsis,
  ExternalLink,
  Eye,
  File,
  FileArchive,
  FileBraces,
  FileCode,
  FileCog,
  FileDiff,
  FileDigit,
  FileImage,
  FileLock,
  FileSliders,
  FileTerminal,
  FileText,
  FileType,
  FoldVertical,
  Folder,
  FolderGit2,
  FolderOpen,
  FolderSymlink,
  Funnel,
  GitBranch,
  GitCommitHorizontal,
  GitFork,
  GitGraph,
  GitMerge,
  GitMergeConflict,
  GitPullRequest,
  GripVertical,
  Info,
  Keyboard,
  Link,
  List,
  ListTree,
  Lock,
  Minus,
  PanelBottom,
  PanelRight,
  Pause,
  Pencil,
  Pin,
  Play,
  Plus,
  RefreshCw,
  RotateCcwClock,
  RotateCw,
  Search,
  Settings,
  Split,
  Star,
  Tag,
  Terminal,
  Trash,
  TriangleAlert,
  Undo2,
  UnfoldVertical,
  Upload,
  User,
  Wrench,
  X,
} from "lucide-react";

export type IconName =
  | "repo" | "branch" | "commit" | "merge" | "fork" | "tag" | "pullRequest"
  | "folder" | "folderOpen" | "file" | "fileCode"
  // File-type category glyphs — resolved per path by lib/fileIcon.ts.
  | "fileData" | "fileDoc" | "fileStyle" | "fileImage" | "fileShell"
  | "fileConfig" | "fileLock" | "fileArchive" | "fileBinary" | "fileGit"
  | "plus" | "minus" | "check" | "x"
  | "chevronRight" | "chevronDown" | "chevronUp" | "chevronLeft"
  | "search" | "settings" | "filter" | "sort" | "more"
  | "pull" | "push" | "fetch" | "sync" | "refresh" | "stash" | "rebase"
  | "dot" | "circle" | "warn" | "error" | "info" | "clock" | "bug"
  | "user" | "eye" | "terminal" | "history" | "kbd"
  | "download" | "upload" | "link" | "lock"
  | "play" | "pause" | "star" | "copy" | "external" | "pin"
  | "edit" | "trash" | "conflict" | "squash" | "drag" | "bell"
  | "diff" | "undo" | "fix" | "expandAll" | "collapseAll"
  | "viewTree" | "viewList"
  // Pane placement — which edge a panel is docked to. The diff-layout toggle
  // shows the layout that is CURRENTLY in effect.
  | "panelBottom" | "panelRight"
  // #93 — submodules, linked worktrees, bisect, LFS.
  | "submodule" | "worktree" | "bisect" | "lfs";

const ICONS: Record<IconName, LucideIcon> = {
  // ── Repository objects ──────────────────────────────────────────────────
  repo: BookMarked,
  branch: GitBranch,
  commit: GitCommitHorizontal,
  merge: GitMerge,
  fork: GitFork,
  tag: Tag,
  pullRequest: GitPullRequest,

  // ── Files and folders ───────────────────────────────────────────────────
  folder: Folder,
  folderOpen: FolderOpen,
  file: File,
  fileCode: FileCode,
  // All file-type glyphs keep lucide's page outline so a mixed list reads as
  // one family; the mark inside the page distinguishes the category.
  fileData: FileBraces,
  fileDoc: FileText,
  fileStyle: FileType,
  fileImage: FileImage,
  fileShell: FileTerminal,
  fileConfig: FileCog,
  fileLock: FileLock,
  fileArchive: FileArchive,
  fileBinary: FileDigit,
  // Git's own dotfiles (.gitignore, .gitattributes, .mailmap) are a page of
  // rules — sliders, kept distinct from the cog that marks build config.
  fileGit: FileSliders,

  // ── Primitives ──────────────────────────────────────────────────────────
  plus: Plus,
  minus: Minus,
  check: Check,
  x: X,
  chevronRight: ChevronRight,
  chevronDown: ChevronDown,
  chevronUp: ChevronUp,
  chevronLeft: ChevronLeft,
  search: Search,
  settings: Settings,
  filter: Funnel,
  sort: ArrowUpDown,
  more: Ellipsis,

  // ── Network and history ops ─────────────────────────────────────────────
  // pull/push are arrows meeting a baseline (the local checkout); fetch only
  // brings refs down, so it stays a cloud.
  pull: ArrowDownToLine,
  push: ArrowUpFromLine,
  fetch: CloudDownload,
  sync: RefreshCw,
  refresh: RotateCw,
  stash: Archive,
  rebase: GitGraph,

  // ── Status ──────────────────────────────────────────────────────────────
  // lucide's `Dot` renders a ~2px speck at size 14 — invisible in the status bar.
  dot: CircleSmall,
  circle: Circle,
  warn: TriangleAlert,
  error: CircleX,
  info: Info,
  clock: Clock,
  bug: Bug,

  // ── Chrome ──────────────────────────────────────────────────────────────
  user: User,
  eye: Eye,
  terminal: Terminal,
  history: RotateCcwClock,
  kbd: Keyboard,
  download: Download,
  upload: Upload,
  link: Link,
  lock: Lock,
  play: Play,
  pause: Pause,
  star: Star,
  copy: Copy,
  external: ExternalLink,
  pin: Pin,
  edit: Pencil,
  trash: Trash,

  // ── Rebase / merge vocabulary ───────────────────────────────────────────
  conflict: GitMergeConflict,
  squash: Combine,
  drag: GripVertical,
  bell: Bell,
  diff: FileDiff,
  undo: Undo2,
  fix: Wrench,
  // Chevrons pointing away from centre = unfold; toward centre = fold.
  expandAll: UnfoldVertical,
  collapseAll: FoldVertical,
  // View-mode pair: an indented hierarchy vs a flat stack of rows.
  viewTree: ListTree,
  viewList: List,

  // ── Pane placement ──────────────────────────────────────────────────────
  panelBottom: PanelBottom,
  panelRight: PanelRight,

  // ── #93 ─────────────────────────────────────────────────────────────────
  // A repository nested inside a repository is what a gitlink is.
  submodule: FolderGit2,
  // A linked worktree is a second checkout pointing at one history.
  worktree: FolderSymlink,
  // Halving a range until the culprit is cornered.
  bisect: Split,
  // Large files kept outside the object database.
  lfs: Database,
};

/**
 * Multiplier from the 16-unit grid `strokeWidth` is expressed on to lucide's
 * 24-unit grid. See the module comment.
 */
const STROKE_GRID_SCALE = 24 / 16;

export interface PGIconProps {
  name: IconName | string;
  size?: number;
  /** Stroke width on a 16-unit grid; scaled to lucide's 24-unit grid. */
  strokeWidth?: number;
  style?: CSSProperties;
  className?: string;
}

const warnedIcons = new Set<string>();

export function PGIcon({
  name,
  size = 14,
  strokeWidth = 1.5,
  style,
  className,
}: PGIconProps) {
  const Glyph = ICONS[name as IconName];
  if (!Glyph) {
    // Visible placeholder (dashed square) instead of a silent blank gap, so a
    // typo'd or missing icon name is obvious. Warn once per name in dev.
    if (import.meta.env?.DEV && !warnedIcons.has(name)) {
      warnedIcons.add(name);
      console.warn(`[PGIcon] unknown icon name: "${name}" — showing fallback glyph`);
    }
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        style={{ flexShrink: 0, opacity: 0.6, ...style }}
        aria-label={`unknown icon: ${name}`}
      >
        <rect x="2.5" y="2.5" width="11" height="11" rx="2" strokeDasharray="2 2" />
      </svg>
    );
  }
  return (
    <Glyph
      size={size}
      strokeWidth={strokeWidth * STROKE_GRID_SCALE}
      className={className}
      style={{ flexShrink: 0, ...style }}
    />
  );
}
