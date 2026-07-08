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
  /** Lines added vs HEAD (worktree + index). 0 when unmodified/binary or in
   *  listings that don't compute stats (all-files / at-revision). */
  additions: number;
  /** Lines removed vs HEAD (worktree + index). */
  deletions: number;
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

/**
 * Backend commit-log filter. All set fields are ANDed. String matches are
 * case-insensitive substring matches except `shaPrefix` (matches a prefix of the full OID, hex).
 * Mirrors Rust `LogFilter` in `git/types.rs`.
 */
export interface LogFilter {
  /** Substring of the commit message (summary + body). */
  message?: string | null;
  /** Substring of author name OR email. */
  author?: string | null;
  /** Prefix of the commit OID (hex). */
  shaPrefix?: string | null;
  /** Lower bound on commit time, unix seconds (inclusive). */
  since?: number | null;
  /** Upper bound on commit time, unix seconds (inclusive). */
  until?: number | null;
  /** Only commits that touched this path (relative to repo root). */
  path?: string | null;
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

/** Mirrors Rust PullMode enum. */
export type PullMode = "FastForward" | "Merge" | "Rebase";

/** Mirrors Rust PushForce enum. */
export type PushForce = "None" | "WithLease" | "Force";

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

export interface FileContent {
  path: string;
  binary: boolean;
  /** null when binary or missing */
  text: string | null;
  /** true when the file only exists in HEAD (deleted from worktree) */
  fromHead: boolean;
  size: number;
}

export type RepoState =
  | "Clean"
  | "Merge"
  | "Revert"
  | "RevertSequence"
  | "CherryPick"
  | "CherryPickSequence"
  | "Bisect"
  | "Rebase"
  | "RebaseInteractive"
  | "RebaseMerge"
  | "ApplyMailbox"
  | "ApplyMailboxOrRebase";

export interface ConflictSides {
  path: string;
  base: string | null;
  ours: string | null;
  theirs: string | null;
  binary: boolean;
}

// ─── Interactive rebase ───────────────────────────────────────────────────────

export type RebaseAction = "Pick" | "Reword" | "Edit" | "Squash" | "Fixup" | "Drop";

export interface RebaseStep {
  oid: string;
  action: RebaseAction;
  message: string | null;
}

export interface RebaseStatus {
  inProgress: boolean;
  nextIndex: number;
  total: number;
  pauseReason: string | null;
}

export type ReflogOp =
  | { kind: "Commit" }
  | { kind: "Amend" }
  | { kind: "Reset" }
  | { kind: "Checkout" }
  | { kind: "Merge" }
  | { kind: "Rebase" }
  | { kind: "Pull" }
  | { kind: "Clone" }
  | { kind: "Other"; detail: string };

export interface ReflogEntry {
  oid: string;
  shortOid: string;
  message: string;
  op: ReflogOp;
  timestamp: number;
}

export interface BlameLine {
  lineNo: number;
  oid: string;
  shortOid: string;
  author: string;
  email: string;
  timestamp: number;
  summary: string;
  content: string;
}

/** CLI launch request (pgit [subcommand] [path]) — mirrors Rust cli::LaunchIntent. */
export interface LaunchIntent {
  path: string | null;
  screen: string | null;
}

export interface CliShimStatus {
  installed: boolean;
  shimPath: string;
  target: string;
}

export interface CliInstallOutcome {
  installed: boolean;
  path: string;
  manualCommand: string | null;
}
