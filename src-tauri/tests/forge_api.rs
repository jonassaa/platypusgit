//! Forge API URL construction and response parsing (#92).
//!
//! **No network.** Every method under test is pure by construction — that is why
//! the `Forge` trait is split into URL builders and parsers instead of exposing
//! `list_pull_requests()`. Payloads are recorded fixtures in `tests/fixtures/`.

use platypusgit_lib::error::AppError;
use platypusgit_lib::forge::{
    encode_segment, forge_for, github, gitlab, validate_host, validate_ref_name, validate_sha,
    ChecksState, ForgeKind, ForgeRepo, NewPullRequest,
};

fn fixture(name: &str) -> String {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name);
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()))
}

fn gh(host: &str, owner: &str, name: &str) -> ForgeRepo {
    ForgeRepo {
        host: host.into(),
        owner: owner.into(),
        name: name.into(),
        kind: ForgeKind::GitHub,
    }
}

fn gl(host: &str, owner: &str, name: &str) -> ForgeRepo {
    ForgeRepo {
        host: host.into(),
        owner: owner.into(),
        name: name.into(),
        kind: ForgeKind::GitLab,
    }
}

// ── API bases ────────────────────────────────────────────────────────────────

#[test]
fn github_api_base_differs_between_dotcom_and_enterprise() {
    // github.com serves its API from a DIFFERENT host; Enterprise serves it from
    // the same host under /api/v3. Getting this backwards 404s everything.
    assert_eq!(github::api_base("github.com").unwrap(), "https://api.github.com");
    assert_eq!(
        github::api_base("ghe.example.com").unwrap(),
        "https://ghe.example.com/api/v3"
    );
}

#[test]
fn gitlab_api_base_is_the_same_shape_everywhere_and_keeps_a_port() {
    assert_eq!(gitlab::api_base("gitlab.com").unwrap(), "https://gitlab.com/api/v4");
    assert_eq!(
        gitlab::api_base("git.example.com:8443").unwrap(),
        "https://git.example.com:8443/api/v4"
    );
}

#[test]
fn api_bases_are_always_https() {
    // The remote may be http://; the API never is.
    for base in [
        github::api_base("ghe.example.com").unwrap(),
        gitlab::api_base("git.example.com").unwrap(),
    ] {
        assert!(base.starts_with("https://"), "{base}");
    }
}

// ── validation (the injection guards) ────────────────────────────────────────

#[test]
fn validate_host_rejects_anything_that_could_rewrite_the_api_path() {
    // The host comes from repository config, which is attacker-controlled for a
    // repository you cloned. Each of these would otherwise smuggle a path, a
    // query, userinfo, or a header break into the request line.
    for host in [
        "",
        "evil.com/api/v4/x",
        "evil.com?x=1",
        "evil.com#frag",
        "user@evil.com",
        "evil com",
        "evil.com:notaport",
        "evil.com:",
        ".evil.com",
        "evil.com.",
        "evil.com\n",
        "evil.com\r\nHost: other",
        "evil.com:8443/x",
    ] {
        let err = validate_host(host).expect_err(&format!("should reject {host:?}"));
        assert!(matches!(err, AppError::InvalidUrl(_)), "{host:?} -> {err:?}");
    }
    // And a 254-character host is refused rather than producing a giant URL.
    assert!(validate_host(&"a".repeat(300)).is_err());
}

#[test]
fn validate_host_accepts_real_hosts() {
    for host in [
        "github.com",
        "gitlab.com",
        "git.example.com",
        "git.example.com:8443",
        "sub-domain.host-1.example",
        "localhost",
    ] {
        validate_host(host).unwrap_or_else(|e| panic!("should accept {host:?}: {e:?}"));
    }
}

#[test]
fn encode_segment_stops_owner_or_name_from_escaping_the_api_path() {
    assert_eq!(encode_segment(".."), "%2E%2E");
    assert_eq!(encode_segment("a/b"), "a%2Fb");
    assert_eq!(encode_segment("a?b=c"), "a%3Fb%3Dc");
    assert_eq!(encode_segment("a#b"), "a%23b");
    assert_eq!(encode_segment("a b"), "a%20b");
    assert_eq!(encode_segment("ok-name_1~x"), "ok-name_1~x");
    // Non-ASCII is percent-encoded per UTF-8 byte.
    assert_eq!(encode_segment("æ"), "%C3%A6");
}

#[test]
fn a_traversing_owner_cannot_reach_another_api_endpoint() {
    // The whole point of encode_segment: the built URL must still address
    // /repos/<encoded>/<encoded>/pulls, not /repos/../../user.
    let url = forge_for(ForgeKind::GitHub)
        .list_url(&gh("github.com", "../..", "x"))
        .unwrap();
    assert!(url.starts_with("https://api.github.com/repos/%2E%2E%2F%2E%2E/x/pulls"), "{url}");
    assert!(!url.contains("/repos/../"), "{url}");

    let url = forge_for(ForgeKind::GitLab)
        .list_url(&gl("gitlab.com", "..", ".."))
        .unwrap();
    assert!(url.starts_with("https://gitlab.com/api/v4/projects/%2E%2E%2F%2E%2E/merge_requests"), "{url}");
}

#[test]
fn validate_sha_only_accepts_hex() {
    // Descendant of the D5 review's third finding — a value with a leading `-`
    // read as a command-line option. Here it would be a path segment.
    for bad in ["", "-abc1234", "../../etc", "zzzzzzz", "abc123", &"a".repeat(65)] {
        assert!(validate_sha(bad).is_err(), "should reject {bad:?}");
    }
    validate_sha("6d15cfe").unwrap();
    validate_sha("6d15cfe2b71a44c9f0e2d1a3b5c7e9f0a1b2c3d4").unwrap();
}

#[test]
fn checks_url_refuses_a_non_hex_sha_before_building_anything() {
    for kind in [ForgeKind::GitHub, ForgeKind::GitLab] {
        let repo = ForgeRepo {
            host: "github.com".into(),
            owner: "o".into(),
            name: "r".into(),
            kind,
        };
        let err = forge_for(kind)
            .checks_url(&repo, "../../../user")
            .expect_err("should refuse");
        assert!(matches!(err, AppError::InvalidArgument(_)), "{err:?}");
    }
}

#[test]
fn validate_ref_name_refuses_what_git_and_argv_refuse() {
    for bad in [
        "",
        "-b",
        "--force",
        "/leading",
        "trailing/",
        "has space",
        "a..b",
        "a//b",
        "a~1",
        "a^",
        "a:b",
        "a?b",
        "a*b",
        "a[b",
        "a\\b",
        "a@{b",
        "x.lock",
        "with\nnewline",
    ] {
        assert!(validate_ref_name(bad).is_err(), "should reject {bad:?}");
    }
    for ok in ["main", "feat/forge-integration", "pr-118", "release/1.2.3"] {
        validate_ref_name(ok).unwrap_or_else(|e| panic!("should accept {ok:?}: {e:?}"));
    }
}

// ── URL builders ─────────────────────────────────────────────────────────────

#[test]
fn github_urls_are_exactly_as_expected() {
    let f = forge_for(ForgeKind::GitHub);
    let repo = gh("github.com", "jonassaa", "platypusgit");
    assert_eq!(f.identity_url("github.com").unwrap(), "https://api.github.com/user");
    assert_eq!(
        f.list_url(&repo).unwrap(),
        "https://api.github.com/repos/jonassaa/platypusgit/pulls?state=open&per_page=50&sort=updated&direction=desc"
    );
    assert_eq!(
        f.checks_url(&repo, "6d15cfe").unwrap(),
        "https://api.github.com/repos/jonassaa/platypusgit/commits/6d15cfe/status"
    );
    assert_eq!(
        f.create_url(&repo).unwrap(),
        "https://api.github.com/repos/jonassaa/platypusgit/pulls"
    );
}

#[test]
fn gitlab_urls_encode_the_whole_project_path_as_one_segment() {
    // GitLab addresses a project by its URL-encoded full path, so the `/`
    // between namespace segments is encoded too — passing two path segments
    // would 404.
    let f = forge_for(ForgeKind::GitLab);
    let repo = gl("gitlab.com", "group/sub", "svc");
    assert_eq!(f.identity_url("gitlab.com").unwrap(), "https://gitlab.com/api/v4/user");
    assert_eq!(
        f.list_url(&repo).unwrap(),
        "https://gitlab.com/api/v4/projects/group%2Fsub%2Fsvc/merge_requests?state=opened&per_page=50&order_by=updated_at&sort=desc"
    );
    assert_eq!(
        f.checks_url(&repo, "cafebabe").unwrap(),
        "https://gitlab.com/api/v4/projects/group%2Fsub%2Fsvc/pipelines?sha=cafebabe&per_page=1"
    );
    assert_eq!(
        f.create_url(&repo).unwrap(),
        "https://gitlab.com/api/v4/projects/group%2Fsub%2Fsvc/merge_requests"
    );
}

#[test]
fn head_refs_are_the_forge_synthesised_ones() {
    // These are what make a FORK pull request checkoutable without the fork's
    // URL: both forges publish them on the BASE repository.
    assert_eq!(forge_for(ForgeKind::GitHub).head_ref(118), "refs/pull/118/head");
    assert_eq!(
        forge_for(ForgeKind::GitLab).head_ref(7),
        "refs/merge-requests/7/head"
    );
}

// ── parsing: identity ───────────────────────────────────────────────────────

#[test]
fn identities_parse_from_each_forges_user_endpoint() {
    let gh = forge_for(ForgeKind::GitHub)
        .parse_identity(&fixture("github_user.json"))
        .unwrap();
    assert_eq!(gh.login, "jonassaa");
    assert_eq!(gh.name.as_deref(), Some("Jonas Aasberg"));

    // GitLab's field is `username`, not `login`.
    let gl = forge_for(ForgeKind::GitLab)
        .parse_identity(&fixture("gitlab_user.json"))
        .unwrap();
    assert_eq!(gl.login, "aasberg");
    assert_eq!(gl.name.as_deref(), Some("Jonas Aasberg"));
}

#[test]
fn a_user_payload_without_a_login_is_a_forge_error_not_a_panic() {
    for kind in [ForgeKind::GitHub, ForgeKind::GitLab] {
        let err = forge_for(kind).parse_identity("{}").expect_err("should fail");
        assert!(matches!(err, AppError::Forge(_)), "{err:?}");
    }
}

// ── parsing: lists ──────────────────────────────────────────────────────────

#[test]
fn github_pull_list_parses_every_field_the_ui_shows() {
    let prs = forge_for(ForgeKind::GitHub)
        .parse_list(&fixture("github_pulls.json"))
        .unwrap();
    assert_eq!(prs.len(), 3);

    let same_repo = &prs[0];
    assert_eq!(same_repo.number, 118);
    assert_eq!(same_repo.author, "jonassaa");
    assert_eq!(same_repo.source_branch, "feat/head-marks");
    assert_eq!(same_repo.target_branch, "main");
    assert_eq!(same_repo.url, "https://github.com/jonassaa/platypusgit/pull/118");
    assert!(!same_repo.draft);
    assert!(!same_repo.cross_repo, "same-repo PR flagged as a fork");
    assert_eq!(
        same_repo.sha.as_deref(),
        Some("6d15cfe2b71a44c9f0e2d1a3b5c7e9f0a1b2c3d4")
    );

    let fork = &prs[1];
    assert!(fork.draft);
    assert!(fork.cross_repo, "fork PR not flagged — its branch name would be reused");
    assert_eq!(fork.source_branch, "patch-1");

    // A deleted fork leaves head.repo null; treat it as cross-repo so a
    // checkout still refuses to reuse the branch name.
    let deleted_fork = &prs[2];
    assert!(deleted_fork.cross_repo, "null head.repo must read as cross-repo");
}

#[test]
fn gitlab_merge_request_list_uses_iid_and_project_ids() {
    let mrs = forge_for(ForgeKind::GitLab)
        .parse_list(&fixture("gitlab_mrs.json"))
        .unwrap();
    assert_eq!(mrs.len(), 2);

    let same_project = &mrs[0];
    // `iid` (7), NOT the instance-wide `id` (90210) — the head ref is keyed by iid.
    assert_eq!(same_project.number, 7);
    assert_eq!(same_project.author, "aasberg");
    assert_eq!(same_project.source_branch, "feat/pipeline-column");
    assert_eq!(same_project.target_branch, "main");
    assert_eq!(
        same_project.url,
        "https://gitlab.com/group/sub/svc/-/merge_requests/7"
    );
    assert!(!same_project.draft);
    assert!(!same_project.cross_repo);

    let fork = &mrs[1];
    assert_eq!(fork.number, 8);
    assert!(fork.cross_repo, "source_project_id != target_project_id must read as a fork");
    // This one carries no `draft` field at all — the `Draft: ` title prefix is
    // the only signal an older instance gives.
    assert!(fork.draft, "Draft: title prefix not recognised");
}

#[test]
fn a_non_list_payload_is_a_forge_error() {
    for kind in [ForgeKind::GitHub, ForgeKind::GitLab] {
        for body in ["{}", "null", "\"nope\""] {
            let err = forge_for(kind).parse_list(body).expect_err("should fail");
            assert!(matches!(err, AppError::Forge(_)), "{body} -> {err:?}");
        }
        // Malformed JSON must not panic either.
        let err = forge_for(kind).parse_list("not json").expect_err("should fail");
        assert!(matches!(err, AppError::Forge(_)), "{err:?}");
    }
}

#[test]
fn a_list_entry_missing_its_number_is_skipped_not_fatal() {
    // A forge adding a field, or an entry we cannot key, must not blank the
    // whole list.
    let prs = forge_for(ForgeKind::GitHub)
        .parse_list(r#"[{"title":"no number"},{"number":1,"title":"ok"}]"#)
        .unwrap();
    assert_eq!(prs.len(), 1);
    assert_eq!(prs[0].number, 1);
}

// ── parsing: checks ─────────────────────────────────────────────────────────

#[test]
fn github_combined_status_maps_onto_the_shared_vocabulary() {
    let f = forge_for(ForgeKind::GitHub);
    let ok = f.parse_checks(&fixture("github_status.json")).unwrap();
    assert_eq!(ok.state, ChecksState::Success);
    assert_eq!(ok.total, 3);
    assert_eq!(ok.label, "success");

    let bad = f.parse_checks(&fixture("github_status_failure.json")).unwrap();
    assert_eq!(bad.state, ChecksState::Failure);

    // GitHub says "pending" both for "running" and for "nothing ran"; only
    // total_count tells them apart, and calling "no checks" pending would show a
    // spinner forever.
    let none = f
        .parse_checks(&fixture("github_status_pending_empty.json"))
        .unwrap();
    assert_eq!(none.state, ChecksState::None);
    assert_eq!(none.total, 0);
}

#[test]
fn gitlab_pipeline_status_maps_onto_the_shared_vocabulary() {
    let f = forge_for(ForgeKind::GitLab);
    let running = f.parse_checks(&fixture("gitlab_pipelines.json")).unwrap();
    assert_eq!(running.state, ChecksState::Pending);
    assert_eq!(running.label, "running");

    // No pipeline for this commit is a real state, not a failure.
    let none = f.parse_checks(&fixture("gitlab_pipelines_empty.json")).unwrap();
    assert_eq!(none.state, ChecksState::None);
    assert_eq!(none.label, "no pipeline");
}

#[test]
fn gitlab_status_words_land_in_the_right_bucket() {
    let f = forge_for(ForgeKind::GitLab);
    let of = |status: &str| {
        f.parse_checks(&format!(r#"[{{"status":"{status}"}}]"#))
            .unwrap()
            .state
    };
    assert_eq!(of("success"), ChecksState::Success);
    assert_eq!(of("failed"), ChecksState::Failure);
    for pending in ["created", "waiting_for_resource", "preparing", "pending", "running", "scheduled"] {
        assert_eq!(of(pending), ChecksState::Pending, "{pending}");
    }
    // Neither a pass nor a failure.
    assert_eq!(of("canceled"), ChecksState::None);
    assert_eq!(of("skipped"), ChecksState::None);
}

// ── create ──────────────────────────────────────────────────────────────────

fn new_pr(title: &str, draft: bool) -> NewPullRequest {
    NewPullRequest {
        title: title.into(),
        body: "why this change".into(),
        source_branch: "feat/x".into(),
        target_branch: "main".into(),
        draft,
    }
}

#[test]
fn github_create_body_uses_head_base_and_a_draft_flag() {
    let body = forge_for(ForgeKind::GitHub).create_body(&new_pr("Add a thing", true));
    assert_eq!(body["title"], "Add a thing");
    assert_eq!(body["body"], "why this change");
    assert_eq!(body["head"], "feat/x");
    assert_eq!(body["base"], "main");
    assert_eq!(body["draft"], true);
}

#[test]
fn gitlab_create_body_expresses_draft_as_a_title_prefix() {
    // GitLab's MR-create API has NO draft parameter. The prefix IS the flag —
    // sending `draft: true` silently creates a non-draft MR.
    let f = forge_for(ForgeKind::GitLab);

    let draft = f.create_body(&new_pr("Add a thing", true));
    assert_eq!(draft["title"], "Draft: Add a thing");
    assert_eq!(draft["description"], "why this change");
    assert_eq!(draft["source_branch"], "feat/x");
    assert_eq!(draft["target_branch"], "main");
    assert!(draft.get("draft").is_none(), "GitLab has no draft field: {draft}");

    let plain = f.create_body(&new_pr("Add a thing", false));
    assert_eq!(plain["title"], "Add a thing");
}

#[test]
fn gitlab_does_not_double_prefix_a_title_the_user_already_marked_draft() {
    let body = forge_for(ForgeKind::GitLab).create_body(&new_pr("Draft: Add a thing", true));
    assert_eq!(body["title"], "Draft: Add a thing");
}

#[test]
fn created_requests_parse_back_with_their_url() {
    // The created URL is the whole payoff of the create flow.
    let gh = forge_for(ForgeKind::GitHub)
        .parse_created(&fixture("github_created_pr.json"))
        .unwrap();
    assert_eq!(gh.number, 121);
    assert_eq!(gh.url, "https://github.com/jonassaa/platypusgit/pull/121");
    assert!(gh.draft);

    let gl = forge_for(ForgeKind::GitLab)
        .parse_created(&fixture("gitlab_created_mr.json"))
        .unwrap();
    assert_eq!(gl.number, 9);
    assert_eq!(gl.url, "https://gitlab.com/group/sub/svc/-/merge_requests/9");
    assert!(gl.draft);
}

#[test]
fn an_unusable_create_response_is_a_forge_error() {
    for kind in [ForgeKind::GitHub, ForgeKind::GitLab] {
        let err = forge_for(kind).parse_created("{}").expect_err("should fail");
        assert!(matches!(err, AppError::Forge(_)), "{err:?}");
    }
}

// ── auth headers ────────────────────────────────────────────────────────────

#[test]
fn each_forge_sends_the_token_in_its_own_header() {
    use platypusgit_lib::forge::token::Secret;
    let token = Secret::new("t0ken");

    let gh = forge_for(ForgeKind::GitHub);
    assert_eq!(gh.auth_header(), "Authorization");
    assert_eq!(gh.auth_value(&token), "Bearer t0ken");

    // GitLab rejects a personal access token sent as `Authorization: Bearer`.
    let gl = forge_for(ForgeKind::GitLab);
    assert_eq!(gl.auth_header(), "PRIVATE-TOKEN");
    assert_eq!(gl.auth_value(&token), "t0ken");
}
