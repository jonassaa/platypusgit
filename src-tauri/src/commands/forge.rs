//! Forge (GitHub / GitLab) commands (#92) — thin handlers over `crate::forge`.
//!
//! Two rules this file exists to enforce:
//!
//! 1. **A token never crosses IPC outward.** `forge_sign_in` takes one and
//!    returns an identity; `forge_token_status` reports presence. There is no
//!    command that reads a token out.
//! 2. **Every blocking `ureq` call is wrapped in `spawn_blocking`**, like every
//!    libgit2 call, so an API round trip cannot block the async runtime.
//!
//! Every token-using command also takes an `account` slot (#233): a host can
//! hold several accounts, and the caller says which one this call is for.
//! Absent / `null` is the pre-#233 slot — the one an already-signed-in user's
//! token is stored under — so an old caller keeps working unchanged.

use std::collections::HashMap;
use std::sync::Mutex;

use tauri::State;

use crate::{
    commands::net::{run_git_authenticated, Credentials},
    error::{AppError, AppResult},
    forge::{
        checkout, forge_for, remote,
        token::{self, redact, Secret},
        ChecksSummary, ForgeDetection, ForgeIdentity, ForgeKind, ForgeRepo, ForgeTokenStatus,
        NewPullRequest, PullRequest,
    },
    git::types::RepoId,
    state::AppState,
};

/// Cache key: one forge host plus the account slot within it (#233).
///
/// Keyed by the FORGE host as the user typed it (`github.com`), not by the
/// namespaced credential host — the namespacing is `forge::token`'s business.
/// `None` is the pre-#233 slot; two accounts on one host are two entries, so a
/// refresh for the work account can never hand back the personal token.
type TokenKey = (String, Option<String>);

fn token_key(host: &str, account: Option<&str>) -> TokenKey {
    (host.to_string(), account.map(str::to_string))
}

/// Per-account token cache, so a list refresh does not shell out to
/// `git credential fill` on every call.
#[derive(Default)]
pub struct ForgeTokens(pub Mutex<HashMap<TokenKey, Secret>>);

impl ForgeTokens {
    fn get(&self, host: &str, account: Option<&str>) -> Option<Secret> {
        self.0.lock().ok()?.get(&token_key(host, account)).cloned()
    }

    fn put(&self, host: &str, account: Option<&str>, token: Secret) {
        if let Ok(mut map) = self.0.lock() {
            map.insert(token_key(host, account), token);
        }
    }

    /// Forget ONE slot. Signing out of the work account must leave the personal
    /// account on the same host signed in.
    fn forget(&self, host: &str, account: Option<&str>) {
        if let Ok(mut map) = self.0.lock() {
            map.remove(&token_key(host, account));
        }
    }
}

/// The token for one account on `host`, from memory or from the credential
/// helper.
///
/// "Not signed in" is `ForgeAuth`, the same error a rejected token produces, so
/// the frontend has exactly one shape to route to Settings.
async fn token_for(
    tokens: &ForgeTokens,
    host: &str,
    account: Option<&str>,
) -> AppResult<Secret> {
    if let Some(t) = tokens.get(host, account) {
        return Ok(t);
    }
    match token::load_token(host, account).await? {
        Some(t) => {
            tokens.put(host, account, t.clone());
            Ok(t)
        }
        None => Err(AppError::ForgeAuth(host.to_string())),
    }
}

/// Run one blocking forge call on the blocking pool, redacting the token out of
/// whatever error comes back and naming the FORGE host in an auth failure.
///
/// The redaction is belt and braces — `Secret` has no `Display` and no
/// `Serialize`, so a token cannot reach an error by accident — but a forge that
/// echoes the token inside an error body would otherwise put it in a banner and
/// the log file, which is exactly one of the three bug shapes the #61 D5 review
/// found.
///
/// `ForgeAuth` is rewritten to `host` because `forge::http` only knows the API
/// host it called: for github.com that is `api.github.com`, which is not the host
/// the user signs in to and not the key the frontend's account map uses.
async fn blocking_forge<T, F>(host: String, token: Secret, f: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce(&Secret) -> AppResult<T> + Send + 'static,
{
    tokio::task::spawn_blocking(move || match f(&token) {
        Ok(v) => Ok(v),
        Err(AppError::Forge(msg)) => Err(AppError::Forge(redact(&msg, &token))),
        Err(AppError::Network(msg)) => Err(AppError::Network(redact(&msg, &token))),
        Err(AppError::ForgeAuth(_)) => Err(AppError::ForgeAuth(host)),
        Err(other) => Err(other),
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

/// What forge, if any, this repository's remotes point at.
///
/// `host_kinds` is the user's per-host mapping for self-hosted instances. A
/// repository with no parseable remote resolves to `null` — the UI renders that
/// as a disabled state, never as an error banner.
#[tauri::command]
pub async fn forge_detect(
    state: State<'_, AppState>,
    repo_id: String,
    host_kinds: HashMap<String, ForgeKind>,
) -> AppResult<Option<ForgeDetection>> {
    let backend = state.backend.clone();
    let id = RepoId(repo_id);
    let remotes = tokio::task::spawn_blocking(move || backend.remotes(&id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))??;
    Ok(remote::detect(&remotes, &host_kinds))
}

/// Validate a token against the forge, then store it in one account slot.
///
/// Validation FIRST, deliberately: storing on submit would persist a typo into
/// the user's keychain and then fail every later call with a stale secret.
///
/// `account` names the slot (#233). Absent / `null` is the pre-#233 slot, which
/// is what an already-signed-in user's token is stored under; a second account
/// on the same host arrives with an id the frontend minted, so neither token
/// overwrites the other.
#[tauri::command]
pub async fn forge_sign_in(
    tokens: State<'_, ForgeTokens>,
    host: String,
    kind: ForgeKind,
    token: String,
    account: Option<String>,
) -> AppResult<ForgeIdentity> {
    let secret = Secret::new(token);
    if secret.is_empty() {
        return Err(AppError::InvalidArgument("the token is empty".into()));
    }
    let forge = forge_for(kind);
    let url = forge.identity_url(&host)?;

    let identity = blocking_forge(host.clone(), secret.clone(), move |t| {
        let forge = forge_for(kind);
        let body =
            crate::forge::http::get_json(&url, (forge.auth_header(), &forge.auth_value(t)))?;
        forge.parse_identity(&body)
    })
    .await?;

    // Cache before storing: if the helper is missing, the session still works and
    // `store_token`'s error explains why it will not survive a restart.
    let slot = account.as_deref();
    tokens.put(&host, slot, secret.clone());
    token::store_token(&host, slot, &secret).await?;
    Ok(identity)
}

/// Whether one account slot on `host` has a token. No network call — Settings
/// renders often.
#[tauri::command]
pub async fn forge_token_status(
    tokens: State<'_, ForgeTokens>,
    host: String,
    account: Option<String>,
) -> AppResult<ForgeTokenStatus> {
    let slot = account.as_deref();
    let signed_in = if tokens.get(&host, slot).is_some() {
        true
    } else {
        match token::load_token(&host, slot).await? {
            Some(t) => {
                tokens.put(&host, slot, t);
                true
            }
            None => false,
        }
    };
    Ok(ForgeTokenStatus {
        host,
        signed_in,
        login: None,
    })
}

/// Re-probe the stored token and report who it belongs to.
#[tauri::command]
pub async fn forge_validate_token(
    tokens: State<'_, ForgeTokens>,
    host: String,
    kind: ForgeKind,
    account: Option<String>,
) -> AppResult<ForgeIdentity> {
    let secret = token_for(&tokens, &host, account.as_deref()).await?;
    let url = forge_for(kind).identity_url(&host)?;
    blocking_forge(host.clone(), secret, move |t| {
        let forge = forge_for(kind);
        let body =
            crate::forge::http::get_json(&url, (forge.auth_header(), &forge.auth_value(t)))?;
        forge.parse_identity(&body)
    })
    .await
}

/// Forget the token in ONE of `host`'s account slots (#233).
///
/// Per-account on purpose: the other account on the same host keeps its token,
/// in the cache and in the credential helper.
#[tauri::command]
pub async fn forge_sign_out(
    tokens: State<'_, ForgeTokens>,
    host: String,
    account: Option<String>,
) -> AppResult<()> {
    let slot = account.as_deref();
    tokens.forget(&host, slot);
    token::erase_token(&host, slot).await
}

/// Open pull requests / merge requests for `forge`.
#[tauri::command]
pub async fn forge_list_pull_requests(
    tokens: State<'_, ForgeTokens>,
    forge: ForgeRepo,
    account: Option<String>,
) -> AppResult<Vec<PullRequest>> {
    let secret = token_for(&tokens, &forge.host, account.as_deref()).await?;
    let kind = forge.kind;
    let url = forge_for(kind).list_url(&forge)?;
    blocking_forge(forge.host.clone(), secret, move |t| {
        let f = forge_for(kind);
        let body = crate::forge::http::get_json(&url, (f.auth_header(), &f.auth_value(t)))?;
        f.parse_list(&body)
    })
    .await
}

/// CI verdict for one commit. Separate command, called for the selected request
/// only: GitHub's PR list carries no status, so a per-row column would cost one
/// request per row on every refresh.
#[tauri::command]
pub async fn forge_pull_request_checks(
    tokens: State<'_, ForgeTokens>,
    forge: ForgeRepo,
    sha: String,
    account: Option<String>,
) -> AppResult<ChecksSummary> {
    let secret = token_for(&tokens, &forge.host, account.as_deref()).await?;
    let kind = forge.kind;
    let url = forge_for(kind).checks_url(&forge, &sha)?;
    blocking_forge(forge.host.clone(), secret, move |t| {
        let f = forge_for(kind);
        let body = crate::forge::http::get_json(&url, (f.auth_header(), &f.auth_value(t)))?;
        f.parse_checks(&body)
    })
    .await
}

/// Create a pull request / merge request, resolving with the created object (its
/// `url` is what the UI surfaces).
#[tauri::command]
pub async fn forge_create_pull_request(
    tokens: State<'_, ForgeTokens>,
    forge: ForgeRepo,
    request: NewPullRequest,
    account: Option<String>,
) -> AppResult<PullRequest> {
    if request.title.trim().is_empty() {
        return Err(AppError::InvalidArgument("a title is required".into()));
    }
    if request.source_branch == request.target_branch {
        return Err(AppError::InvalidArgument(
            "the source and target branch are the same".into(),
        ));
    }
    let secret = token_for(&tokens, &forge.host, account.as_deref()).await?;
    let kind = forge.kind;
    let url = forge_for(kind).create_url(&forge)?;
    let body = forge_for(kind).create_body(&request);
    blocking_forge(forge.host.clone(), secret, move |t| {
        let f = forge_for(kind);
        let out = crate::forge::http::post_json(&url, (f.auth_header(), &f.auth_value(t)), &body)?;
        f.parse_created(&out)
    })
    .await
}

/// Everything `forge_checkout_pull_request` needs, as one argument.
///
/// A struct rather than eight positional parameters: the credential argument has
/// to stay separate (it is the retry path's, not the request's), and eight
/// parameters is also where clippy's `too_many_arguments` starts.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutRequest {
    pub repo_id: String,
    /// Which remote to fetch the synthesised head ref from — the one detection
    /// picked, so it is the repository the PR was opened against.
    pub remote_name: String,
    pub kind: ForgeKind,
    pub number: u64,
    pub local_branch: String,
    /// The caller confirmed overwriting an existing local branch.
    pub force: bool,
}

/// Check out a pull request's head as a local branch.
///
/// # Why this works for a fork
///
/// A fork PR's source branch exists on no remote we have. It is reachable only
/// through the ref the forge synthesises **on the base repository**
/// (`refs/pull/N/head` / `refs/merge-requests/N/head`), so this needs no
/// knowledge of the fork and is identical for same-repo and cross-repo requests.
///
/// # Why two steps
///
/// Fetching straight into `refs/heads/<local>` with a `+` refspec was rejected:
/// git refuses to fetch into the currently checked-out branch, and
/// force-updating a local branch behind the user's back is silent data loss.
/// So the fetch lands in `FETCH_HEAD` (writing no ref at all), and the branch
/// guard is explicit — an existing branch raises `BranchExists` unless the caller
/// opted in, and the frontend gets that opt-in from a `pgConfirm`.
///
/// The fetch itself uses an ordinary git-transport credential via
/// `run_git_authenticated`, so an auth failure surfaces as `AppError::Auth` and
/// the existing credential-retry dialog (#61 D5) drives it. **The forge token is
/// not offered here** — it is a different credential.
#[tauri::command]
pub async fn forge_checkout_pull_request(
    state: State<'_, AppState>,
    request: CheckoutRequest,
    credentials: Option<Credentials>,
) -> AppResult<()> {
    let CheckoutRequest {
        repo_id,
        remote_name,
        kind,
        number,
        local_branch,
        force,
    } = request;
    crate::forge::validate_ref_name(&local_branch)?;
    // A remote name comes from our own remote list, but a leading dash would
    // still be read as an option — the same class of bug as an oid starting with
    // `-` (#61 D5 review, finding 3).
    if remote_name.starts_with('-') || remote_name.trim().is_empty() {
        return Err(AppError::InvalidArgument(format!(
            "invalid remote name: {remote_name:?}"
        )));
    }

    let backend = state.backend.clone();
    let id = RepoId(repo_id);
    let path = {
        let id = id.clone();
        tokio::task::spawn_blocking(move || backend.repo_path(&id))
            .await
            .map_err(|e| AppError::Internal(e.to_string()))??
    };

    let head_ref = forge_for(kind).head_ref(number);
    run_git_authenticated(
        &path,
        &checkout::fetch_args(&remote_name, &head_ref),
        credentials.as_ref(),
    )
    .await?;

    let exists = checkout::branch_exists(&path, &local_branch).await?;
    if exists && !force {
        return Err(AppError::BranchExists(local_branch));
    }

    // No credentials: the tip is already in FETCH_HEAD, so this touches no remote.
    run_git_authenticated(&path, &checkout::checkout_args(&local_branch, exists), None).await
}
