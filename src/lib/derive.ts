import type {
  BranchInfo,
  CommitInfo,
  FileDiff,
  FileStatus,
  StatusFlag,
} from "./types";

/** Short SHA (first 7 chars) */
export function shortSha(oid: string): string {
  return oid.slice(0, 7);
}

/** Relative time in a compact form. Seconds-level granularity. */
export function relativeTime(unixSeconds: number, now: number = Date.now()): string {
  const diff = Math.max(0, Math.floor(now / 1000) - unixSeconds);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / (86400 * 7))}w ago`;
  if (diff < 86400 * 365)
    return `${Math.floor(diff / (86400 * 30))}mo ago`;
  return `${Math.floor(diff / (86400 * 365))}y ago`;
}

/**
 * A file is "staged" when the INDEX differs from HEAD (i.e. index side
 * has any non-Unmodified flag). It's "unstaged" when the WORKTREE differs
 * from the index.
 */
export function isStaged(s: FileStatus): boolean {
  return s.index.kind !== "Unmodified";
}

export function isUnstaged(s: FileStatus): boolean {
  return s.worktree.kind !== "Unmodified";
}

/**
 * Mid-merge, libgit2 reports a conflicted path on both sides — but not always
 * on both at once (a `mark_resolved` stages the index side while the worktree
 * entry lags a refresh). Either side is enough to call it conflicted; every
 * surface that lists conflicts must agree, or the count in the status bar and
 * the list in the resolver disagree about the same file.
 */
export function isConflicted(s: FileStatus): boolean {
  return s.worktree.kind === "Conflicted" || s.index.kind === "Conflicted";
}

/**
 * Should this diff be rendered as text at all? (#93)
 *
 * Two ways it should not: libgit2 called the blob binary, or it is a git-LFS
 * **pointer** change. The second is why this exists as a helper rather than a
 * `!diff.binary` test at each of the four diff surfaces — a pointer IS text, so
 * `binary` is honestly false, and rendering its hunks claims "2 lines changed"
 * for a multi-megabyte asset. Every surface must agree, or the same file reads
 * differently depending on which pane you opened it in.
 */
export function isTextualDiff(diff: FileDiff | null | undefined): boolean {
  return !!diff && !diff.binary && !diff.lfs;
}

/**
 * Never committed and never staged — git holds no copy of it.
 *
 * Discarding one deletes it outright rather than restoring it, so the UI has to
 * say "delete", not "discard changes", and must confirm first: unlike every
 * other discard, there is nothing to recover it from.
 */
export function isUntracked(s: FileStatus): boolean {
  return s.worktree.kind === "Untracked" && s.index.kind === "Unmodified";
}

/**
 * One-character status mark for UI (matches the PGStatusMark kinds).
 * Priority: embedded repo > conflicted > index side > worktree side.
 *
 * An embedded repository outranks its change flags because it is not a file at
 * all: "?" would invite the user to stage it, and staging is exactly what must
 * not happen (see FileStatus.embedded).
 */
export function statusMark(
  s: FileStatus,
): "M" | "A" | "D" | "R" | "?" | "U" | "I" | "S" {
  if (s.embedded) return "S";
  if (s.worktree.kind === "Conflicted" || s.index.kind === "Conflicted") return "U";
  const primary: StatusFlag =
    s.index.kind !== "Unmodified" ? s.index : s.worktree;
  switch (primary.kind) {
    case "Added":
      return "A";
    case "Deleted":
      return "D";
    case "Renamed":
      return "R";
    case "Untracked":
      return "?";
    case "Ignored":
      return "I";
    case "Modified":
    case "Typechange":
    default:
      return "M";
  }
}

export function currentBranch(branches: BranchInfo[]): BranchInfo | null {
  return branches.find((b) => b.isHead) ?? null;
}

/**
 * The main window's title for the active repository: `name — branch —
 * PlatypusGit`, so window switchers (which truncate from the right) show the
 * part that distinguishes windows first. `null` `repoPath` (no repo open, or
 * the Welcome screen) is just `PlatypusGit`.
 *
 * Detached HEAD has no entry in `branches` (nothing there has `isHead`), so
 * the branch segment falls back to `headOid` — the short OID `RepoHandle.head`
 * already carries in that case (see `BranchChip`, which reads the same field
 * the same way). Unborn (a fresh `git init`, no commits) has neither a branch
 * nor a `headOid`, so the branch segment is omitted rather than shown empty.
 */
export function windowTitle(
  repoPath: string | null,
  branches: BranchInfo[],
  headOid: string | null,
): string {
  if (!repoPath) return "PlatypusGit";
  const repoName = repoPath.split("/").filter(Boolean).pop() ?? repoPath;
  const head = currentBranch(branches);
  const branch = head ? head.name : headOid ? shortSha(headOid) : null;
  return branch ? `${repoName} — ${branch} — PlatypusGit` : `${repoName} — PlatypusGit`;
}

export function localBranches(branches: BranchInfo[]): BranchInfo[] {
  return branches.filter((b) => !b.isRemote);
}

export function remoteBranches(branches: BranchInfo[]): BranchInfo[] {
  return branches.filter((b) => b.isRemote);
}

/**
 * Convert a commit's ref list into the pill-shaped ref objects the
 * UI expects. First HEAD-pointing local branch gets the accent tone.
 */
export function mapCommitRefs(
  refs: string[],
  headBranch: string | null,
): {
  name: string;
  tone: "accent" | "violet" | "green" | "amber";
  remote?: string;
  ref: string;
}[] {
  // `ref` is the name git knows, carried alongside the display name because the
  // display name is lossy: HEAD's pill reads "HEAD→main", and a remote ref is
  // split into name + remote. A drag or any other op needs the original (#91).
  return refs.map((r) => {
    if (r.startsWith("origin/") || r.includes("/")) {
      const [remote, ...rest] = r.split("/");
      return { name: rest.join("/"), tone: "violet" as const, remote, ref: r };
    }
    if (r === headBranch) {
      return { name: `HEAD→${r}`, tone: "accent" as const, ref: r };
    }
    return { name: r, tone: "green" as const, ref: r };
  });
}

/** Aggregate ahead/behind across local tracking branches. */
export function totalAheadBehind(branches: BranchInfo[]): {
  ahead: number;
  behind: number;
} {
  const head = currentBranch(branches);
  return { ahead: head?.ahead ?? 0, behind: head?.behind ?? 0 };
}

export function headSummary(
  commits: CommitInfo[],
): CommitInfo | null {
  return commits[0] ?? null;
}

/**
 * Added-line count for ONE side of a file's changes.
 *
 * A file can be modified on both sides at once, and `additions` is the two
 * combined — so rendering it on a staged row overstates what committing would
 * record, and rendering it on both rows shows the same number twice. The
 * per-side fields answer the question the row is actually asking.
 *
 * Falls back to the combined count when the per-side fields are absent, which is
 * the case for the many `FileStatus` fixtures in tests; `get_status` always
 * sends them.
 */
export function sideAdditions(
  status: FileStatus,
  side: "staged" | "unstaged",
): number {
  const own =
    side === "staged" ? status.stagedAdditions : status.unstagedAdditions;
  return own ?? status.additions;
}

/** Removed-line count for one side. See {@link sideAdditions}. */
export function sideDeletions(
  status: FileStatus,
  side: "staged" | "unstaged",
): number {
  const own =
    side === "staged" ? status.stagedDeletions : status.unstagedDeletions;
  return own ?? status.deletions;
}
