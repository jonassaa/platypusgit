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
