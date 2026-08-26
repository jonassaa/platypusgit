//! Tag signing: the parts that can be decided without a keyring (#132).
//!
//! Nothing here spawns a process or opens a repository. `libgit2.rs` owns the
//! ODB writes and the one `git verify-tag` call; this module owns the byte
//! shuffling and the parsing, which is what makes both testable.

use crate::error::{AppError, AppResult};
use crate::git::signing::{SigState, SignatureStatus};

/// The armor headers git recognizes as the start of a signature block.
///
/// Same set as git's `gpg-interface.c::signature_header[]`. Missing one would
/// report a genuinely signed tag as unsigned, which is the failure mode this
/// whole feature exists to remove.
const SIGNATURE_HEADERS: [&str; 4] = [
    "-----BEGIN PGP SIGNATURE-----",
    "-----BEGIN PGP MESSAGE-----",
    "-----BEGIN SIGNED MESSAGE-----",
    "-----BEGIN SSH SIGNATURE-----",
];

/// Whether an annotated tag's message carries a signature block.
///
/// Anchored to a line start: a message that merely *mentions* an armor header
/// mid-sentence is not a signature, and treating it as one would send us to
/// `git verify-tag` for a tag that has nothing to verify.
pub fn has_signature_block(message: &str) -> bool {
    message
        .lines()
        .any(|line| SIGNATURE_HEADERS.contains(&line.trim_end()))
}

/// Append an armored signature to a canonical tag object body.
///
/// git appends the signature directly after the message, so the message must end
/// in a newline first — without one the armor header runs onto the last message
/// line and the tag is unverifiable by anything, including git. Exactly one
/// newline: git's `strbuf_complete_line` adds one only when it is missing, and
/// padding the body would change the payload the signature was made over.
pub fn append_signature(body: &[u8], signature: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(body.len() + signature.len() + 1);
    out.extend_from_slice(body);
    if !out.ends_with(b"\n") {
        out.push(b'\n');
    }
    out.extend_from_slice(signature.as_bytes());
    if !out.ends_with(b"\n") {
        out.push(b'\n');
    }
    out
}

/// Ensure a tag message ends in exactly one newline, the way `git tag` does.
///
/// Called before the object is created, not after, because the signature is made
/// over the object's bytes: normalizing afterwards would sign one body and store
/// another.
pub fn normalize_message(message: &str) -> String {
    let trimmed = message.trim_end_matches('\n');
    format!("{trimmed}\n")
}

/// Reject a ref component name before it reaches an argv or a refname.
///
/// Shared by [`validate_tag_name`] and [`validate_branch_name`]: both a tag and
/// a branch are a single path component under `refs/{tags,heads}/`, and
/// `git check-ref-format` applies the same rules to both. `noun` names the
/// caller in the error message ("tag" / "branch") so a rejected name still reads
/// like it came from the field the user typed it into.
///
/// Same class as `verify_commit`'s hex check and the D5 review's `git show`
/// finding: a leading `-` would be read as an option by every git command that
/// receives the name, and the name arrives from a text field. The rest mirrors
/// `git check-ref-format`, so a name we accept is one git can hold.
pub(crate) fn validate_ref_component(name: &str, noun: &str) -> AppResult<()> {
    let bad = |why: &str| Err(AppError::InvalidRef(format!("{name}: {why}")));

    if name.is_empty() {
        return bad(&format!("a {noun} needs a name"));
    }
    // An option, not a ref, to every git command that would receive it.
    if name.starts_with('-') {
        return bad(&format!("a {noun} name cannot start with '-'"));
    }
    if name.starts_with('/') || name.ends_with('/') || name.contains("//") {
        return bad(&format!("a {noun} name cannot have an empty path component"));
    }
    // A leading '.' is refused for the same reason "/." is: `check_refname_component`
    // rejects a component beginning with a dot, and the leading one is not covered
    // by the "/." test. `git check-ref-format refs/tags/.hidden` refuses it too.
    if name.starts_with('.')
        || name.ends_with('.')
        || name.ends_with(".lock")
        || name.contains("/.")
    {
        return bad(&format!("invalid {noun} name"));
    }
    if name.contains("..") || name.contains("@{") {
        return bad(&format!("invalid {noun} name"));
    }
    for ch in name.chars() {
        if ch.is_whitespace() || ch.is_control() {
            return bad(&format!(
                "a {noun} name cannot contain whitespace or control characters"
            ));
        }
        if matches!(ch, '~' | '^' | ':' | '?' | '*' | '[' | '\\' | '\x7f') {
            return bad(&format!(
                "a {noun} name cannot contain ~ ^ : ? * [ or backslash"
            ));
        }
    }
    Ok(())
}

/// Reject a tag name before it reaches an argv or a refname.
///
/// See [`validate_ref_component`] for the shared rule set.
pub fn validate_tag_name(name: &str) -> AppResult<()> {
    validate_ref_component(name, "tag")
}

/// Reject a branch name before it reaches an argv or a refname (#214).
///
/// Branches got no equivalent of [`validate_tag_name`]: `Libgit2Backend::create_branch`
/// and `rename_branch` passed the name straight to libgit2 and let the user see
/// whatever `git2::Error` came back. See [`validate_ref_component`] for the
/// shared rule set — identical to the tag rules, since both are a single path
/// component under a `refs/<kind>/` prefix.
pub fn validate_branch_name(name: &str) -> AppResult<()> {
    validate_ref_component(name, "branch")
}

/// GPG status tokens, in the order they are checked.
///
/// Mirrors git's `sigcheck_gpg_status` table (`gpg-interface.c`), except that the
/// order puts the compromising verdicts first: gpg emits these mutually
/// exclusively, so the order is only insurance, and the insurance should fall on
/// the side of not calling a bad signature good.
const GPG_STATUS: [(&str, SigState); 6] = [
    ("BADSIG ", SigState::Bad),
    ("REVKEYSIG ", SigState::Revoked),
    // X: the signature expired. Y: the key that made it expired. Both are real
    // signatures whose validity has lapsed — see parse_verify_output.
    ("EXPKEYSIG ", SigState::Expired),
    ("EXPSIG ", SigState::Expired),
    // Cannot be checked at all — typically NO_PUBKEY.
    ("ERRSIG ", SigState::UnknownKey),
    ("GOODSIG ", SigState::Good),
];

/// Parse `git verify-tag --raw` output into the shared [`SignatureStatus`].
///
/// **Not** `parse_verify_output`: that one reads git's already-digested
/// `%G?%x00%GS%x00%GK` triple, which is a commit-only format — `%G?` on a tag
/// reports the *commit's* signature, and `for-each-ref`'s `%(signature:grade)`
/// atom yields nothing for a tag object. `--raw` is the undigested signer output,
/// in one of two shapes depending on `gpg.format`.
///
/// `ok` is the subprocess's exit status. It refutes an SSH `Good` line paired
/// with an explicit failure (see below), and otherwise decides only output we do
/// not recognize, where an exit of 0 is git's own statement that the signature
/// graded `G` or `U`.
pub fn parse_verify_tag(raw: &str, ok: bool) -> SignatureStatus {
    // ── GPG: [GNUPG:] <TOKEN> <keyid> <username> ──────────────────────────────
    for (token, state) in GPG_STATUS {
        if let Some(rest) = gpg_status_line(raw, token) {
            let (key, signer) = split_key_and_signer(rest, token);
            return SignatureStatus { state, signer, key };
        }
    }

    // "No false Good" has to be a property of THIS function, not of the order a
    // signer happens to print in. OpenSSH 10.2 never prints a `Good` line
    // alongside a failure — but a build that emitted its verdict before its
    // checks would otherwise render a green "Signed" for a signature git
    // rejected. The legitimate untrusted-key case never carries this line: an
    // unmatched principal says "No principal matched." and a missing
    // allowed-signers file says "Unable to open allowed keys file …". So a failed
    // exit PLUS this line overrides any `Good` below.
    let refuted = !ok && raw.contains("Could not verify signature");

    // ── SSH: ssh-keygen's own wording, as git relays it ───────────────────────
    if !refuted {
        for line in raw.lines() {
            let line = line.trim();
            // Valid signature from a principal in the allowed-signers file.
            if let Some(rest) = line.strip_prefix("Good \"git\" signature for ") {
                let (signer, key) = split_ssh_principal(rest);
                return SignatureStatus {
                    state: SigState::Good,
                    signer,
                    key,
                };
            }
            // Valid signature, but the key is in NO allowed-signers file — either
            // none is configured (the common setup) or the principal did not
            // match. git grades this `U`.
            //
            // Reported as `UnknownKey` ("Signed, key unavailable"), NOT `Good`:
            // the signature is real but nothing here vouches for whose key made
            // it, and a tag is what people verify before trusting a release. The
            // two shapes are distinguishable — `signature for ` names a
            // principal, `signature with ` names only a fingerprint — so this is
            // information we have rather than a guess.
            //
            // NOTE: the COMMIT path still reports this as Good, because
            // `parse_verify_output` maps git's `U` that way. That gap is real and
            // deliberately not widened into this PR — see the spec.
            if let Some(rest) = line.strip_prefix("Good \"git\" signature with ") {
                return SignatureStatus {
                    state: SigState::UnknownKey,
                    signer: None,
                    key: ssh_key_fingerprint(rest),
                };
            }
        }
    }

    // No SSH `Revoked` branch on purpose. Measured against git 2.50.1 +
    // OpenSSH 10.2: a key revoked through `gpg.ssh.revocationFile` produces
    // exactly `Could not verify signature.` and exit 1 — ssh-keygen keeps the
    // reason behind `debug3_fr`, so neither a `Good` line nor the word "revoked"
    // ever reaches us. Matching on "revoked" looked safe and was simply dead.
    // GPG revocation is still reported, from `REVKEYSIG` in the table above.
    let lowered = raw.to_ascii_lowercase();
    if lowered.contains("could not verify signature")
        || lowered.contains("signature verification failed")
    {
        return SignatureStatus {
            state: SigState::Bad,
            signer: None,
            key: None,
        };
    }

    // Unrecognized. Callers only reach here for an object that DOES carry a
    // signature block, so `None` would be a lie. An exit of 0 is git's own
    // verdict of G or U; anything else is reported as "signed, could not be
    // checked" rather than as Bad, which would cry wolf.
    SignatureStatus {
        state: if ok {
            SigState::Good
        } else {
            SigState::UnknownKey
        },
        signer: None,
        key: None,
    }
}

/// The remainder of the first `[GNUPG:] <token>` line, if present.
///
/// The `[GNUPG:] ` prefix is REQUIRED, not optional. `git verify-tag --raw`
/// relays gpg's status-fd output verbatim, so every status line carries it;
/// accepting a bare `GOODSIG …` widened the match surface to any signer's
/// free-text output for no benefit.
fn gpg_status_line<'a>(raw: &'a str, token: &str) -> Option<&'a str> {
    raw.lines().find_map(|line| {
        line.trim()
            .strip_prefix("[GNUPG:] ")
            .and_then(|rest| rest.strip_prefix(token))
    })
}

/// `<keyid> <username>` → (key, signer). Either half may be absent.
///
/// `ERRSIG` is the exception and must be passed as such: its tail is gpg's
/// positional fields (`<pkalgo> <hashalgo> <sigclass> <time> <rc> <fpr>`), not a
/// name, so splitting on the first space yielded `signer = "1 8 00 … 9 -"` — and
/// `SignatureBadgeView` joins the signer into its tooltip, which then read
/// "Signed, key unavailable — 1 8 00 1755302400 9 — 4AEE18F83AFDEB23".
fn split_key_and_signer(rest: &str, token: &str) -> (Option<String>, Option<String>) {
    let rest = rest.trim();
    let (key, tail) = match rest.split_once(' ') {
        Some((key, tail)) => (non_empty(key), tail.trim()),
        None => (non_empty(rest), ""),
    };
    let signer = if token.starts_with("ERRSIG") {
        None
    } else {
        non_empty(tail)
    };
    (key, signer)
}

/// `<principal> with <type> key <fingerprint>` → (signer, key).
fn split_ssh_principal(rest: &str) -> (Option<String>, Option<String>) {
    match rest.split_once(" with ") {
        Some((principal, tail)) => (non_empty(principal.trim()), ssh_key_fingerprint(tail)),
        None => (non_empty(rest.trim()), None),
    }
}

/// `<type> key <fingerprint>` → the fingerprint.
fn ssh_key_fingerprint(tail: &str) -> Option<String> {
    tail.rsplit_once(" key ")
        .map(|(_, fp)| fp.trim())
        .and_then(non_empty)
}

fn non_empty(s: &str) -> Option<String> {
    (!s.trim().is_empty()).then(|| s.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ─── signature block detection ───────────────────────────────────────────

    #[test]
    fn detects_every_armor_header_git_knows() {
        for header in SIGNATURE_HEADERS {
            let msg = format!("release 1.0\n{header}\nabc\n");
            assert!(has_signature_block(&msg), "{header}");
        }
    }

    #[test]
    fn an_unsigned_message_has_no_signature_block() {
        assert!(!has_signature_block("release 1.0\n"));
        assert!(!has_signature_block(""));
    }

    #[test]
    fn a_header_mentioned_mid_line_is_not_a_signature() {
        // Otherwise a tag whose message talks about signing would be sent to
        // `git verify-tag` with nothing to verify.
        assert!(!has_signature_block(
            "we now emit -----BEGIN SSH SIGNATURE----- blocks\n"
        ));
    }

    // ─── appending ───────────────────────────────────────────────────────────

    #[test]
    fn append_signature_terminates_the_body_before_the_armor_header() {
        let out = append_signature(b"tagger x\n\nmsg", "-----BEGIN SSH SIGNATURE-----\nx\n");
        let s = String::from_utf8(out).unwrap();
        assert!(
            s.contains("msg\n-----BEGIN SSH SIGNATURE-----"),
            "armor header must start its own line: {s:?}"
        );
    }

    #[test]
    fn append_signature_does_not_double_the_newline() {
        let out = append_signature(b"body\n", "SIG\n");
        assert_eq!(String::from_utf8(out).unwrap(), "body\nSIG\n");
    }

    #[test]
    fn append_signature_terminates_an_unterminated_signature() {
        let out = append_signature(b"body\n", "SIG");
        assert_eq!(String::from_utf8(out).unwrap(), "body\nSIG\n");
    }

    #[test]
    fn normalize_message_gives_exactly_one_trailing_newline() {
        assert_eq!(normalize_message("hi"), "hi\n");
        assert_eq!(normalize_message("hi\n"), "hi\n");
        assert_eq!(normalize_message("hi\n\n\n"), "hi\n");
    }

    // ─── name validation ─────────────────────────────────────────────────────

    #[test]
    fn accepts_ordinary_tag_names() {
        for ok in ["v1.0.0", "release/2026-08", "v1.0.0-rc.1", "2026.08.16"] {
            validate_tag_name(ok).unwrap_or_else(|e| panic!("{ok} should be valid: {e:?}"));
        }
    }

    #[test]
    fn refuses_a_name_that_would_read_as_an_option() {
        // `git verify-tag --raw -- -v1` still puts it after `--`, but nothing
        // else in the app promises that, and a ref cannot start with '-' anyway.
        let err = validate_tag_name("-v1").expect_err("leading dash");
        assert!(matches!(err, AppError::InvalidRef(_)), "got {err:?}");
    }

    #[test]
    fn refuses_names_git_itself_would_refuse() {
        for bad in [
            "", "v1 0", "v1\n", "v1..v2", "v1~1", "v1^", "a:b", "v?", "v*", "a[b", "a\\b", "/v1",
            "v1/", "a//b", "v1.", "v1.lock", "a/.b", "HEAD@{0}",
            // `git check-ref-format refs/tags/.hidden` refuses this; the "/."
            // test above does not reach a LEADING dot.
            ".hidden", ".v1",
        ] {
            assert!(
                validate_tag_name(bad).is_err(),
                "{bad:?} should have been refused"
            );
        }
    }

    #[test]
    fn accepts_ordinary_branch_names() {
        for ok in ["feature/login", "v2", "release-2026-08", "a/b/c"] {
            validate_branch_name(ok).unwrap_or_else(|e| panic!("{ok} should be valid: {e:?}"));
        }
    }

    #[test]
    fn refuses_branch_names_git_itself_would_refuse() {
        // Same table as `refuses_names_git_itself_would_refuse`, using the
        // examples named in #214 (`foo bar`, `-foo`, `foo..bar`, `foo~1`, `.hidden`).
        for bad in [
            "", "foo bar", "-foo", "foo..bar", "foo~1", "foo^", "a:b", "foo?", "foo*", "a[b",
            "a\\b", "/foo", "foo/", "a//b", "foo.", "foo.lock", "a/.b", "HEAD@{0}", ".hidden",
        ] {
            assert!(
                validate_branch_name(bad).is_err(),
                "{bad:?} should have been refused"
            );
        }
    }

    #[test]
    fn branch_error_names_the_offending_field_as_a_branch_not_a_tag() {
        let err = validate_branch_name("foo bar").expect_err("space is invalid");
        match err {
            AppError::InvalidRef(msg) => {
                assert!(msg.contains("branch"), "message should say 'branch': {msg}");
            }
            other => panic!("expected InvalidRef, got {other:?}"),
        }
    }

    // ─── verify parsing: GPG ─────────────────────────────────────────────────

    #[test]
    fn parses_a_good_gpg_signature() {
        let raw = "[GNUPG:] NEWSIG\n\
                   [GNUPG:] GOODSIG 4AEE18F83AFDEB23 Ada Lovelace <ada@example.com>\n\
                   [GNUPG:] VALIDSIG ABCDEF 2026-08-16\n\
                   [GNUPG:] TRUST_ULTIMATE 0 pgp\n";
        let s = parse_verify_tag(raw, true);
        assert_eq!(s.state, SigState::Good);
        assert_eq!(s.key.as_deref(), Some("4AEE18F83AFDEB23"));
        assert_eq!(s.signer.as_deref(), Some("Ada Lovelace <ada@example.com>"));
    }

    #[test]
    fn parses_every_gpg_verdict() {
        for (token, want) in [
            ("BADSIG", SigState::Bad),
            ("EXPSIG", SigState::Expired),
            ("EXPKEYSIG", SigState::Expired),
            ("REVKEYSIG", SigState::Revoked),
            ("GOODSIG", SigState::Good),
        ] {
            let raw = format!("[GNUPG:] {token} DEADBEEF Ada <ada@x>\n");
            assert_eq!(parse_verify_tag(&raw, false).state, want, "{token}");
        }
    }

    #[test]
    fn an_unavailable_gpg_key_is_unknown_key_not_bad() {
        let raw = "[GNUPG:] ERRSIG 4AEE18F83AFDEB23 1 8 00 1755302400 9 -\n\
                   [GNUPG:] NO_PUBKEY 4AEE18F83AFDEB23\n";
        let s = parse_verify_tag(raw, false);
        assert_eq!(s.state, SigState::UnknownKey);
        assert_eq!(s.key.as_deref(), Some("4AEE18F83AFDEB23"));
        // ERRSIG's tail is positional fields, NOT a name. Rendering it put
        // "1 8 00 1755302400 9 -" in the badge tooltip where a signer belongs.
        assert!(
            s.signer.is_none(),
            "ERRSIG has no signer, got {:?}",
            s.signer
        );
    }

    #[test]
    fn a_bare_status_token_without_the_gnupg_prefix_is_not_a_verdict() {
        // `--raw` relays gpg's status-fd lines, which always carry the prefix.
        // Matching without it graded any signer's free text.
        let s = parse_verify_tag("GOODSIG DEADBEEF Ada <ada@x>\n", false);
        assert_eq!(s.state, SigState::UnknownKey, "must not grade Good");
    }

    #[test]
    fn a_bad_gpg_signature_wins_over_a_stray_goodsig() {
        // Insurance only — gpg emits these exclusively — but it must fall on the
        // side of not calling a bad signature good.
        let raw = "[GNUPG:] GOODSIG AAAA Ada <ada@x>\n[GNUPG:] BADSIG BBBB Eve <eve@x>\n";
        assert_eq!(parse_verify_tag(raw, false).state, SigState::Bad);
    }

    // ─── verify parsing: SSH (strings recorded from git 2.50.1) ──────────────

    #[test]
    fn parses_a_good_ssh_signature_from_a_known_principal() {
        let raw = "Good \"git\" signature for a@b.c with ED25519 key \
                   SHA256:neE70xxhPefYQsf3pgAkuuDiavk0lCNXdE7HXGLzENI\n";
        let s = parse_verify_tag(raw, true);
        assert_eq!(s.state, SigState::Good);
        assert_eq!(s.signer.as_deref(), Some("a@b.c"));
        assert_eq!(
            s.key.as_deref(),
            Some("SHA256:neE70xxhPefYQsf3pgAkuuDiavk0lCNXdE7HXGLzENI")
        );
    }

    #[test]
    fn an_ssh_key_outside_allowed_signers_is_not_reported_as_verified() {
        // A real signature, but nothing vouches for whose key made it — and a tag
        // is what people verify before trusting a release. Note git exits
        // NON-ZERO here while grading `U`, which is why the exit status alone
        // cannot classify either.
        //
        // Both spellings of "no principal": an allowed-signers file that does not
        // list the key, and no allowed-signers file at all.
        for raw in [
            "Good \"git\" signature with ED25519 key \
             SHA256:neE70xxhPefYQsf3pgAkuuDiavk0lCNXdE7HXGLzENI\n\
             No principal matched.\n",
            "Good \"git\" signature with ED25519 key \
             SHA256:neE70xxhPefYQsf3pgAkuuDiavk0lCNXdE7HXGLzENI\n\
             Unable to open allowed keys file \"\": No such file or directory\n\
             sig_find_principals: sshsig_find_principal: No such file or directory\n\
             No principal matched.\n",
        ] {
            let s = parse_verify_tag(raw, false);
            assert_eq!(s.state, SigState::UnknownKey, "{raw}");
            assert!(s.signer.is_none(), "no principal to name");
            assert_eq!(
                s.key.as_deref(),
                Some("SHA256:neE70xxhPefYQsf3pgAkuuDiavk0lCNXdE7HXGLzENI")
            );
        }
    }

    #[test]
    fn a_tampered_ssh_signature_is_bad() {
        // Also what a key revoked through gpg.ssh.revocationFile produces:
        // measured against git 2.50.1 + OpenSSH 10.2, revocation yields exactly
        // this line and exit 1 — no `Good` line and no "revoked" anywhere.
        let raw = "Could not verify signature.\n\
                   Signature verification failed: incorrect signature\n";
        assert_eq!(parse_verify_tag(raw, false).state, SigState::Bad);

        let revoked = "Could not verify signature.\n";
        assert_eq!(parse_verify_tag(revoked, false).state, SigState::Bad);
    }

    #[test]
    fn an_explicit_failure_overrides_a_good_line_above_it() {
        // Defence against a signer that printed its verdict before its checks:
        // "no false Good" must hold in the parser, not in ssh-keygen's ordering.
        let raw = "Good \"git\" signature for a@b.c with ED25519 key SHA256:abc\n\
                   Could not verify signature.\n";
        assert_eq!(parse_verify_tag(raw, false).state, SigState::Bad);
        // …but a clean exit is still trusted, so the guard cannot misfire on
        // output that merely mentions the phrase.
        assert_eq!(parse_verify_tag(raw, true).state, SigState::Good);
    }

    // ─── verify parsing: fallbacks ───────────────────────────────────────────

    #[test]
    fn unrecognized_output_never_reads_as_unsigned() {
        // The caller only gets here for an object that carries a signature
        // block, so None would be a lie; and Bad would cry wolf.
        assert_eq!(
            parse_verify_tag("something new from a future git\n", false).state,
            SigState::UnknownKey
        );
        assert_eq!(
            parse_verify_tag("something new from a future git\n", true).state,
            SigState::Good
        );
    }
}
