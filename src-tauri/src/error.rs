use serde::Serialize;

#[derive(Debug, thiserror::Error, Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum AppError {
    #[error("path is not a git repository: {0}")]
    NotARepo(String),

    #[error("repository not found: {0}")]
    UnknownRepo(String),

    #[error("invalid path: {0}")]
    InvalidPath(String),

    #[error("invalid url: {0}")]
    InvalidUrl(String),

    #[error("io error: {0}")]
    Io(String),

    #[error("git error: {0}")]
    Git(String),

    #[error("not implemented")]
    NotImplemented,

    #[error("repository has no HEAD yet")]
    Unborn,

    #[error("invalid reference: {0}")]
    InvalidRef(String),

    #[error("invalid argument: {0}")]
    InvalidArgument(String),

    #[error("worktree is dirty: {0}")]
    DirtyWorktree(String),

    #[error("branch not fully merged: {0}")]
    NotMerged(String),

    #[error("operation produced conflicts: {0}")]
    ConflictsDetected(String),

    #[error("no signature configured (set user.name and user.email)")]
    NoSignature,

    #[error("internal error: {0}")]
    Internal(String),

    #[error("network error: {0}")]
    Network(String),

    /// The remote needs credentials we did not supply. Distinct from `Network`
    /// so the UI can prompt and retry rather than just reporting a failure.
    /// Never carries the credential itself, and never git's raw stderr (#61 D5).
    #[error("authentication required")]
    Auth(crate::git::auth::AuthChallenge),

    #[error("embedded repository: {0}")]
    EmbeddedRepo(String),

    /// libgit2 refused to open a repository because its working directory is
    /// owned by a different user (`GIT_EOWNER`, git's CVE-2022-24765 check).
    /// Carries the canonicalised path, which is the exact string a
    /// `safe.directory` exception has to contain.
    #[error("repository is owned by another user: {0}")]
    DubiousOwnership(String),

    /// A rebase plan the engine cannot execute — a merge commit carrying an
    /// action that has no meaning for it, a duplicate or unknown oid, a plan
    /// that drops everything. Raised by `rebase_plan::validate` *before*
    /// `rebase_start` moves anything, so the repository is untouched when the
    /// frontend shows it.
    #[error("invalid rebase plan: {0}")]
    InvalidRebasePlan(String),

    /// A forge (GitHub / GitLab) API call failed in a way we can describe
    /// (#92). The message has been through `scrub_credentials` AND
    /// `forge::token::redact`, so it never carries a token or a URL's userinfo.
    #[error("forge error: {0}")]
    Forge(String),

    /// The forge API rejected our token (401/403). Carries the HOST, not the
    /// token. Deliberately NOT `Auth`: `Auth` means "git needs a credential for
    /// this remote, prompt and retry", and raising it here would pop the
    /// transport-credential dialog for a problem only Settings can fix.
    #[error("forge authentication required for {0}")]
    ForgeAuth(String),

    /// A forge token did not survive the `git credential approve` → `fill`
    /// round trip — almost always "no credential helper is configured". Carries
    /// the remedy, never the token.
    #[error("could not store the forge token: {0}")]
    ForgeTokenStore(String),

    /// A branch that would have to be overwritten already exists locally.
    /// Raised by the PR-checkout path before it touches any ref, so the caller
    /// can confirm and retry with `force`.
    #[error("branch already exists: {0}")]
    BranchExists(String),

    /// The stash entry at the index an op was given is no longer the entry the
    /// caller selected (#133). Carries the label (`stash@{1}`), not prose.
    ///
    /// A stash index is a position in the `refs/stash` reflog, so ANY write to
    /// that ref shifts it — another window, a `DirtyTreeDialog` auto-stash, a
    /// second click. Every destructive stash op therefore re-reads the entry
    /// under the SAME lock it drops from and raises this rather than deleting
    /// whatever moved into the slot. Distinct from `Git` because it is
    /// recoverable and the remedy is specific: refresh and pick again.
    #[error("stash entry moved: {0}")]
    StaleStash(String),

    /// The `git-lfs` binary is missing or not runnable (#93). A **state**, not a
    /// failure: the UI disables the LFS actions and says why. Distinct from
    /// `Git`/`Network` precisely so git's `'lfs' is not a git command` can never
    /// reach an error banner.
    #[error("git-lfs is not available: {0}")]
    LfsUnavailable(String),

    /// An op that requires a bisect in progress found none (#93). Distinct from
    /// `Git` because the usual cause is benign — another process reset the
    /// bisect — so the UI refreshes rather than alarms.
    #[error("no bisect in progress")]
    NoBisect,

    /// A git hook ran and refused (#232).
    ///
    /// Carries the hook's NAME and its OUTPUT as separate fields rather than one
    /// formatted sentence: the output is the whole point of the feature and has
    /// to render *as output* — monospace, scrollable, forty lines of eslint —
    /// not pasted into a one-line banner.
    ///
    /// Distinct from `Io`, which is a hook we could not *launch*: that is a
    /// broken environment, not a policy decision by the repository. And distinct
    /// from no error at all, which is what an absent hook produces.
    #[error("the {} hook rejected this commit", .0.hook)]
    HookRejected(HookRejection),

    /// The user stopped a long-running operation (#234).
    ///
    /// A **state**, not a failure: the user already knows what happened, so no
    /// surface may raise a banner for it — see `isCancelledError` in
    /// `src/lib/errors.ts` and the catch arms in `useRepoStore`.
    ///
    /// Distinct from `Network` because that is what a killed git would otherwise
    /// classify as: cancel kills the child, git dies mid-transfer, and its last
    /// stderr line reads like a broken connection. Every cancellable op
    /// therefore checks the cancel flag BEFORE `map_git_failure` ever sees that
    /// line — which also keeps a dying remote from popping the credential dialog
    /// over a cancel.
    #[error("operation cancelled")]
    Cancelled,
}

/// A hook's refusal (#232). `output` is whatever the hook printed, verbatim —
/// stdout and stderr both, as git delivers them.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookRejection {
    pub hook: String,
    pub output: String,
}

impl From<git2::Error> for AppError {
    fn from(e: git2::Error) -> Self {
        AppError::Git(e.message().to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
