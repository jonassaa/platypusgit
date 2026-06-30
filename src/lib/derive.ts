import type {
  BranchInfo,
  CommitInfo,
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
 * One-character status mark for UI (matches the PGStatusMark kinds).
 * Priority: conflicted > index side > worktree side.
 */
export function statusMark(s: FileStatus): "M" | "A" | "D" | "R" | "?" | "U" | "I" {
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
): { name: string; tone: "accent" | "violet" | "green" | "amber"; remote?: string }[] {
  return refs.map((r) => {
    if (r.startsWith("origin/") || r.includes("/")) {
      const [remote, ...rest] = r.split("/");
      return { name: rest.join("/"), tone: "violet" as const, remote };
    }
    if (r === headBranch) {
      return { name: `HEAD→${r}`, tone: "accent" as const };
    }
    return { name: r, tone: "green" as const };
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
