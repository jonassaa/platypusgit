//! GitHub REST v3 dialect (#92). URL builders + response parsers only — see the
//! module docs in `forge/mod.rs` for why nothing here touches the network.

use serde_json::json;

use super::{
    encode_segment, json_of, opt_str_field, str_field, validate_host, validate_sha, ChecksState,
    ChecksSummary, Forge, ForgeIdentity, ForgeKind, ForgeRepo, NewPullRequest, PullRequest,
};
use crate::error::{AppError, AppResult};
use crate::forge::token::Secret;

pub struct GitHub;

/// How many requests to ask for in one page. The list is "what is open right
/// now", not an archive; 50 covers every repository anyone reviews by hand and
/// keeps us to one request.
const PER_PAGE: u32 = 50;

/// API base for `host`.
///
/// github.com's API lives on a different host (`api.github.com`); GitHub
/// Enterprise serves it from the same host under `/api/v3`.
pub fn api_base(host: &str) -> AppResult<String> {
    validate_host(host)?;
    if host.eq_ignore_ascii_case("github.com") || host.eq_ignore_ascii_case("www.github.com") {
        return Ok("https://api.github.com".to_string());
    }
    Ok(format!("https://{host}/api/v3"))
}

/// `owner/repo`, each segment percent-encoded so a crafted remote cannot
/// traverse the API path.
fn repo_path(repo: &ForgeRepo) -> String {
    format!(
        "{}/{}",
        encode_segment(&repo.owner),
        encode_segment(&repo.name)
    )
}

/// Pull one PR out of a list/created payload.
fn pull_request_of(v: &serde_json::Value) -> Option<PullRequest> {
    let number = v.get("number").and_then(|n| n.as_u64())?;
    let head = v.get("head");
    let base = v.get("base");
    let head_repo = head
        .and_then(|h| h.get("repo"))
        .and_then(|r| r.get("full_name"))
        .and_then(|n| n.as_str());
    let base_repo = base
        .and_then(|b| b.get("repo"))
        .and_then(|r| r.get("full_name"))
        .and_then(|n| n.as_str());
    // A deleted fork leaves `head.repo` null — treat it as cross-repo so the
    // checkout never reuses the branch name.
    let cross_repo = match (head_repo, base_repo) {
        (Some(h), Some(b)) => h != b,
        _ => true,
    };
    Some(PullRequest {
        number,
        title: str_field(v, "title"),
        author: v
            .get("user")
            .map(|u| str_field(u, "login"))
            .unwrap_or_default(),
        source_branch: head.map(|h| str_field(h, "ref")).unwrap_or_default(),
        target_branch: base.map(|b| str_field(b, "ref")).unwrap_or_default(),
        url: str_field(v, "html_url"),
        draft: v.get("draft").and_then(|d| d.as_bool()).unwrap_or(false),
        cross_repo,
        sha: head.and_then(|h| opt_str_field(h, "sha")),
        updated_at: str_field(v, "updated_at"),
    })
}

impl Forge for GitHub {
    fn kind(&self) -> ForgeKind {
        ForgeKind::GitHub
    }

    fn auth_header(&self) -> &'static str {
        "Authorization"
    }

    fn auth_value(&self, token: &Secret) -> String {
        // One of the two Secret::expose sites (the other writes git's credential
        // protocol). `Bearer` covers both fine-grained and classic PATs.
        format!("Bearer {}", token.expose())
    }

    fn identity_url(&self, host: &str) -> AppResult<String> {
        Ok(format!("{}/user", api_base(host)?))
    }

    fn parse_identity(&self, json: &str) -> AppResult<ForgeIdentity> {
        let v = json_of(json)?;
        let login = opt_str_field(&v, "login")
            .ok_or_else(|| AppError::Forge("the forge did not return a login".into()))?;
        Ok(ForgeIdentity {
            login,
            name: opt_str_field(&v, "name"),
        })
    }

    fn list_url(&self, repo: &ForgeRepo) -> AppResult<String> {
        Ok(format!(
            "{}/repos/{}/pulls?state=open&per_page={PER_PAGE}&sort=updated&direction=desc",
            api_base(&repo.host)?,
            repo_path(repo)
        ))
    }

    fn parse_list(&self, json: &str) -> AppResult<Vec<PullRequest>> {
        let v = json_of(json)?;
        let arr = v
            .as_array()
            .ok_or_else(|| AppError::Forge("expected a list of pull requests".into()))?;
        Ok(arr.iter().filter_map(pull_request_of).collect())
    }

    fn checks_url(&self, repo: &ForgeRepo, sha: &str) -> AppResult<String> {
        validate_sha(sha)?;
        // The combined-status endpoint is one call for the whole commit. The
        // check-runs API is richer but needs a second request per PR, which is
        // why per-row CI status is deliberately not in the list (see the spec).
        Ok(format!(
            "{}/repos/{}/commits/{}/status",
            api_base(&repo.host)?,
            repo_path(repo),
            sha
        ))
    }

    fn parse_checks(&self, json: &str) -> AppResult<ChecksSummary> {
        let v = json_of(json)?;
        let raw = str_field(&v, "state");
        let total = v
            .get("total_count")
            .and_then(|t| t.as_u64())
            .unwrap_or(0);
        let state = match raw.as_str() {
            "success" => ChecksState::Success,
            "pending" => {
                // GitHub reports "pending" both for "running" and for "no
                // statuses at all"; total_count tells them apart.
                if total == 0 {
                    ChecksState::None
                } else {
                    ChecksState::Pending
                }
            }
            "failure" | "error" => ChecksState::Failure,
            _ => ChecksState::None,
        };
        Ok(ChecksSummary {
            state,
            total,
            label: if raw.is_empty() {
                "no checks".to_string()
            } else {
                raw
            },
        })
    }

    fn create_url(&self, repo: &ForgeRepo) -> AppResult<String> {
        Ok(format!(
            "{}/repos/{}/pulls",
            api_base(&repo.host)?,
            repo_path(repo)
        ))
    }

    fn create_body(&self, req: &NewPullRequest) -> serde_json::Value {
        json!({
            "title": req.title,
            "body": req.body,
            "head": req.source_branch,
            "base": req.target_branch,
            "draft": req.draft,
        })
    }

    fn parse_created(&self, json: &str) -> AppResult<PullRequest> {
        let v = json_of(json)?;
        pull_request_of(&v)
            .ok_or_else(|| AppError::Forge("the forge did not describe the new pull request".into()))
    }

    fn head_ref(&self, number: u64) -> String {
        // GitHub synthesises this on the BASE repository for every open PR, fork
        // PRs included — which is why checkout never needs the fork's URL.
        format!("refs/pull/{number}/head")
    }
}
