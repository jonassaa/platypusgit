use git2::{Repository, Signature};

use crate::error::{AppError, AppResult};

/// Resolve a `Signature` from the repository's config.
///
/// Priority: repo-local config → global → system. Fails with
/// `AppError::NoSignature` when `user.name` or `user.email` is missing.
pub fn default_signature<'a>(repo: &'a Repository) -> AppResult<Signature<'a>> {
    match repo.signature() {
        Ok(sig) => Ok(sig),
        Err(e) => {
            if e.code() == git2::ErrorCode::NotFound {
                Err(AppError::NoSignature)
            } else {
                Err(e.into())
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
