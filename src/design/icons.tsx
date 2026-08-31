import type { CSSProperties, ReactNode } from "react";

export type IconName =
  | "repo" | "branch" | "commit" | "merge" | "fork" | "tag" | "pullRequest"
  | "folder" | "folderOpen" | "file" | "fileCode"
  // File-type category glyphs — resolved per path by lib/fileIcon.ts.
  | "fileData" | "fileDoc" | "fileStyle" | "fileImage" | "fileShell"
  | "fileConfig" | "fileLock" | "fileArchive" | "fileBinary" | "fileGit"
  | "plus" | "minus" | "check" | "x"
  | "chevronRight" | "chevronDown" | "chevronUp" | "chevronLeft"
  | "search" | "settings" | "filter" | "sort" | "more"
  | "pull" | "push" | "fetch" | "sync" | "stash" | "rebase"
  | "dot" | "circle" | "warn" | "error" | "info" | "clock"
  | "user" | "eye" | "terminal" | "history" | "kbd"
  | "download" | "upload" | "link" | "lock"
  | "play" | "pause" | "star" | "copy" | "external" | "pin"
  | "edit" | "trash" | "conflict" | "squash" | "drag" | "bell"
  | "diff" | "undo" | "fix" | "expandAll" | "collapseAll"
  | "viewTree" | "viewList"
  // #93 — submodules, linked worktrees, bisect, LFS.
  | "submodule" | "worktree" | "bisect" | "lfs";

const ICONS: Record<IconName, ReactNode> = {
  repo: <>
    <path d="M3 2.5A1.5 1.5 0 0 1 4.5 1h8A1.5 1.5 0 0 1 14 2.5V13a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V2.5z" />
    <path d="M3 12a2 2 0 0 1 2-2h8" />
  </>,
  branch: <>
    <circle cx="4" cy="3.5" r="1.5" />
    <circle cx="4" cy="12.5" r="1.5" />
    <circle cx="12" cy="6" r="1.5" />
    <path d="M4 5v6M4 8c0-2 3-2 5-2" />
  </>,
  commit: <>
    <circle cx="8" cy="8" r="3" />
    <path d="M1 8h4M11 8h4" />
  </>,
  merge: <>
    <circle cx="4" cy="3.5" r="1.5" />
    <circle cx="4" cy="12.5" r="1.5" />
    <circle cx="12" cy="8" r="1.5" />
    <path d="M4 5v6M4 6c0 3 3.5 2 6.5 2" />
  </>,
  fork: <>
    <circle cx="4" cy="3.5" r="1.5" />
    <circle cx="12" cy="3.5" r="1.5" />
    <circle cx="8" cy="12.5" r="1.5" />
    <path d="M4 5c0 3 4 3 4 6M12 5c0 3-4 3-4 6" />
  </>,
  // Pull / merge request (#92): a source lane arrowing into a target lane.
  pullRequest: <>
    <circle cx="4" cy="12.5" r="1.5" />
    <circle cx="12" cy="3.5" r="1.5" />
    <circle cx="12" cy="12.5" r="1.5" />
    <path d="M4 11V5.5M12 5v6M4 5.5l-2 2M4 5.5l2 2" />
  </>,
  tag: <>
    <path d="M1.5 2.5h6l7 7-6 6-7-7v-6z" />
    <circle cx="4.5" cy="5.5" r="1" />
  </>,
  folder: <path d="M1.5 4a1 1 0 0 1 1-1h3l1.5 1.5H13.5a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4z" />,
  folderOpen: <path d="M1.5 5a1 1 0 0 1 1-1h3l1.5-1.5h6a1 1 0 0 1 1 1V6M1.5 6h13l-1.5 6.5a1 1 0 0 1-1 .5h-9a1 1 0 0 1-1-.5L1.5 6z" />,
  file: <>
    <path d="M3 1.5h6l4 4V13.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z" />
    <path d="M9 1.5v4h4" />
  </>,
  fileCode: <>
    <path d="M3 1.5h6l4 4V13.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z" />
    <path d="M9 1.5v4h4M6 9l-1.5 1.5L6 12M10 9l1.5 1.5L10 12" />
  </>,
  // ── File-type category glyphs ───────────────────────────────────────────
  // All share the `file` page outline so a mixed list reads as one family;
  // the mark inside the page is what distinguishes the category.
  fileData: <>
    <path d="M3 1.5h6l4 4V13.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z" />
    <path d="M9 1.5v4h4M6.5 8.5c-1 0-1 1.25-1 1.25s0 1.25 1 1.25M9.5 8.5c1 0 1 1.25 1 1.25s0 1.25-1 1.25" />
  </>,
  fileDoc: <>
    <path d="M3 1.5h6l4 4V13.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z" />
    <path d="M9 1.5v4h4M4.5 8.5h5M4.5 10.5h5M4.5 12.5h3" />
  </>,
  fileStyle: <>
    <path d="M3 1.5h6l4 4V13.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z" />
    <path d="M9 1.5v4h4M8 8.5c-1.5 1.6-2.25 2.6-2.25 3.35a2.25 2.25 0 0 0 4.5 0C10.25 11.1 9.5 10.1 8 8.5z" />
  </>,
  fileImage: <>
    <path d="M3 1.5h6l4 4V13.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z" />
    <path d="M9 1.5v4h4M2 12.5l3-3 2.5 2.5M9 10l1.5-1.5 2.5 2.5" />
    <circle cx="6" cy="7.5" r=".9" />
  </>,
  fileShell: <>
    <path d="M3 1.5h6l4 4V13.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z" />
    <path d="M9 1.5v4h4M4.5 8.5l2 1.75-2 1.75M8 12.25h3" />
  </>,
  fileConfig: <>
    <path d="M3 1.5h6l4 4V13.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z" />
    <path d="M9 1.5v4h4" />
    <circle cx="7.5" cy="10.5" r="1.6" />
    <path d="M7.5 7.6v1.3M7.5 12.1v1.3M4.9 9v0M10.1 12v0M4.9 12v0M10.1 9v0" />
  </>,
  fileLock: <>
    <path d="M3 1.5h6l4 4V13.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z" />
    <path d="M9 1.5v4h4" />
    <rect x="5" y="10" width="6" height="3.5" rx=".75" />
    <path d="M6.25 10V9a1.75 1.75 0 0 1 3.5 0v1" />
  </>,
  fileArchive: <>
    <path d="M3 1.5h6l4 4V13.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z" />
    <path d="M9 1.5v4h4M6.5 2v1M8 3.5v1M6.5 5v1M8 6.5v1M6.5 8v1" />
    <rect x="6" y="10" width="2.5" height="3" rx=".5" />
  </>,
  fileBinary: <>
    <path d="M3 1.5h6l4 4V13.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z" />
    <path d="M9 1.5v4h4M5 8.75l1-.5v3.5M4.75 11.75h2.5" />
    <rect x="8.75" y="8.25" width="2.5" height="3.5" rx="1.25" />
  </>,
  fileGit: <>
    <path d="M3 1.5h6l4 4V13.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z" />
    <path d="M9 1.5v4h4" />
    <circle cx="5.5" cy="8.5" r="1" />
    <circle cx="5.5" cy="12.5" r="1" />
    <circle cx="10" cy="9.75" r="1" />
    <path d="M5.5 9.5v2M5.5 11c0-1.5 1.5-1.25 3.5-1.25" />
  </>,
  plus: <path d="M8 3v10M3 8h10" />,
  minus: <path d="M3 8h10" />,
  check: <path d="M3 8.5l3.5 3.5L13 5.5" />,
  x: <path d="M4 4l8 8M12 4l-8 8" />,
  chevronRight: <path d="M6 3l5 5-5 5" />,
  chevronDown: <path d="M3 6l5 5 5-5" />,
  chevronUp: <path d="M3 10l5-5 5 5" />,
  chevronLeft: <path d="M10 3l-5 5 5 5" />,
  search: <>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5l3 3" />
  </>,
  settings: <>
    <path d="M6.76 3.16 L6.58 1.66 L9.42 1.66 L9.24 3.16 L10.55 3.7 L11.48 2.51 L13.49 4.52 L12.3 5.45 L12.84 6.76 L14.34 6.58 L14.34 9.42 L12.84 9.24 L12.3 10.55 L13.49 11.48 L11.48 13.49 L10.55 12.3 L9.24 12.84 L9.42 14.34 L6.58 14.34 L6.76 12.84 L5.45 12.3 L4.52 13.49 L2.51 11.48 L3.7 10.55 L3.16 9.24 L1.66 9.42 L1.66 6.58 L3.16 6.76 L3.7 5.45 L2.51 4.52 L4.52 2.51 L5.45 3.7 Z" />
    <circle cx="8" cy="8" r="2" />
  </>,
  filter: <path d="M2 3h12l-4.5 5.5V13l-3-1V8.5L2 3z" />,
  sort: <path d="M4 3v10M4 13l-2-2M4 13l2-2M12 3v10M12 3l-2 2M12 3l2 2" />,
  more: <>
    <circle cx="3" cy="8" r="1" />
    <circle cx="8" cy="8" r="1" />
    <circle cx="13" cy="8" r="1" />
  </>,
  pull: <path d="M8 3v8M4 7l4 4 4-4M3 13h10" />,
  push: <path d="M8 13V5M4 9l4-4 4 4M3 3h10" />,
  fetch: <>
    <circle cx="8" cy="8" r="5" />
    <path d="M8 5v3l2 2" />
  </>,
  sync: <>
    <path d="M 3.3 6.29 A 5 5 0 0 1 12.7 6.29" />
    <path d="M 11.02 5.2 L 12.7 6.29 L 13.28 4.38" />
    <path d="M 12.7 9.71 A 5 5 0 0 1 3.3 9.71" />
    <path d="M 4.98 10.8 L 3.3 9.71 L 2.72 11.62" />
  </>,
  stash: <>
    <path d="M2 5h12M3 8h10M5 11h6" />
    <rect x="4" y="2" width="8" height="1" />
  </>,
  rebase: <>
    <circle cx="4" cy="3" r="1.2" />
    <circle cx="4" cy="8" r="1.2" />
    <circle cx="4" cy="13" r="1.2" />
    <circle cx="12" cy="8" r="1.2" />
    <path d="M4 4.2v2.6M4 9.2v2.6M5.2 8H10.8" />
  </>,
  dot: <circle cx="8" cy="8" r="3" fill="currentColor" stroke="none" />,
  circle: <circle cx="8" cy="8" r="5" />,
  warn: <>
    <path d="M8 2l7 12H1L8 2z" />
    <path d="M8 6v4M8 12v.01" />
  </>,
  error: <>
    <circle cx="8" cy="8" r="6" />
    <path d="M5 5l6 6M11 5l-6 6" />
  </>,
  info: <>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 5v0M8 8v4" />
  </>,
  clock: <>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 5v3l2 2" />
  </>,
  user: <>
    <circle cx="8" cy="5" r="2.5" />
    <path d="M3 14c0-3 2.5-5 5-5s5 2 5 5" />
  </>,
  eye: <>
    <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
    <circle cx="8" cy="8" r="2" />
  </>,
  terminal: <>
    <rect x="1.5" y="2.5" width="13" height="11" />
    <path d="M4 6l2 2-2 2M8 10h3" />
  </>,
  history: <>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 5v3l2 2M2 8h1M8 2v1" />
  </>,
  kbd: <>
    <rect x="1.5" y="4" width="13" height="8" />
    <path d="M4 8h0M7 8h0M10 8h0M4 10h6" />
  </>,
  download: <path d="M8 2v9M4 7l4 4 4-4M2 14h12" />,
  upload: <path d="M8 11V2M4 6l4-4 4 4M2 14h12" />,
  link: <path d="M7 9a3 3 0 0 0 4 0l2-2a3 3 0 0 0-4-4l-1 1M9 7a3 3 0 0 0-4 0l-2 2a3 3 0 0 0 4 4l1-1" />,
  lock: <>
    <rect x="2.5" y="7" width="11" height="7" />
    <path d="M5 7V4.5a3 3 0 0 1 6 0V7" />
  </>,
  play: <path d="M4 3l9 5-9 5V3z" />,
  pause: <>
    <rect x="4" y="3" width="3" height="10" />
    <rect x="9" y="3" width="3" height="10" />
  </>,
  star: <path d="M8 1l2 5 5 .5-4 3.5 1 5-4-2.5-4 2.5 1-5-4-3.5 5-.5z" />,
  pin: <>
    <path d="M6 2h4l-.5 4 2 2.5H4.5L6.5 6z" />
    <path d="M8 8.5V14" />
  </>,
  copy: <>
    <rect x="4" y="4" width="10" height="10" />
    <path d="M2 10V2h8v2" />
  </>,
  external: <>
    <path d="M6 2H2v12h12V10" />
    <path d="M8 8l6-6M9 2h5v5" />
  </>,
  edit: <path d="M2 14l2-5 8-8 3 3-8 8-5 2z" />,
  trash: <path d="M2.5 4.5h11M5 4.5V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1.5M4 4.5V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.5" />,
  conflict: <path d="M8 1v5M8 10v0M8 6L4 14h8L8 6z" />,
  squash: <>
    <circle cx="8" cy="4" r="1.2" />
    <circle cx="8" cy="8" r="1.2" />
    <circle cx="8" cy="12" r="1.2" />
    <path d="M4 4h3M4 8h3M4 12h3" />
  </>,
  drag: <>
    <circle cx="5" cy="4" r=".8" fill="currentColor" stroke="none" />
    <circle cx="5" cy="8" r=".8" fill="currentColor" stroke="none" />
    <circle cx="5" cy="12" r=".8" fill="currentColor" stroke="none" />
    <circle cx="11" cy="4" r=".8" fill="currentColor" stroke="none" />
    <circle cx="11" cy="8" r=".8" fill="currentColor" stroke="none" />
    <circle cx="11" cy="12" r=".8" fill="currentColor" stroke="none" />
  </>,
  bell: <path d="M4 12V8a4 4 0 0 1 8 0v4M2.5 12h11M7 14h2" />,
  // Aliases used by context menus
  diff: <>
    <path d="M3 1.5h6l4 4V13.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z" />
    <path d="M9 1.5v4h4M5 8h6M5 11h4" />
  </>,
  undo: <path d="M6 5L3 8l3 3M3 8h7a3 3 0 0 1 0 6H8" />,
  fix: <path d="M10 2l4 4-2 2-4-4 2-2zM8 4L2 10v4h4l6-6" />,
  // Chevrons pointing away from center = unfold (expand all).
  expandAll: <path d="M4.5 6L8 2.5 11.5 6M4.5 10L8 13.5 11.5 10" />,
  // Chevrons pointing toward center = fold (collapse all).
  collapseAll: <path d="M4.5 3L8 6.5 11.5 3M4.5 13L8 9.5 11.5 13" />,
  // View-mode pair: an indented hierarchy vs a flat stack of rows.
  viewTree: <>
    <path d="M2.5 2.5v9.5M2.5 5.5h3M2.5 9h3M2.5 12.5h3" />
    <path d="M7 2.5h6.5M7 5.5h6.5M7 9h6.5M7 12.5h6.5" />
  </>,
  viewList: <>
    <circle cx="3" cy="4" r=".9" fill="currentColor" stroke="none" />
    <circle cx="3" cy="8" r=".9" fill="currentColor" stroke="none" />
    <circle cx="3" cy="12" r=".9" fill="currentColor" stroke="none" />
    <path d="M6 4h8M6 8h8M6 12h8" />
  </>,
  // #93. A repository inside a repository — the outer frame with an inner one
  // pinned to its corner, which is what a gitlink is.
  submodule: <>
    <path d="M1.5 2.5h8a1 1 0 0 1 1 1v3" />
    <path d="M1.5 2.5v9a1 1 0 0 0 1 1h4" />
    <rect x="7.5" y="7.5" width="7" height="6" rx="1" />
    <path d="M9.5 10.5h3" />
  </>,
  // Two checkouts of one history: a shared trunk splitting into two panels.
  worktree: <>
    <path d="M2.5 3.5v9M2.5 6h4M2.5 11h4" />
    <rect x="7" y="3" width="7" height="5" rx="1" />
    <rect x="7" y="9.5" width="7" height="4" rx="1" />
  </>,
  // Halving a range: a span with its midpoint marked.
  bisect: <>
    <path d="M2 12.5h12" />
    <path d="M2 12.5V9M14 12.5V9" />
    <circle cx="8" cy="12.5" r="1.8" fill="currentColor" stroke="none" />
    <path d="M8 8V2.5M6 4.5L8 2.5l2 2" />
  </>,
  // Large-file storage: a stack with an arrow going out to it.
  lfs: <>
    <path d="M2.5 5c0-1 2.5-2 5.5-2s5.5 1 5.5 2-2.5 2-5.5 2S2.5 6 2.5 5z" />
    <path d="M2.5 5v6c0 1 2.5 2 5.5 2s5.5-1 5.5-2V5" />
    <path d="M2.5 8c0 1 2.5 2 5.5 2s5.5-1 5.5-2" />
  </>,
};

export interface PGIconProps {
  name: IconName | string;
  size?: number;
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
  const content = ICONS[name as IconName];
  if (!content) {
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
      style={{ flexShrink: 0, ...style }}
    >
      {content}
    </svg>
  );
}
