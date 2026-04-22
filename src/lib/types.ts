export type RepoId = string;

export interface RepoHandle {
  id: RepoId;
  path: string;
  head: string | null;
}

export type StatusFlag =
  | { kind: "Unmodified" }
  | { kind: "Modified" }
  | { kind: "Added" }
  | { kind: "Deleted" }
  | { kind: "Renamed" }
  | { kind: "Typechange" }
  | { kind: "Untracked" }
  | { kind: "Ignored" }
  | { kind: "Conflicted" };

export interface FileStatus {
  path: string;
  worktree: StatusFlag;
  index: StatusFlag;
}

export interface CommitInfo {
  oid: string;
  shortOid: string;
  summary: string;
  body: string | null;
  author: string;
  email: string;
  /** unix timestamp, seconds */
  timestamp: number;
  parents: string[];
  refs: string[];
}

export interface BranchInfo {
  name: string;
  isHead: boolean;
  isRemote: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  tip: string | null;
}

export interface TagInfo {
  name: string;
  shortOid: string;
  oid: string;
}

export interface StashInfo {
  index: number;
  shortOid: string;
  message: string;
}

export interface RemoteInfo {
  name: string;
  url: string | null;
}

export type DiffKind = "WorktreeToIndex" | "IndexToHead" | "WorktreeToHead";

export type DiffLineKind =
  | { kind: "Context" }
  | { kind: "Addition" }
  | { kind: "Deletion" }
  | { kind: "HunkHeader" };

export interface DiffLine {
  kind: DiffLineKind;
  oldLineno: number | null;
  newLineno: number | null;
  content: string;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  oldPath: string | null;
  binary: boolean;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}
