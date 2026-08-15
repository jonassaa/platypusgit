//! GitLab REST v4 dialect (#92). URL builders + response parsers only.
//!
//! Three shape differences from GitHub worth naming, because each one is a place
//! a naive port would be silently wrong:
//!
//! * A project is addressed by its **URL-encoded full path** (`group%2Fsub%2Frepo`),
//!   not by two path segments — so the whole `owner/name` pair is one encoded
//!   segment.
//! * The MR-create API has **no `draft` parameter**. Draft is expressed by a
//!   `Draft: ` title prefix.
//! * The MR list carries no pipeline, so CI status comes from the pipelines
//!   endpoint filtered by sha.

use serde_json::json;

use super::{
    encode_segment, json_of, opt_str_field, str_field, validate_host, validate_sha, ChecksState,
    ChecksSummary, Forge, ForgeIdentity, ForgeKind, ForgeRepo, NewPullRequest, PullRequest,
};
use crate::error::{AppError, AppResult};
use crate::forge::token::Secret;

pub struct GitLab;

const PER_PAGE: u32 = 50;

/// The `Draft: ` prefix GitLab uses in place of a create-time draft flag.
pub const DRAFT_PREFIX: &str = "Draft: ";

/// API base for `host`. GitLab.com and self-hosted are the same shape; a
/// non-standard HTTPS port is preserved by the remote parser and belongs here.
pub fn api_base(host: &str) -> AppResult<String> {
    validate_host(host)?;
    Ok(format!("https://{host}/api/v4"))
}

/// GitLab's `:id` — the project's full path, percent-encoded whole (the `/`
/// between namespace segments included).
fn project_id(repo: &ForgeRepo) -> String {
    encode_segment(&format!("{}/{}", repo.owner, repo.name))
}

/// Draft state for a title, tolerating an older instance that only reports the
/// prefix and a newer one that also sets `draft`/`work_in_progress`.
fn draft_of(v: &serde_json::Value, title: &str) -> bool {
    v.get("draft")
        .and_then(|d| d.as_bool())
        .or_else(|| v.get("work_in_progress").and_then(|d| d.as_bool()))
        .unwrap_or_else(|| title.starts_with(DRAFT_PREFIX) || title.starts_with("WIP: "))
}

fn merge_request_of(v: &serde_json::Value) -> Option<PullRequest> {
    // `iid` is the per-project number users see and the one the head ref is
    // keyed by; `id` is the instance-wide id and must NOT be used here.
    let number = v.get("iid").and_then(|n| n.as_u64())?;
    let title = str_field(v, "title");
    let source_project = v.get("source_project_id").and_then(|n| n.as_u64());
    let target_project = v.get("target_project_id").and_then(|n| n.as_u64());
    let cross_repo = match (source_project, target_project) {
        (Some(s), Some(t)) => s != t,
        // Unknown provenance: assume a fork, so the checkout does not reuse the
        // branch name.
        _ => true,
    };
    Some(PullRequest {
        number,
        draft: draft_of(v, &title),
        title,
        author: v
            .get("author")
            .map(|a| str_field(a, "username"))
            .unwrap_or_default(),
        source_branch: str_field(v, "source_branch"),
        target_branch: str_field(v, "target_branch"),
        url: str_field(v, "web_url"),
        cross_repo,
        sha: opt_str_field(v, "sha"),
        updated_at: str_field(v, "updated_at"),
    })
}

impl Forge for GitLab {
    fn kind(&self) -> ForgeKind {
        ForgeKind::GitLab
    }

    fn auth_header(&self) -> &'static str {
        // A personal/project access token goes in PRIVATE-TOKEN; Authorization:
        // Bearer is for OAuth tokens only, and GitLab rejects a PAT there.
        "PRIVATE-TOKEN"
    }

    fn auth_value(&self, token: &Secret) -> String {
        token.expose().to_string()
    }

    fn identity_url(&self, host: &str) -> AppResult<String> {
        Ok(format!("{}/user", api_base(host)?))
    }

    fn parse_identity(&self, json: &str) -> AppResult<ForgeIdentity> {
        let v = json_of(json)?;
        let login = opt_str_field(&v, "username")
            .ok_or_else(|| AppError::Forge("the forge did not return a username".into()))?;
        Ok(ForgeIdentity {
            login,
            name: opt_str_field(&v, "name"),
        })
    }

    fn list_url(&self, repo: &ForgeRepo) -> AppResult<String> {
        Ok(format!(
            "{}/projects/{}/merge_requests?state=opened&per_page={PER_PAGE}&order_by=updated_at&sort=desc",
            api_base(&repo.host)?,
            project_id(repo)
        ))
    }

    fn parse_list(&self, json: &str) -> AppResult<Vec<PullRequest>> {
        let v = json_of(json)?;
        let arr = v
            .as_array()
            .ok_or_else(|| AppError::Forge("expected a list of merge requests".into()))?;
        Ok(arr.iter().filter_map(merge_request_of).collect())
    }

    fn checks_url(&self, repo: &ForgeRepo, sha: &str) -> AppResult<String> {
        validate_sha(sha)?;
        Ok(format!(
            "{}/projects/{}/pipelines?sha={}&per_page=1",
            api_base(&repo.host)?,
            project_id(repo),
            sha
        ))
    }

    fn parse_checks(&self, json: &str) -> AppResult<ChecksSummary> {
        let v = json_of(json)?;
        let arr = v
            .as_array()
            .ok_or_else(|| AppError::Forge("expected a list of pipelines".into()))?;
        let Some(first) = arr.first() else {
            // No pipeline ran for this commit — a real state, not a failure.
            return Ok(ChecksSummary {
                state: ChecksState::None,
                total: 0,
                label: "no pipeline".to_string(),
            });
        };
        let raw = str_field(first, "status");
        let state = match raw.as_str() {
            "success" | "manual" => ChecksState::Success,
            "created" | "waiting_for_resource" | "preparing" | "pending" | "running"
            | "scheduled" => ChecksState::Pending,
            "failed" => ChecksState::Failure,
            // canceled / skipped: not a pass and not a failure.
            _ => ChecksState::None,
        };
        Ok(ChecksSummary {
            state,
            total: 1,
            label: if raw.is_empty() {
                "no pipeline".to_string()
            } else {
                raw
            },
        })
    }

    fn create_url(&self, repo: &ForgeRepo) -> AppResult<String> {
        Ok(format!(
            "{}/projects/{}/merge_requests",
            api_base(&repo.host)?,
            project_id(repo)
        ))
    }

    fn create_body(&self, req: &NewPullRequest) -> serde_json::Value {
        // GitLab's create API has no `draft` field: the prefix IS the flag. Don't
        // double-prefix a title the user already typed it into.
        let title = if req.draft && !req.title.starts_with(DRAFT_PREFIX) {
            format!("{DRAFT_PREFIX}{}", req.title)
        } else {
            req.title.clone()
        };
        json!({
            "title": title,
            "description": req.body,
            "source_branch": req.source_branch,
            "target_branch": req.target_branch,
        })
    }

    fn parse_created(&self, json: &str) -> AppResult<PullRequest> {
        let v = json_of(json)?;
        merge_request_of(&v)
            .ok_or_else(|| AppError::Forge("the forge did not describe the new merge request".into()))
    }

    fn head_ref(&self, number: u64) -> String {
        format!("refs/merge-requests/{number}/head")
    }
}
