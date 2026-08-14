//! Network-op environment policy and failure mapping (#61 D5).
//!
//! The argv test is the one that matters most: argv is world-readable via `ps`
//! on macOS and Linux, so a credential appearing there would be visible to any
//! other local user for the lifetime of the git subprocess.

use platypusgit_lib::commands::net::{apply_auth_env, map_git_failure, Credentials};
use platypusgit_lib::error::AppError;
use platypusgit_lib::git::auth::AuthKind;

fn creds() -> Credentials {
    Credentials {
        username: Some("ada".into()),
        secret: "ghp_supersecret".into(),
    }
}

#[test]
fn auth_stderr_maps_to_auth_error_with_the_host() {
    let err = map_git_failure("fatal: Authentication failed for 'https://github.com/x/y.git/'");
    match err {
        AppError::Auth(c) => {
            assert_eq!(c.host.as_deref(), Some("github.com"));
            assert_eq!(c.kind, AuthKind::Https);
        }
        other => panic!("expected Auth, got {other:?}"),
    }
}

#[test]
fn passphrase_stderr_maps_to_the_passphrase_kind() {
    let err = map_git_failure("Enter passphrase for key '/home/u/.ssh/id_ed25519': ");
    match err {
        AppError::Auth(c) => assert_eq!(c.kind, AuthKind::SshPassphrase),
        other => panic!("expected Auth, got {other:?}"),
    }
}

#[test]
fn non_auth_stderr_stays_network() {
    let err = map_git_failure("fatal: unable to access 'https://x/y': Could not resolve host: x");
    assert!(matches!(err, AppError::Network(_)), "got {err:?}");
}

#[test]
fn host_key_failure_stays_network_not_auth() {
    // No credential the user can type fixes an unknown host key.
    let err = map_git_failure("Host key verification failed.");
    assert!(matches!(err, AppError::Network(_)), "got {err:?}");
}

#[test]
fn a_surfaced_error_never_carries_an_embedded_token() {
    let err = map_git_failure(
        "fatal: unable to access 'https://u:ghp_leaked@github.com/x/y': Authentication failed",
    );
    let text = format!("{err:?}");
    assert!(!text.contains("ghp_leaked"), "credential leaked: {text}");
}

/// Tag push and remote-branch delete were the two pushes D5 left on the
/// credential-less runner (#61 follow-up). They now go through the same
/// `run_git_authenticated`, so the same classification and the same scrubbing
/// must hold for the stderr THEY produce — which names a refspec, unlike the
/// fetch/pull phrasings the tests above cover.
#[test]
fn a_failed_tag_push_is_an_auth_challenge_not_a_network_error() {
    let err = map_git_failure(
        "remote: Invalid username or password.\n\
         fatal: Authentication failed for 'https://github.com/x/y.git/'\n\
         error: failed to push some refs to 'https://github.com/x/y.git'",
    );
    match err {
        AppError::Auth(c) => {
            assert_eq!(c.host.as_deref(), Some("github.com"));
            assert_eq!(c.kind, AuthKind::Https);
        }
        other => panic!("expected Auth, got {other:?}"),
    }
}

#[test]
fn a_failed_branch_delete_scrubs_the_token_out_of_its_remote_url() {
    // `git push --delete` echoes the remote URL twice — in the fatal line and in
    // the "failed to push some refs to" line. Both must be scrubbed, or a remote
    // configured with an embedded token puts it in the error banner and the log.
    let err = map_git_failure(
        "fatal: unable to access 'https://ada:ghp_leaked@github.com/x/y.git/': \
         The requested URL returned error: 403\n\
         error: failed to push some refs to \
         'https://ada:ghp_leaked@github.com/x/y.git'",
    );
    let text = format!("{err:?}");
    assert!(!text.contains("ghp_leaked"), "credential leaked: {text}");
    assert!(text.contains("github.com/x/y"), "message lost its subject: {text}");
}

#[test]
fn credentials_travel_in_the_environment_never_in_argv() {
    let c = creds();
    let mut cmd = tokio::process::Command::new("git");
    cmd.arg("fetch").arg("origin");
    apply_auth_env(&mut cmd, Some(&c));
    let std_cmd = cmd.as_std();

    let argv = format!("{:?}", std_cmd.get_args().collect::<Vec<_>>());
    assert!(
        !argv.contains("ghp_supersecret"),
        "secret must never reach argv: {argv}"
    );

    let secret_in_env = std_cmd.get_envs().any(|(_, v)| {
        v.map(|v| v.to_string_lossy().contains("ghp_supersecret"))
            .unwrap_or(false)
    });
    assert!(secret_in_env, "secret should travel in the environment");
}

#[test]
fn askpass_points_at_a_bare_executable_with_no_arguments() {
    // GIT_ASKPASS is exec'd directly, not run through a shell: a value with an
    // appended flag fails with "cannot exec".
    let c = creds();
    let mut cmd = tokio::process::Command::new("git");
    apply_auth_env(&mut cmd, Some(&c));

    let askpass = cmd
        .as_std()
        .get_envs()
        .find(|(k, _)| *k == "GIT_ASKPASS")
        .and_then(|(_, v)| v)
        .map(|v| v.to_string_lossy().to_string())
        .expect("GIT_ASKPASS should be set");
    assert!(
        !askpass.contains(" -") && !askpass.contains("--"),
        "GIT_ASKPASS must be a bare executable path, got {askpass}"
    );
}

#[test]
fn without_credentials_prompts_stay_disabled() {
    let mut cmd = tokio::process::Command::new("git");
    apply_auth_env(&mut cmd, None);
    let envs: Vec<(String, String)> = cmd
        .as_std()
        .get_envs()
        .filter_map(|(k, v)| Some((k.to_string_lossy().to_string(), v?.to_string_lossy().to_string())))
        .collect();

    let get = |k: &str| envs.iter().find(|(n, _)| n == k).map(|(_, v)| v.as_str());
    assert_eq!(get("GIT_TERMINAL_PROMPT"), Some("0"));
    assert_eq!(get("GIT_ASKPASS"), Some("true"));
    assert_eq!(get("SSH_ASKPASS"), Some("true"));
}

#[test]
fn an_ssh_passphrase_credential_clears_any_inherited_username() {
    // A stale PLATYPUSGIT_ASKPASS_USERNAME must not answer a username prompt
    // during an SSH passphrase retry.
    let c = Credentials {
        username: None,
        secret: "passphrase".into(),
    };
    let mut cmd = tokio::process::Command::new("git");
    apply_auth_env(&mut cmd, Some(&c));

    let username_set = cmd
        .as_std()
        .get_envs()
        .any(|(k, v)| k == "PLATYPUSGIT_ASKPASS_USERNAME" && v.is_some());
    assert!(!username_set, "username should be cleared, not inherited");
}
