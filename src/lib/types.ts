export type RepoId = string;

/**
 * Log refspec meaning "walk every branch we know of" rather than one ref —
 * local heads, remote-tracking heads and a detached HEAD, in one graph. Mirrors
 * `REFSPEC_ALL` in `src-tauri/src/git/types.rs`; keep the two in step.
 */
export const LOG_REF_ALL = "--all";

export interface RepoHandle {
  id: RepoId;
  path: string;
  head: string | null;
}

/**
 * One path `deleteUntrackedFiles` could not remove (#245). 1:1 with
 * `DeleteFailure` in `src-tauri/src/git/types.rs`.
 *
 * The delete is best-effort once it starts unlinking — three read-only files in
 * a ten-file selection must not decide the fate of the other seven — so a
 * resolved call can still carry failures. Refusals decidable *before* anything
 * is deleted (a tracked path, an escape, an embedded repo, a directory) arrive
 * as a thrown `AppError` instead, and nothing was deleted.
 */
export interface DeleteFailure {
  /** The repo-relative path, as the caller spelled it — a row in the file list. */
  path: string;
  /** The OS's own message. */
  reason: string;
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
  /** Lines added, both sides combined (staged + unstaged). 0 when
   *  unmodified/binary or in listings that don't compute stats (all-files /
   *  at-revision). */
  additions: number;
  /** Lines removed, both sides combined (staged + unstaged). */
  deletions: number;
  /**
   * Lines added between HEAD and the INDEX — what committing would record.
   *
   * Optional only so the many `FileStatus` fixtures in tests need not restate
   * it; `get_status` always sends it. Prefer this and `unstagedAdditions` over
   * the combined pair when rendering a specific side: one number per file
   * cannot serve both, so a partially staged file would otherwise show the same
   * counts on its staged and unstaged rows and the composer would overstate the
   * commit.
   */
  stagedAdditions?: number;
  /** Lines removed between HEAD and the index. */
  stagedDeletions?: number;
  /** Lines added between the index and the WORKING TREE — still unstaged. */
  unstagedAdditions?: number;
  /** Lines removed between the index and the working tree. */
  unstagedDeletions?: number;
  /**
   * True when this entry is a directory that is itself a git repository and is
   * not a registered submodule (vendored dependency, stray clone, submodule
   * nobody registered). libgit2 will not recurse across the nested `.git`, so
   * it reports the directory as ONE entry — with a trailing slash — instead of
   * its files. Such a row has no diff, no blame and no history, and staging it
   * would write a bare gitlink no clone can resolve, so the UI treats it as its
   * own kind of thing rather than as a file.
   */
  embedded: boolean;
  /**
   * True when this entry is a submodule the repository DECLARES (a `.gitmodules`
   * entry with a URL) — the exact complement of `embedded`, and mutually
   * exclusive with it by construction.
   *
   * Its gitlink is intentional, so staging it is an ordinary pointer update; but
   * it still has no diff, no blame and no history, so the row is rendered as a
   * submodule rather than as a directory nobody can explain (#93).
   *
   * Optional only so the many `FileStatus` fixtures in tests need not restate it.
   */
  submodule?: boolean;
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

/** One page of a resumable log walk (#68 G11). Mirrors Rust `LogPage`. */
export interface LogPage {
  commits: CommitInfo[];
  /**
   * Frontier oids to resume from — every parent still awaited when the page
   * ended; null at the true end of history. A SET, not a single oid: several
   * lanes are alive at a page boundary, and resuming from just the last
   * emitted commit would silently drop every other branch.
   */
  nextCursor: string[] | null;
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
  /**
   * Pattern appearing in a line the commit added or removed (git `-G`, not
   * `-S`: "the text was touched", not "the occurrence count changed").
   */
  content?: string | null;
  /** Treat `content` as a regular expression rather than a literal substring. */
  contentRegex?: boolean;
}

/** Verification verdict for one commit's or tag's signature (#61 D6, #132). */
export type SigState =
  | "Good"
  | "Bad"
  | "UnknownKey"
  | "Expired"
  | "Revoked"
  | "None";

export interface SignatureStatus {
  state: SigState;
  /** Who signed it, when git could tell. */
  signer: string | null;
  key: string | null;
}

/**
 * A whole-tree diff against the working tree (#131). Mirrors Rust `WorkdirDiff`.
 *
 * Not a bare `FileDiff[]`: this op walks the WHOLE tree (unlike `getDiff`, which
 * pathspecs one file first), so its untracked side is capped and the number left
 * out travels with the result for the UI to report.
 */
export interface WorkdirDiff {
  files: FileDiff[];
  untrackedOmitted: number;
}

/**
 * How one revision stands relative to another (#131). Mirrors Rust
 * `AheadBehind`.
 *
 * Both counts read FROM `a` TOWARD `b`: `ahead` is what `b` has that `a` does
 * not, `behind` the mirror — the same direction `BranchInfo.ahead/behind` has
 * for a branch against its upstream. `mergeBase` is null for unrelated
 * histories, which is a state, not an error.
 */
export interface AheadBehind {
  ahead: number;
  behind: number;
  mergeBase: string | null;
}

export interface BranchInfo {
  name: string;
  isHead: boolean;
  isRemote: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  tip: string | null;
  /**
   * Committer time of the tip commit, seconds since the epoch. `0` when the tip
   * could not be resolved, which sorts last under newest-first ordering.
   */
  tipTime: number;
  /** Is this the repository's default branch (or a remote's copy of it)? */
  isDefault: boolean;
}

export interface TagInfo {
  name: string;
  shortOid: string;
  oid: string;
  /**
   * Whether this annotated tag's object carries a signature block (#132).
   *
   * A fact, not a verdict — it is read straight off the object during the tag
   * walk, so `list_tags` costs no subprocess. `verifyTag` is what grades the
   * signature, lazily, for the selected tag.
   */
  signed: boolean;
}

/**
 * One entry on the `refs/stash` reflog (#133). Mirrors Rust `StashInfo`.
 *
 * `index` and `oid` are both here because they answer different questions:
 * `index` is a reflog POSITION (anything written to `refs/stash` shifts it, a
 * rename included), so it addresses the ops that edit the reflog; `oid` names
 * the commit and is what a comparison addresses.
 */
export interface StashInfo {
  index: number;
  shortOid: string;
  oid: string;
  message: string;
  /** The entry carries untracked files (`git stash -u` — a third parent). */
  untracked: boolean;
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
  /**
   * Set when this diff is a git-LFS **pointer** change (#93).
   *
   * A pointer is a ≤3-line text file, so `binary` is false and rendering the
   * hunks would claim "2 lines changed" for a multi-megabyte asset. Gate text
   * rendering on `isTextualDiff` (`lib/derive.ts`) rather than on `binary` alone.
   */
  lfs?: LfsDiff | null;
}

/** The two sides of an LFS pointer change; either is null for an add/delete. */
export interface LfsDiff {
  old: LfsPointer | null;
  new: LfsPointer | null;
}

/** A parsed LFS pointer file. `oid` carries no `sha256:` prefix. */
export interface LfsPointer {
  oid: string;
  size: number;
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

/**
 * Current HEAD identity, refreshed on every `refreshAll` (#217) — unlike
 * `RepoHandle.head`, which `open_repo` sets once and goes stale after a
 * checkout. `branch` is `null` on a detached HEAD; `headOid` is `null` only
 * on an unborn branch (a fresh `git init` with no commits).
 */
export interface HeadInfo {
  branch: string | null;
  headOid: string | null;
}

export interface ConflictSides {
  path: string;
  base: string | null;
  ours: string | null;
  theirs: string | null;
  binary: boolean;
}

// ─── Interactive rebase ───────────────────────────────────────────────────────

export type RebaseAction =
  | "Pick"
  | "Reword"
  | "Edit"
  | "Squash"
  | "Fixup"
  | "Drop"
  /** A merge commit kept as one ordinary commit — `git cherry-pick -m 1`. */
  | "MainlinePick"
  /** A merge commit recreated from its rewritten parents (`--rebase-merges`). */
  | "Merge";

export interface RebaseStep {
  oid: string;
  action: RebaseAction;
  message: string | null;
  /**
   * Original oid this step is applied onto; omitted/null = onto the previous
   * step's result (the linear default). How a plan expresses topology without
   * git's label/reset todo language.
   */
  onto?: string | null;
  /** A merge step's original parents beyond the first. */
  mergeParents?: string[];
}

/**
 * What a rebase that ran to completion did, retained by the BACKEND after the
 * rebase state itself is swept.
 *
 * The frontend used to cache the final status for the "N steps completed" line,
 * which made every abort and start path responsible for clearing that cache
 * (#47). Now `rebase_status` keeps reporting it until `rebaseAcknowledge`, and
 * starting or aborting a rebase drops it in the engine.
 */
export interface RebaseSummary {
  /** Steps the completed plan contained. */
  total: number;
  /** Steps that ran, drops included. Equal to `total` for a finished plan. */
  completed: number;
}

export interface RebaseStatus {
  inProgress: boolean;
  nextIndex: number;
  total: number;
  pauseReason: string | null;
  /**
   * The most recently completed rebase, until acknowledged. Always absent while
   * `inProgress` is true. Optional only so the many `RebaseStatus` fixtures in
   * tests need not restate it; `rebase_status` always sends it.
   */
  lastCompleted?: RebaseSummary | null;
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

/**
 * Who owns the `pgit` on the user's PATH (#144) — mirrors Rust
 * `cli::CliShimSource`. `package` is the contract that matters: a shim shipped
 * by Homebrew, dpkg or the MSI counts as installed and is never overwritten.
 */
export type CliShimSource = "none" | "app" | "package" | "foreign";

/**
 * Whether the shim's directory is reachable — mirrors `cli::CliPathState`.
 * `pathAdded` is produced only by an install (the persistent PATH was just
 * written, so already-open shells still need a restart), never by a status read.
 */
export type CliPathState = "onPath" | "offPath" | "pathAdded";

export interface CliShimStatus {
  /** `pgit` is present and launches this app — i.e. source is app or package. */
  installed: boolean;
  /** Where it is, or (with none found) where an install would put one. */
  shimPath: string;
  target: string;
  source: CliShimSource;
  pathState: CliPathState;
}

/**
 * Where the app's log lives and what machine wrote it (#274).
 *
 * 1:1 with `DiagnosticsReport` in `src-tauri/src/commands/diagnostics.rs`.
 */
export interface DiagnosticsReport {
  /** Absolute path to the current log file. */
  logPath: string;
  /** Whether that file exists yet — a fresh install may not have flushed. */
  logExists: boolean;
  /** Size in bytes, `null` when the file is absent. */
  logSizeBytes: number | null;
  /** The `host os=… wsl=… git=…` line, so the panel can show it unread. */
  environment: string;
  /** The running version, so a pasted report identifies its build. */
  version: string;
}

export interface CliInstallOutcome {
  installed: boolean;
  path: string;
  manualCommand: string | null;
  pathState: CliPathState;
}

export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion: string;
  notes: string;
  releaseUrl: string;
  publishedAt: string;
}

/**
 * Mirrors Rust `UpdateCapability` (update.rs). `notify-apt` is a `.deb` install
 * that came from the platypusgit apt repository, so `apt upgrade` is the right
 * advice; plain `notify` on Linux is a sideloaded `.deb`, where that command
 * would report "already the newest version" and dead-end the user.
 *
 * `notify-scoop` is a Windows install that came from the Scoop bucket (#187).
 * Windows is `self-update` everywhere else, and this variant exists because
 * self-updating a Scoop install would run the per-machine `.msi` and leave the
 * machine with two copies of the app — see the Rust enum for the full story.
 */
export type UpdateCapability =
  | "self-update"
  | "notify"
  | "notify-apt"
  | "notify-scoop";

/**
 * "Commit as" identity. Mirrors Rust `AuthorOverride` (git/types.rs) — it sets
 * the commit's AUTHOR only; the committer stays the repo config identity, the
 * same split `git commit --author` uses.
 */
export interface AuthorOverride {
  name: string;
  email: string;
}

/** One tick of `clone://progress`. Mirrors `CloneProgress` in types.rs. */
export interface CloneProgress {
  phase: string;
  percent: number;
}

// ── Forge integration (#92) ──────────────────────────────────────────────────
// Mirrors `src-tauri/src/forge/mod.rs`. A forge token NEVER appears in any of
// these: `forge_sign_in` takes one and returns an identity, and nothing hands
// one back out.

/** Which forge API dialect to speak. Mirrors Rust `ForgeKind`. */
export type ForgeKind = "GitHub" | "GitLab";

/** A repository on a forge whose kind is known — what every API call needs. */
export interface ForgeRepo {
  /** Lowercased host; may carry `:port` for a self-hosted HTTPS instance. */
  host: string;
  /** Owner / namespace. May contain `/` for a GitLab subgroup. */
  owner: string;
  name: string;
  kind: ForgeKind;
}

/**
 * What the repository's remotes point at. `kind` is null for a self-hosted host
 * we cannot classify from its URL — a prompt ("which forge is this?"), not a
 * failure. No detection at all (`null` from `forgeDetect`) means no parseable
 * remote.
 */
export interface ForgeDetection {
  /** Which remote it came from, so a checkout fetches from the same one. */
  remote: string;
  host: string;
  owner: string;
  name: string;
  kind: ForgeKind | null;
}

export interface PullRequest {
  /** GitHub's `number` / GitLab's `iid` — also what the head ref is keyed by. */
  number: number;
  title: string;
  author: string;
  sourceBranch: string;
  targetBranch: string;
  /** The forge's web page. Always opened through `openUrl`, which re-validates. */
  url: string;
  draft: boolean;
  /** Source branch lives in a fork, so its name must not be reused locally. */
  crossRepo: boolean;
  sha: string | null;
  updatedAt: string;
}

/** Normalised CI verdict, so one tone mapping covers both forges. */
export type ChecksState = "Success" | "Pending" | "Failure" | "None";

export interface ChecksSummary {
  state: ChecksState;
  total: number;
  /** The forge's own word (`"success"`, `"running"`, …) for display. */
  label: string;
}

export interface NewPullRequest {
  title: string;
  body: string;
  sourceBranch: string;
  targetBranch: string;
  draft: boolean;
}

/** Who a stored token authenticates as. */
export interface ForgeIdentity {
  login: string;
  name: string | null;
}

/** Whether a host has a token, and who it belongs to. Never the token. */
export interface ForgeTokenStatus {
  host: string;
  signedIn: boolean;
  /** Only set by a fresh identity probe; a presence check leaves it null. */
  login: string | null;
}

/** Everything `forgeCheckoutPullRequest` needs, as one argument. */
export interface ForgeCheckoutRequest {
  repoId: string;
  remoteName: string;
  kind: ForgeKind;
  number: number;
  localBranch: string;
  /** The caller confirmed overwriting an existing local branch. */
  force: boolean;
}

// ─── Submodules (#93) ─────────────────────────────────────────────────────────

/**
 * Mirrors Rust `SubmoduleState`. Derived in priority order: uninitialized
 * outranks everything, then a pointer mismatch, then dirt inside the submodule.
 */
export type SubmoduleState =
  /** Declared in `.gitmodules`, never checked out. */
  | "Uninitialized"
  /** At the recorded commit and clean. */
  | "UpToDate"
  /** Right commit, dirty inside. */
  | "Modified"
  /** Checked-out commit differs from the recorded gitlink. */
  | "OutOfSync";

export interface SubmoduleInfo {
  name: string;
  path: string;
  url: string | null;
  branch: string | null;
  /** The gitlink the superproject records. */
  headOid: string | null;
  /** The commit checked out in the submodule; null when uninitialized. */
  workdirOid: string | null;
  state: SubmoduleState;
}

// ─── Linked worktrees (#93) ───────────────────────────────────────────────────

export interface WorktreeInfo {
  name: string;
  path: string;
  branch: string | null;
  headOid: string | null;
  locked: boolean;
  lockReason: string | null;
  prunable: boolean;
  /** True for the worktree the app currently has open. */
  isCurrent: boolean;
}

/** Mirrors Rust `WorktreeBranch` (`#[serde(tag = "kind", content = "name")]`). */
export type WorktreeBranch =
  | { kind: "new"; name: string }
  | { kind: "existing"; name: string };

// ─── git-LFS (#93) ────────────────────────────────────────────────────────────

export interface LfsStatus {
  /** `git lfs version` ran. `false` is a STATE — disable, don't error. */
  installed: boolean;
  version: string | null;
  /** The repo declares `filter=lfs`, answerable with the binary missing. */
  inUse: boolean;
  patterns: string[];
  /** LFS paths in the worktree; empty when the binary is missing. */
  files: LfsFile[];
}

export interface LfsFile {
  path: string;
  oid: string;
  /** True when the real object is in the worktree, false when still a pointer. */
  materialized: boolean;
}

// ─── Bisect (#93) ─────────────────────────────────────────────────────────────

export type BisectMark = "Good" | "Bad" | "Skip";

/**
 * A bisect in progress, read from GIT's own `.git/BISECT_*` state — there is no
 * parallel state file, so this survives a restart and picks up a bisect started
 * in a terminal. Mirrors Rust `BisectStatus`.
 */
export interface BisectStatus {
  inProgress: boolean;
  /** Where `git bisect reset` returns to. */
  startRef: string | null;
  /** "bad"/"good" unless the bisect was started with custom terms. */
  badTerm: string;
  goodTerm: string;
  currentOid: string | null;
  /** git's own `bisect_nr`: revisions left after this one. */
  remaining: number | null;
  /** git's own `bisect_steps` estimate. */
  steps: number | null;
  /** Set once the search converges. HEAD is NOT on this commit. */
  firstBadOid: string | null;
  goodCount: number;
  badCount: number;
  skippedCount: number;
}

/**
 * What a commit produced (#232).
 *
 * The message comes back because `commit-msg` may **rewrite** it, so what
 * landed is not necessarily what the user typed — and a panel that keeps showing
 * the typed version is lying about the repository.
 */
export interface CommitResult {
  oid: string;
  message: string;
}
