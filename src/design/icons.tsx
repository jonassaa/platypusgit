import type { CSSProperties, ReactNode } from "react";

export type IconName =
  | "repo" | "branch" | "commit" | "merge" | "fork" | "tag"
  | "folder" | "folderOpen" | "file" | "fileCode"
  | "plus" | "minus" | "check" | "x"
  | "chevronRight" | "chevronDown" | "chevronUp" | "chevronLeft"
  | "search" | "settings" | "filter" | "sort" | "more"
  | "pull" | "push" | "fetch" | "sync" | "stash" | "rebase"
  | "dot" | "circle" | "warn" | "error" | "info" | "clock"
  | "user" | "eye" | "terminal" | "history" | "kbd"
  | "download" | "upload" | "link" | "lock"
  | "play" | "pause" | "star" | "copy" | "external"
  | "edit" | "trash" | "conflict" | "squash" | "drag" | "bell"
  | "diff" | "undo" | "fix";

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
    <circle cx="8" cy="8" r="2" />
    <path d="M8 1v2M8 13v2M15 8h-2M3 8H1M12.95 3.05l-1.41 1.41M4.46 11.54l-1.41 1.41M12.95 12.95l-1.41-1.41M4.46 4.46L3.05 3.05" />
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
  sync: <path d="M3 8a5 5 0 0 1 8.5-3.5L13 6M13 8a5 5 0 0 1-8.5 3.5L3 10M11 3v3h-3M5 13v-3h3" />,
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
};

export interface PGIconProps {
  name: IconName | string;
  size?: number;
  strokeWidth?: number;
  style?: CSSProperties;
  className?: string;
}

export function PGIcon({
  name,
  size = 14,
  strokeWidth = 1.5,
  style,
  className,
}: PGIconProps) {
  const content = ICONS[name as IconName];
  if (!content) {
    return (
      <span
        style={{ width: size, height: size, display: "inline-block", ...style }}
      />
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
