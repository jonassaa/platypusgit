use std::path::PathBuf;

use git2::{Repository, Signature};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

/// Which config file a `user.name` / `user.email` came from (#212).
///
/// Coarser than libgit2's `ConfigLevel` on purpose: what a user can act on is
/// "this repository", "your account" or "this machine", and collapsing
/// `Local`/`Worktree` and `Global`/`XDG` spares the UI having to explain the
/// difference between `~/.gitconfig` and `~/.config/git/config`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum IdentityScope {
    /// `.git/config` or a worktree-specific config — this repository only.
    Repository,
    /// `~/.gitconfig` or the XDG file — every repository for this user.
    Global,
    /// `/etc/gitconfig` (or Windows' ProgramData) — every user on this machine.
    System,
}

/// Where a write goes (#233).
///
/// Deliberately NOT `IdentityScope`. That type has a `System` variant, because
/// a value can be READ from `/etc/gitconfig` — but writing there needs root and
/// would change the identity of every user on the machine, which is never what
/// someone fixing their own commits is asking for. Keeping the two enums apart
/// makes "you cannot save to system" a fact the type system enforces rather
/// than a runtime check someone can forget.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum IdentityWriteScope {
    /// This repository's `.git/config` — `git config --local`.
    Repository,
    /// `~/.gitconfig` — `git config --global`.
    Global,
}

/// One configured value plus where it came from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfiguredValue {
    /// Verbatim, INCLUDING a blank one — a `user.email =` line git refuses is a
    /// state the user has to see to fix, and reporting it as absent would send
    /// them looking for a line that is already there.
    pub value: String,
    pub scope: IdentityScope,
}

/// The committer identity a commit would use, and where each half comes from
/// (#212).
///
/// Both halves are optional because the state this type exists to describe is a
/// fresh machine, where neither is set. `usable()` is the question callers
/// actually ask; a present-but-blank value is not usable, which is why
/// `ConfiguredValue` keeps the raw string instead of being dropped.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitIdentity {
    pub name: Option<ConfiguredValue>,
    pub email: Option<ConfiguredValue>,
    /// The file [`set_global_identity`] would write to, so the UI can name it
    /// before anything changes. `None` only when no home directory resolves.
    pub global_config_path: Option<String>,
    /// The file [`set_local_identity`] would write to (#233). `None` when the
    /// identity was read without a repository — the Settings screen with
    /// nothing open, where "this repository" is not an option to offer.
    ///
    /// Named for the same reason the global one is: a save that writes to the
    /// user's own git config, outside the app's settings, should say which file
    /// it is about to touch.
    pub local_config_path: Option<String>,
}

impl GitIdentity {
    /// Whether git could build a committer signature from this.
    ///
    /// Mirrors libgit2's own rule — both halves present and non-blank — so a UI
    /// that gates on this agrees with what the commit will actually do.
    pub fn usable(&self) -> bool {
        let ok =
            |v: &Option<ConfiguredValue>| v.as_ref().is_some_and(|c| !c.value.trim().is_empty());
        ok(&self.name) && ok(&self.email)
    }
}

fn scope_of(level: git2::ConfigLevel) -> IdentityScope {
    use git2::ConfigLevel::*;
    match level {
        // `App` and `Highest` are libgit2's in-memory layers, above every file.
        // Nothing here writes them; if one ever answers, it is closer to this
        // repository than to the machine.
        Local | Worktree | App | Highest => IdentityScope::Repository,
        Global | XDG => IdentityScope::Global,
        System | ProgramData => IdentityScope::System,
    }
}

fn configured(cfg: &git2::Config, key: &str) -> Option<ConfiguredValue> {
    // `get_entry` answers with the WINNING entry across every level — the one a
    // commit would use, and the only one whose scope is worth reporting.
    let entry = cfg.get_entry(key).ok()?;
    Some(ConfiguredValue {
        value: entry.value().ok()?.to_string(),
        scope: scope_of(entry.level()),
    })
}

/// The identity a commit in `repo` would use. `None` reads the config chain
/// with no repository open — the Settings screen before one is opened.
pub fn read_identity(repo: Option<&Repository>) -> AppResult<GitIdentity> {
    let mut cfg = match repo {
        Some(repo) => repo.config()?,
        None => git2::Config::open_default()?,
    };
    // A snapshot, so both reads see the same files even if something rewrites
    // one between them.
    let cfg = cfg.snapshot()?;
    Ok(GitIdentity {
        name: configured(&cfg, "user.name"),
        email: configured(&cfg, "user.email"),
        global_config_path: global_config_path()
            .ok()
            .map(|p| p.to_string_lossy().to_string()),
        local_config_path: repo.map(|r| local_config_path(r).to_string_lossy().to_string()),
    })
}

/// The file `git config --global` would write to.
///
/// Resolved the way git resolves it: `~/.gitconfig` when it exists, otherwise
/// an existing XDG `git/config`, otherwise `~/.gitconfig` — the file git
/// creates when neither is there. Naming a file that does not exist yet is the
/// point; this runs on a fresh machine.
pub fn global_config_path() -> AppResult<PathBuf> {
    if let Ok(p) = git2::Config::find_global() {
        return Ok(p);
    }
    if let Ok(p) = git2::Config::find_xdg() {
        return Ok(p);
    }
    crate::git::blame::home_dir()
        .map(|h| h.join(".gitconfig"))
        .ok_or_else(|| {
            AppError::Io("no home directory to write a global git config into".to_string())
        })
}

/// The file `git config --local` would write to.
///
/// `commondir()`, not `path()`. They differ in a linked worktree: `path()` is
/// that worktree's own gitdir (`.git/worktrees/<name>`), while `--local` writes
/// to the SHARED config in the common directory — so `path()` would name a file
/// git never writes and the UI would promise the wrong thing. In an ordinary
/// repository the two are the same directory, which is why the difference is
/// easy to miss.
pub fn local_config_path(repo: &Repository) -> PathBuf {
    repo.commondir().join("config")
}

/// Write `user.name` / `user.email` to this repository's own config (#233).
///
/// The counterpart to [`set_global_identity`], and the reason #233 exists: a
/// work identity and a personal one on the same machine differ per repository,
/// and the cost of getting it wrong — a corporate address on a public commit —
/// is not fixable after the push.
///
/// Validated BEFORE the config is opened, the same rule the global writer
/// follows: a refused value must leave nothing behind.
pub fn set_local_identity(repo: &Repository, name: &str, email: &str) -> AppResult<()> {
    let (name, email) = validate_identity(name, email)?;
    // `repo.config()` is the whole chain, and `set_str` on it writes to the
    // highest-priority writable level — which IS local today. Opening the level
    // explicitly says so at the call site instead of relying on that, so a
    // future libgit2 that resolves it differently fails loudly here rather than
    // quietly writing the user's global config from a button labelled "this
    // repository".
    let mut cfg = repo.config()?.open_level(git2::ConfigLevel::Local)?;
    cfg.set_str("user.name", &name)?;
    cfg.set_str("user.email", &email)?;
    Ok(())
}

/// A `user.name` / `user.email` a user typed, trimmed — or the reason git would
/// refuse them.
///
/// git2 is the authority on that second question rather than a regex of our
/// own: whatever it cannot build a `Signature` from is exactly what would fail
/// at commit time, which is the failure this path exists to prevent. The
/// explicit checks above it exist only to say WHICH rule was broken — git2's
/// own "failed to parse signature" names none of them.
pub fn validate_identity(name: &str, email: &str) -> AppResult<(String, String)> {
    let name = name.trim();
    let email = email.trim();
    if name.is_empty() {
        return Err(AppError::InvalidArgument("a name is required".to_string()));
    }
    if email.is_empty() {
        return Err(AppError::InvalidArgument(
            "an email address is required".to_string(),
        ));
    }
    for (label, value) in [("name", name), ("email", email)] {
        if let Some(c) = value.chars().find(|c| matches!(c, '<' | '>' | '\n' | '\r')) {
            let what = if c == '\n' || c == '\r' {
                "a line break".to_string()
            } else {
                format!("'{}'", c)
            };
            return Err(AppError::InvalidArgument(format!(
                "a {} cannot contain {}",
                label, what
            )));
        }
    }
    Signature::now(name, email).map_err(|e| {
        AppError::InvalidArgument(format!("git will not accept this identity: {}", e.message()))
    })?;
    Ok((name.to_string(), email.to_string()))
}

/// Write `user.name` / `user.email` to the global git config, creating the file
/// when there is none yet (#212).
///
/// Global rather than per-repository because the state this fixes is a machine
/// with no identity at all, where per-repository would mean answering the same
/// question again in every repository the user opens. Per-repository identities
/// and multiple accounts are #233.
///
/// Validated BEFORE anything is opened, so a refused value leaves no file
/// behind on a machine that had none — the same "a failure creates nothing"
/// rule the signing chain follows.
pub fn set_global_identity(name: &str, email: &str) -> AppResult<()> {
    let (name, email) = validate_identity(name, email)?;
    let path = global_config_path()?;
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }
    // libgit2 will open a config file that is not there, but it is not
    // documented to create one — and an XDG path's directory may not exist
    // either. Creating it first makes both cases the same case.
    if !path.exists() {
        std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)?;
    }
    let mut cfg = git2::Config::open(&path)?;
    cfg.set_str("user.name", &name)?;
    cfg.set_str("user.email", &email)?;
    Ok(())
}

/// Whether the configured `user.name` / `user.email` are an identity git would
/// accept — asked of the CONFIG, not of an error message.
///
/// This is what separates `NoSignature` from a genuine git failure, and it has
/// to read the config because libgit2's error codes do not distinguish the two
/// cases that matter: a MISSING `user.name` comes back as `NotFound`, while a
/// BLANK or malformed one comes back as a generic error whose only
/// distinguishing mark is prose ("failed to parse signature - Signature cannot
/// have an empty name or email"). Matching on that string would be a parser for
/// another project's wording.
///
/// [`validate_identity`] is deliberately the same rule the writer enforces, so
/// "what this app will save" and "what this app calls a missing identity" can
/// never drift apart.
fn configured_identity_is_valid(repo: &Repository) -> bool {
    let Ok(mut cfg) = repo.config() else {
        return false;
    };
    let Ok(cfg) = cfg.snapshot() else {
        return false;
    };
    let (Ok(name), Ok(email)) = (cfg.get_string("user.name"), cfg.get_string("user.email")) else {
        return false;
    };
    validate_identity(&name, &email).is_ok()
}

/// Resolve a `Signature` from the repository's config.
///
/// Priority: repo-local config → global → system. Fails with
/// `AppError::NoSignature` when there is no identity git will accept —
/// missing, blank, or malformed, because all three have the same remedy and
/// the identity prompt shows the offending value back to the user.
///
/// Before #212 only the MISSING case was `NoSignature`; a blank `user.email`
/// reached the user as the raw libgit2 string "failed to parse signature",
/// which names neither the key nor the fix.
pub fn default_signature<'a>(repo: &'a Repository) -> AppResult<Signature<'a>> {
    match repo.signature() {
        Ok(sig) => Ok(sig),
        Err(e) => {
            if configured_identity_is_valid(repo) {
                Err(e.into())
            } else {
                Err(AppError::NoSignature)
            }
        }
    }
}

/// Append a `Signed-off-by: Name <email>` trailer to a commit message,
/// matching `git commit -s` semantics.
///
/// - Idempotent: if the exact trailer is already the last line of an existing
///   trailer block, the message is returned unchanged (no duplicate).
/// - The trailer is separated from the body by a blank line when the message
///   doesn't already end with a trailer block.
pub fn apply_signoff(message: &str, name: &str, email: &str) -> String {
    let trailer = format!("Signed-off-by: {} <{}>", name, email);

    // Already present anywhere as its own line → no-op (git dedupes identical
    // sign-offs regardless of position).
    if message.lines().any(|line| line.trim_end() == trailer) {
        return message.to_string();
    }

    let trimmed = message.trim_end_matches('\n');
    if trimmed.is_empty() {
        return trailer;
    }

    // If there's a body (blank-line-separated block) and the last block already
    // looks like a trailer block (every line is a `key: value` trailer), join it
    // directly without an extra blank line. A bare subject like `fix: thing` is
    // never treated as a trailer block — it always gets the blank-line separator.
    let last_block_is_trailers = trimmed.contains("\n\n")
        && trimmed
            .rsplit("\n\n")
            .next()
            .map(|block| block.lines().all(is_trailer_line))
            .unwrap_or(false);

    if last_block_is_trailers {
        format!("{}\n{}", trimmed, trailer)
    } else {
        format!("{}\n\n{}", trimmed, trailer)
    }
}

/// Whether `line` is a git trailer of the form `key: value` or `key:value`.
///
/// Matches `git interpret-trailers`' token rule: the key is one or more
/// characters from `[A-Za-z0-9-]` (letters, digits, hyphen — no spaces),
/// immediately followed by a `:`. This deliberately rejects prose lines that
/// merely contain `": "` (e.g. `See also: the README`, where the key would be
/// `See also` and contains a space) and accepts space-less keys regardless of
/// whether a space follows the colon (e.g. `Fixes:#123`).
fn is_trailer_line(line: &str) -> bool {
    match line.split_once(':') {
        Some((key, _)) => {
            !key.is_empty() && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        }
        None => false,
    }
}

#[cfg(test)]
mod identity_tests {
    use super::{validate_identity, ConfiguredValue, GitIdentity, IdentityScope};
    use crate::error::AppError;

    fn refusal(name: &str, email: &str) -> String {
        match validate_identity(name, email) {
            Err(AppError::InvalidArgument(m)) => m,
            other => panic!("expected InvalidArgument for ({name:?}, {email:?}), got {other:?}"),
        }
    }

    #[test]
    fn trims_what_it_accepts() {
        let (name, email) = validate_identity("  Ada Lovelace \t", " ada@example.com ").unwrap();
        assert_eq!(name, "Ada Lovelace");
        assert_eq!(email, "ada@example.com");
    }

    #[test]
    fn names_which_half_is_missing() {
        assert!(refusal("", "ada@example.com").contains("name"));
        assert!(refusal("   ", "ada@example.com").contains("name"));
        assert!(refusal("Ada", "").contains("email"));
        assert!(refusal("Ada", "  \t ").contains("email"));
    }

    #[test]
    fn names_the_character_git_would_choke_on() {
        // `<` and `>` delimit the email in a commit's author line, so git
        // refuses them anywhere in either half. The message has to say which
        // character, because "failed to parse signature" does not.
        assert!(refusal("Ada <Lovelace>", "ada@example.com").contains("'<'"));
        assert!(refusal("Ada", "ada<@example.com").contains("'<'"));
        assert!(refusal("Ada", "ada@example.com>").contains("'>'"));
        assert!(refusal("Ada\nLovelace", "ada@example.com").contains("line break"));
        assert!(refusal("Ada", "ada\r@example.com").contains("line break"));
        // A line break at either END is whitespace and is trimmed, not
        // refused — a pasted value with a stray newline still saves.
        assert!(validate_identity("Ada\n", "ada@example.com\r\n").is_ok());
    }

    #[test]
    fn a_plain_identity_is_accepted() {
        assert!(validate_identity("Ada Lovelace", "ada@example.com").is_ok());
        // Unicode, and the `+` and `.` forms real addresses use.
        assert!(validate_identity("Ada Løvelace 김", "ada.b+git@example.co.uk").is_ok());
    }

    fn value(v: &str) -> Option<ConfiguredValue> {
        Some(ConfiguredValue {
            value: v.to_string(),
            scope: IdentityScope::Global,
        })
    }

    #[test]
    fn usable_needs_both_halves_non_blank() {
        let id = |name, email| GitIdentity {
            name,
            email,
            global_config_path: None,
            local_config_path: None,
        };
        assert!(id(value("Ada"), value("ada@example.com")).usable());
        assert!(!id(None, value("ada@example.com")).usable());
        assert!(!id(value("Ada"), None).usable());
        assert!(!id(None, None).usable());
        // Present but blank is the case that used to reach the user as raw
        // libgit2 text — it is NOT usable.
        assert!(!id(value("Ada"), value("   ")).usable());
        assert!(!id(value(""), value("ada@example.com")).usable());
    }
}

#[cfg(test)]
mod tests {
    use super::apply_signoff;

    const NAME: &str = "Ada Lovelace";
    const EMAIL: &str = "ada@example.com";
    const TRAILER: &str = "Signed-off-by: Ada Lovelace <ada@example.com>";

    #[test]
    fn appends_to_subject_only_message() {
        let out = apply_signoff("fix: thing", NAME, EMAIL);
        assert_eq!(out, format!("fix: thing\n\n{}", TRAILER));
    }

    #[test]
    fn appends_after_body_with_blank_line() {
        let msg = "feat: thing\n\nLonger explanation of the change.";
        let out = apply_signoff(msg, NAME, EMAIL);
        assert_eq!(out, format!("{}\n\n{}", msg, TRAILER));
    }

    #[test]
    fn does_not_duplicate_existing_trailer() {
        let msg = format!("fix: thing\n\n{}", TRAILER);
        let out = apply_signoff(&msg, NAME, EMAIL);
        assert_eq!(out, msg);
    }

    #[test]
    fn joins_existing_trailer_block_without_extra_blank() {
        // Different trailer already present → new sign-off joins the block.
        let msg = "feat: thing\n\nCo-authored-by: Someone <s@example.com>";
        let out = apply_signoff(msg, NAME, EMAIL);
        assert_eq!(out, format!("{}\n{}", msg, TRAILER));
    }

    #[test]
    fn prose_last_line_with_colon_space_gets_blank_separator() {
        // `See also: README` is prose (key would contain a space) — must NOT be
        // treated as a trailer block, so the sign-off needs a blank-line break.
        let msg = "feat: thing\n\nSome body.\nSee also: the README";
        let out = apply_signoff(msg, NAME, EMAIL);
        assert_eq!(out, format!("{}\n\n{}", msg, TRAILER));
    }

    #[test]
    fn fixes_without_space_treated_as_trailer() {
        // `Fixes:#123` is a valid trailer (no space after colon) — join directly,
        // no extra blank line.
        let msg = "feat: thing\n\nFixes:#123";
        let out = apply_signoff(msg, NAME, EMAIL);
        assert_eq!(out, format!("{}\n{}", msg, TRAILER));
    }

    #[test]
    fn hyphenated_key_treated_as_trailer() {
        let msg = "feat: thing\n\nCo-authored-by: Someone <s@example.com>\nReviewed-by: Other <o@example.com>";
        let out = apply_signoff(msg, NAME, EMAIL);
        assert_eq!(out, format!("{}\n{}", msg, TRAILER));
    }

    #[test]
    fn mixed_block_with_prose_line_gets_blank_separator() {
        // Last block has a real trailer plus a prose line → not all trailers.
        let msg = "feat: thing\n\nReviewed-by: Other <o@example.com>\nSee also: the README";
        let out = apply_signoff(msg, NAME, EMAIL);
        assert_eq!(out, format!("{}\n\n{}", msg, TRAILER));
    }

    #[test]
    fn handles_empty_message() {
        assert_eq!(apply_signoff("", NAME, EMAIL), TRAILER);
    }

    #[test]
    fn ignores_trailing_newlines() {
        let out = apply_signoff("fix: thing\n\n", NAME, EMAIL);
        assert_eq!(out, format!("fix: thing\n\n{}", TRAILER));
    }
}
