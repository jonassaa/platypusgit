//! Commit signing: config resolution, program arguments, and verify parsing
//! (#61 D6).
//!
//! Nothing here spawns a process — that is `libgit2.rs`'s job. Keeping the
//! decisions pure is what makes them testable without a gpg keyring.

use serde::Serialize;

use crate::error::{AppError, AppResult};

/// Signature format, from `gpg.format`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SigFormat {
    /// git's default.
    OpenPgp,
    Ssh,
    /// Recognized so it can be refused clearly rather than mis-signed.
    X509,
}

#[derive(Debug, Clone)]
pub struct SigningConfig {
    pub format: SigFormat,
    /// Program to run: `gpg.program`, `gpg.ssh.program`, or the format default.
    pub program: String,
    /// `user.signingkey`, if set.
    pub key: Option<String>,
}

/// Read `gpg.format`, the matching program, and `user.signingkey`.
pub fn resolve_signing(repo: &git2::Repository) -> AppResult<SigningConfig> {
    let cfg = repo.config()?;
    let get = |k: &str| cfg.get_string(k).ok().filter(|s| !s.trim().is_empty());

    let format = match get("gpg.format").as_deref() {
        Some("ssh") => SigFormat::Ssh,
        Some("x509") => SigFormat::X509,
        // Absent or "openpgp" — git's default.
        _ => SigFormat::OpenPgp,
    };

    let program = match format {
        SigFormat::OpenPgp => get("gpg.program").unwrap_or_else(|| "gpg".to_string()),
        SigFormat::Ssh => get("gpg.ssh.program").unwrap_or_else(|| "ssh-keygen".to_string()),
        SigFormat::X509 => get("gpg.x509.program").unwrap_or_else(|| "smimesign".to_string()),
    };

    Ok(SigningConfig {
        format,
        program,
        key: get("user.signingkey"),
    })
}

/// Whether `commit.gpgsign` asks for signing. Defaults to false.
pub fn config_wants_signing(repo: &git2::Repository) -> bool {
    repo.config()
        .and_then(|c| c.get_bool("commit.gpgsign"))
        .unwrap_or(false)
}

/// Arguments for signing a commit buffer fed on stdin, signature on stdout.
///
/// `key_file` is the resolved private-key path for ssh signing; `user.signingkey`
/// may instead hold a literal key (`key::ssh-ed25519 …`), which the caller writes
/// to a temp file first, so the path cannot be derived here.
pub fn signing_args(cfg: &SigningConfig, key_file: Option<&std::path::Path>) -> AppResult<Vec<String>> {
    match cfg.format {
        SigFormat::OpenPgp => {
            // -b detached, -s sign, -a armor; -u selects the key when set,
            // otherwise gpg picks its own default, which is what git does too.
            let mut args = vec!["--status-fd=2".to_string()];
            match &cfg.key {
                Some(k) => {
                    args.push("-bsau".to_string());
                    args.push(k.clone());
                }
                None => args.push("-bsa".to_string()),
            }
            Ok(args)
        }
        SigFormat::Ssh => {
            // ssh-keygen cannot pick a default the way gpg can: without a key
            // there is nothing to sign with, so this is a clean error rather
            // than a confusing failure from the subprocess.
            let key = key_file.ok_or_else(|| {
                AppError::InvalidArgument(
                    "ssh signing needs user.signingkey to be set".to_string(),
                )
            })?;
            Ok(vec![
                "-Y".to_string(),
                "sign".to_string(),
                "-n".to_string(),
                "git".to_string(),
                "-f".to_string(),
                key.to_string_lossy().to_string(),
            ])
        }
        // Refused rather than silently producing an unsigned commit: the user
        // asked for a signature and would have no indication they did not get one.
        SigFormat::X509 => Err(AppError::NotImplemented),
    }
}

/// Verification state of one commit's signature.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum SigState {
    Good,
    Bad,
    /// Signed, but the key is not available to check it.
    UnknownKey,
    Expired,
    Revoked,
    /// Not signed at all.
    None,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureStatus {
    pub state: SigState,
    pub signer: Option<String>,
    pub key: Option<String>,
}

/// Parse `git show --format=%G?%x00%GS%x00%GK` output for one commit.
///
/// `U` is "good signature, untrusted key" — reported as `Good`, with the signer
/// line carrying the nuance, rather than inventing a state the UI would have to
/// explain.
///
/// git's full code set is G/B/U/X/Y/R/E/N. `X` ("good signature that has
/// expired") and `Y` ("good signature made by an expired key") are distinct codes
/// but map to the same user-facing state: both are real signatures whose validity
/// has lapsed. Missing `Y` reported a genuinely signed commit as unsigned.
pub fn parse_verify_output(raw: &str) -> SignatureStatus {
    let mut parts = raw.trim_end_matches('\n').split('\0');
    let flag = parts.next().unwrap_or("N").trim();
    let signer = parts.next().unwrap_or("").trim();
    let key = parts.next().unwrap_or("").trim();

    let state = match flag.chars().next().unwrap_or('N') {
        'G' | 'U' => SigState::Good,
        'B' => SigState::Bad,
        // X: the signature expired. Y: the key that made it expired.
        'X' | 'Y' => SigState::Expired,
        'R' => SigState::Revoked,
        'E' => SigState::UnknownKey,
        // 'N' and anything unexpected: treat as unsigned rather than claiming a
        // status we cannot substantiate.
        _ => SigState::None,
    };

    SignatureStatus {
        state,
        signer: (!signer.is_empty()).then(|| signer.to_string()),
        key: (!key.is_empty()).then(|| key.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn openpgp_args_use_detached_armored_signing_with_the_key() {
        let cfg = SigningConfig {
            format: SigFormat::OpenPgp,
            program: "gpg".into(),
            key: Some("ABCD1234".into()),
        };
        let args = signing_args(&cfg, None).unwrap();
        assert!(args.contains(&"-bsau".to_string()), "{args:?}");
        assert!(args.contains(&"ABCD1234".to_string()), "{args:?}");
    }

    #[test]
    fn openpgp_without_a_key_lets_gpg_pick_its_default() {
        let cfg = SigningConfig {
            format: SigFormat::OpenPgp,
            program: "gpg".into(),
            key: None,
        };
        let args = signing_args(&cfg, None).unwrap();
        assert!(args.contains(&"-bsa".to_string()), "{args:?}");
        assert!(!args.iter().any(|a| a == "-u"), "{args:?}");
    }

    #[test]
    fn ssh_args_sign_with_the_git_namespace_and_key_file() {
        let cfg = SigningConfig {
            format: SigFormat::Ssh,
            program: "ssh-keygen".into(),
            key: Some("/home/u/.ssh/id_ed25519".into()),
        };
        let args = signing_args(&cfg, Some(std::path::Path::new("/tmp/key"))).unwrap();
        assert_eq!(args[0], "-Y");
        assert_eq!(args[1], "sign");
        assert!(args.contains(&"git".to_string()), "namespace: {args:?}");
        assert!(args.contains(&"/tmp/key".to_string()), "key file: {args:?}");
    }

    #[test]
    fn ssh_signing_requires_a_key() {
        let cfg = SigningConfig {
            format: SigFormat::Ssh,
            program: "ssh-keygen".into(),
            key: None,
        };
        let err = signing_args(&cfg, None).expect_err("ssh needs a key");
        assert!(matches!(err, AppError::InvalidArgument(_)), "got {err:?}");
    }

    #[test]
    fn x509_is_a_clean_unsupported_error_not_a_panic() {
        let cfg = SigningConfig {
            format: SigFormat::X509,
            program: "smimesign".into(),
            key: None,
        };
        let err = signing_args(&cfg, None).expect_err("x509 is unsupported");
        assert!(matches!(err, AppError::NotImplemented), "got {err:?}");
    }

    #[test]
    fn parses_each_verify_state() {
        for (raw, want) in [
            ("G\0Ada <ada@x>\0ABCD", SigState::Good),
            ("B\0Ada <ada@x>\0ABCD", SigState::Bad),
            // Good signature, untrusted key.
            ("U\0Ada <ada@x>\0ABCD", SigState::Good),
            ("X\0Ada <ada@x>\0ABCD", SigState::Expired),
            // Good signature made by an expired key — a real signature, so it
            // must never read as unsigned.
            ("Y\0Ada <ada@x>\0ABCD", SigState::Expired),
            ("R\0Ada <ada@x>\0ABCD", SigState::Revoked),
            ("E\0\0", SigState::UnknownKey),
            ("N\0\0", SigState::None),
        ] {
            assert_eq!(parse_verify_output(raw).state, want, "{raw}");
        }
    }

    #[test]
    fn parses_signer_and_key() {
        let s = parse_verify_output("G\0Ada Lovelace <ada@x>\0ABCD1234");
        assert_eq!(s.signer.as_deref(), Some("Ada Lovelace <ada@x>"));
        assert_eq!(s.key.as_deref(), Some("ABCD1234"));
    }

    #[test]
    fn an_unsigned_commit_has_no_signer() {
        let s = parse_verify_output("N\0\0");
        assert_eq!(s.state, SigState::None);
        assert!(s.signer.is_none());
        assert!(s.key.is_none());
    }

    #[test]
    fn an_unexpected_flag_reads_as_unsigned() {
        // Better than claiming a status we cannot substantiate.
        assert_eq!(parse_verify_output("?\0\0").state, SigState::None);
        assert_eq!(parse_verify_output("").state, SigState::None);
    }
}
