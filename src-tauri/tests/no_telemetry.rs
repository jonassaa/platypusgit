//! The backend half of issue 226: **the app makes no outbound request the
//! README does not disclose, and no analytics SDK is in the tree.**
//!
//! The README puts three promises in public, as the reason to pick this app
//! over the alternatives: no telemetry, no account, and no phoning home except
//! git remotes, the update check, and forge APIs the user configured. All three
//! are true today. Nothing *kept* them true — one transitive dependency that
//! "just" reports errors, or one well-meant "help us improve" toggle, and the
//! README is a lie that a competitor's users would be delighted to point out.
//!
//! Same shape as `spawn_no_window.rs` beside it: a test over the source text,
//! because the property is about what the tree *may contain*. Every exception
//! is a table entry with a reason, so the exception covers what it was granted
//! for and nothing more.
//!
//! **Split with the frontend half on purpose.** `test/privacy.test.ts` guards
//! `src/`, `package.json` and `pnpm-lock.yaml`; this file guards `src-tauri/`.
//! The split is not aesthetic — `tests.yml`'s `js` filter does not match
//! `src-tauri/`, and its `rust` filter does not match `README.md`, so a single
//! test covering both trees would be skipped by exactly the change it polices
//! on one side or the other. Keep each assertion in the half whose CI filter
//! already lists its inputs (see `docs/dev/testing.md`, "What CI runs").
//!
//! Limits, stated honestly: a denylist is not proof of absence. It catches the
//! realistic accident — someone adds a crate whose name says what it does — not
//! a deliberate exfiltration by someone who reads this file first. The hostname
//! scan reads code, not comments, and skips single-label authorities and
//! `format!` templates, because a host that arrives at runtime is the
//! self-hosted-forge case the design requires (`src/forge/`). What it does
//! guarantee: the set of hosts *baked into* the binary is the set argued for
//! below.

use std::path::{Path, PathBuf};

/// Crate-name fragments that mean "this reports usage somewhere". Matched
/// against every name in `Cargo.lock`, so a transitive arrival trips it too —
/// which is the arrival nobody would otherwise notice.
///
/// Tokens are matched against the name split on `-` and `_`; entries containing
/// a `-` are matched as a substring instead, for names that only make sense
/// whole (`dd-trace`). Verified against the current 530-crate lock with zero
/// false positives.
const TELEMETRY_CRATE_TOKENS: &[&str] = &[
    "analytics",
    "telemetry",
    "telemetrydeck",
    "tracking",
    "segment",
    "posthog",
    "mixpanel",
    "amplitude",
    "gtag",
    "googletagmanager",
    "google-analytics",
    "hotjar",
    "fullstory",
    "logrocket",
    "smartlook",
    "openreplay",
    "sentry",
    "bugsnag",
    "rollbar",
    "raygun",
    "airbrake",
    "appcenter",
    "datadog",
    "dd-trace",
    "newrelic",
    "instabug",
    "countly",
    "matomo",
    "piwik",
    "plausible",
    "umami",
    "fathom",
    "splitbee",
    "goatcounter",
    "pirsch",
    "aptabase",
    "snowplow",
    "mparticle",
    "statsig",
    "launchdarkly",
    "firebase",
    "crashlytics",
    "opentelemetry",
];

/// HTTP clients. Checked against the *direct* dependencies in `Cargo.toml`, not
/// against `Cargo.lock`: `reqwest` and `hyper` are both already in the lock,
/// pulled in by `tauri-plugin-updater` and `tauri` themselves, and forbidding
/// them there would be a test that fails on a dependency bump for no reason.
/// What matters is what *our* code can reach, and that is the direct set.
/// `tauri-plugin-http` is on the list for a different reason than the rest: it
/// is not a client OUR code would call, it is a client the WEBVIEW gets. Adding
/// it moves outbound traffic to the one place none of the Rust-side guards
/// below can see.
const HTTP_CLIENT_CRATES: &[&str] = &[
    "reqwest",
    "hyper",
    "isahc",
    "curl",
    "attohttpc",
    "surf",
    "awc",
    "http-client",
    "minreq",
    "tauri-plugin-http",
];

/// The only direct HTTP client, and the only files allowed to use it, with the
/// reason each one is an outbound call the README discloses. A third entry here
/// is a third thing the app phones, and the README's list stops being complete.
const OUTBOUND_HTTP_SITES: &[(&str, &str)] = &[
    (
        "src/update.rs",
        "The update check. It is an outbound call to us, it is disclosed on the \
         site and in the README, and it stays — the guard's job is to keep the \
         list of outbound calls at exactly the disclosed set, not to reach zero. \
         Unauthenticated GET of the latest release; dev/e2e builds never reach it.",
    ),
    (
        "src/forge/http.rs",
        "The optional pull-request integration. The only impure file in \
         `src/forge/` by construction (see its module doc): one https-only, \
         timed-out agent, talking to the forge host the USER configured with a \
         token the USER pasted. No forge is contacted until the user sets one up.",
    ),
];

/// Every hostname that may appear in backend code, and why it is not a
/// violation of the promise. Adding an entry is the review checkpoint: you are
/// writing down, in public, one more host this app knows about.
///
/// Deliberately short. Self-hosted forge hosts are user-supplied at runtime
/// (`src/forge/remote.rs` parses them off the git remote), so they never appear
/// here — do not let this list push anyone toward baking one in.
const ALLOWED_HOSTS: &[(&str, &str)] = &[
    (
        "api.github.com",
        "The two disclosed outbound calls: the update check (`src/update.rs`) \
         and the GitHub REST base for the optional PR integration \
         (`src/forge/github.rs`). GitHub Enterprise is derived from the user's \
         own host instead, which is why only the public API host is literal.",
    ),
    (
        "github.com",
        "Credential-prompt fixtures in the inline tests of `src/git/auth.rs` and \
         `src/cli.rs` — the askpass strings real git emits. Never requested. The \
         updater's DOWNLOAD endpoint is also on this host, but it lives in \
         `tauri.conf.json` and is pinned by its own test below.",
    ),
    (
        "git-lfs.github.com",
        "A literal inside the Git LFS pointer FILE FORMAT: every pointer starts \
         `version https://git-lfs.github.com/spec/v1`. It is a version \
         identifier we parse and print, not an address we resolve — see \
         `src/git/lfs.rs` and `GitBackend`'s pointer type in `src/git/types.rs`.",
    ),
    (
        "example.com",
        "RFC 2606 reserved. Fixtures for git's own stderr in the inline tests of \
         `src/commands/create.rs` and `src/git/auth.rs`. Cannot resolve.",
    ),
    (
        "example.invalid",
        "RFC 2606 reserved. An askpass prompt fixture in `src/detach.rs`. \
         Cannot resolve.",
    ),
];

/// The updater endpoints the README and the site disclose, verbatim. Changing
/// this list changes where the app phones home, which is a README change too.
const DISCLOSED_UPDATER_ENDPOINTS: &[&str] =
    &["https://github.com/jonassaa/platypusgit/releases/latest/download/latest.json"];

fn manifest_dir() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
}

fn read(rel: &str) -> String {
    let path = manifest_dir().join(rel);
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {rel}: {e}"))
}

fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(dir).expect("read src dir") {
        let path = entry.expect("dir entry").path();
        if path.is_dir() {
            rust_files(&path, out);
        } else if path.extension().and_then(|e| e.to_str()) == Some("rs") {
            out.push(path);
        }
    }
}

/// Every `.rs` file under `src/`, as (path relative to the crate root, contents).
fn sources() -> Vec<(String, String)> {
    let mut files = Vec::new();
    rust_files(&manifest_dir().join("src"), &mut files);
    files.sort();
    files
        .into_iter()
        .map(|p| {
            let rel = p
                .strip_prefix(manifest_dir())
                .expect("under the crate root")
                .to_string_lossy()
                // So the tables read the same on Windows.
                .replace('\\', "/");
            (rel, std::fs::read_to_string(&p).expect("read source"))
        })
        .collect()
}

/// Comment lines are not code, and this file's own tables would otherwise count
/// as violations of the rules they describe. Same helper as
/// `spawn_no_window.rs`; a URL in a trailing comment on a code line is still
/// scanned, which can only make the host check stricter.
fn code_only(body: &str) -> String {
    body.lines()
        .filter(|l| {
            let t = l.trim_start();
            !(t.starts_with("//") || t.starts_with("/*") || t.starts_with('*'))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn matches_token(name: &str, token: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    if token.contains('-') {
        return lower.contains(token);
    }
    lower
        .split(|c: char| c == '-' || c == '_' || c == '.')
        .any(|part| part == token)
}

/// Package names out of `Cargo.lock`'s `name = "…"` lines.
fn locked_crates() -> Vec<String> {
    read("Cargo.lock")
        .lines()
        .filter_map(|l| {
            let t = l.trim();
            t.strip_prefix("name = \"")
                .and_then(|r| r.strip_suffix('"'))
                .map(str::to_string)
        })
        .collect()
}

/// Keys of every `*dependencies` table in `Cargo.toml` — the crates our own
/// code may `use`, as opposed to what merely ended up in the lock.
fn direct_dependencies() -> Vec<String> {
    let mut out = Vec::new();
    let mut in_deps = false;
    for line in read("Cargo.toml").lines() {
        let t = line.trim();
        if t.starts_with('[') {
            in_deps = t.trim_end_matches(']').ends_with("dependencies");
            continue;
        }
        if !in_deps || t.starts_with('#') || t.is_empty() {
            continue;
        }
        if let Some((key, _)) = t.split_once('=') {
            out.push(key.trim().trim_matches('"').to_string());
        }
    }
    out
}

/// Hostnames literally present in `code`.
///
/// Skips two shapes on purpose. A single-label authority (`https://x/y.git`)
/// cannot be a public DNS name and only ever shows up in a fixture. A
/// `format!` template (`https://{host}/api/v3`) is a host supplied at runtime,
/// which is the self-hosted forge case the design requires — pinning those is
/// what the token and credential rules are for, not this test.
fn hosts_in(code: &str) -> Vec<String> {
    let mut out = Vec::new();
    for (idx, _) in code.match_indices("://") {
        let scheme = &code[..idx];
        if !(scheme.ends_with("http") || scheme.ends_with("https")) {
            continue;
        }
        let rest = &code[idx + 3..];
        let end = rest
            .find(|c: char| {
                c.is_whitespace()
                    || matches!(
                        c,
                        '/' | '?' | '#' | '"' | '\'' | '`' | '\\' | '<' | '>' | ')' | ',' | ';'
                    )
            })
            .unwrap_or(rest.len());
        let authority = &rest[..end];
        // `user:token@host` — the host is what is after the last `@`.
        let host_port = authority.rsplit('@').next().unwrap_or(authority);
        let host = host_port
            .split(':')
            .next()
            .unwrap_or(host_port)
            .trim_end_matches('.')
            .to_ascii_lowercase();
        if !host.contains('.') {
            continue;
        }
        if !host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
        {
            continue;
        }
        out.push(host);
    }
    out
}

#[test]
fn the_scan_actually_reads_the_backend() {
    // Every assertion below is vacuous if the walk breaks. Pinned low enough to
    // survive a refactor, high enough to catch an empty vector.
    let sources = sources();
    assert!(
        sources.len() > 30,
        "expected the whole backend tree, found {} file(s) — the walk is broken \
         and every other assertion in this file is passing for free",
        sources.len()
    );
    assert!(
        locked_crates().len() > 100,
        "Cargo.lock parsed to almost nothing; the denylist below is checking air"
    );
}

#[test]
fn the_matchers_can_actually_fail() {
    // A guard that cannot fail is worse than no guard: it reads like coverage.
    // These are the names the vendors actually ship under.
    for (name, token) in [
        ("sentry-core", "sentry"),
        ("posthog", "posthog"),
        ("tauri-plugin-aptabase", "aptabase"),
        ("opentelemetry-otlp", "opentelemetry"),
        ("dd-trace-rs", "dd-trace"),
        ("segment_analytics", "analytics"),
    ] {
        assert!(matches_token(name, token), "{name} should match `{token}`");
    }
    // And it does not cry wolf on ordinary names that merely contain the
    // letters — an exception added to silence a false alarm is an exception
    // added without thought, which is the failure mode this whole file guards.
    for name in ["tauri-plugin-log", "grapheme-segmenter", "git2", "heapless"] {
        assert!(
            TELEMETRY_CRATE_TOKENS.iter().all(|t| !matches_token(name, t)),
            "{name} should not trip the denylist"
        );
    }

    assert_eq!(
        hosts_in("const U: &str = \"https://tracker.example.net/collect\";"),
        vec!["tracker.example.net"],
        "the scanner must see a plain URL literal"
    );
    assert_eq!(
        hosts_in("\"https://user:token@api.github.com/repos\""),
        vec!["api.github.com"],
        "userinfo must not hide the host"
    );
    let none: Vec<String> = Vec::new();
    assert_eq!(
        hosts_in("format!(\"https://{host}/api/v3\")"),
        none,
        "a runtime host is not a baked-in one"
    );
    assert_eq!(hosts_in("\"https://x/y.git\""), none, "single-label fixture");
    assert_eq!(hosts_in("\"ssh://git@example.org/x\""), none, "not http(s)");

    assert_eq!(
        network_permission_in(&["http:default".to_string()]),
        Some("http:default".to_string())
    );
    assert_eq!(
        network_permission_in(&["dialog:default".to_string(), "os:default".to_string()]),
        None
    );
}

#[test]
fn no_analytics_or_telemetry_crate_in_the_dependency_tree() {
    let offenders: Vec<String> = locked_crates()
        .into_iter()
        .filter_map(|name| {
            TELEMETRY_CRATE_TOKENS
                .iter()
                .find(|t| matches_token(&name, t))
                .map(|t| format!("{name} (matched `{t}`)"))
        })
        .collect();

    assert!(
        offenders.is_empty(),
        "a usage-reporting crate reached Cargo.lock:\n  {}\n\nThe README promises \
         \"no telemetry\" and \"no analytics SDK anywhere in the tree\" as a reason \
         to choose this app. You are not fighting a lint rule — you are changing \
         what the project promises. If this is deliberate, change the README in \
         the SAME commit and then add the crate here with the reason. If it \
         arrived transitively, that is the accident this test exists to catch.",
        offenders.join("\n  ")
    );
}

#[test]
fn ureq_is_the_only_direct_http_client() {
    let direct = direct_dependencies();
    let offenders: Vec<&String> = direct
        .iter()
        .filter(|d| HTTP_CLIENT_CRATES.iter().any(|c| matches_token(d, c)))
        .collect();

    assert!(
        offenders.is_empty(),
        "a second HTTP client is now a direct dependency: {offenders:?}. The app \
         has exactly two outbound HTTP call sites and both go through `ureq`; a \
         new client is a new way to phone somewhere, so it needs an entry in \
         OUTBOUND_HTTP_SITES and a line in the README's disclosure."
    );
    assert!(
        direct.iter().any(|d| d == "ureq"),
        "`ureq` is gone from Cargo.toml — if the HTTP client changed, this test's \
         OUTBOUND_HTTP_SITES check is now looking for a marker that no longer \
         exists and is passing for free"
    );
}

#[test]
fn outbound_http_lives_only_in_the_disclosed_call_sites() {
    let sources = sources();
    let mut unexpected: Vec<String> = Vec::new();

    for (rel, body) in &sources {
        if code_only(body).contains("ureq::")
            && !OUTBOUND_HTTP_SITES.iter().any(|(f, _)| f == rel)
        {
            unexpected.push(rel.clone());
        }
    }

    assert!(
        unexpected.is_empty(),
        "a new outbound HTTP call site:\n  {}\n\nThe README lists the app's \
         outbound traffic as: your git remotes, the update check, and forge APIs \
         you configured. A third call site means that list is incomplete. Add it \
         to OUTBOUND_HTTP_SITES with the reason and update the README's \
         disclosure in the same commit.",
        unexpected.join("\n  ")
    );

    // And each disclosed site still makes the call — a dead entry would let a
    // future one be added without argument.
    for (rel, why) in OUTBOUND_HTTP_SITES {
        let body = sources
            .iter()
            .find(|(f, _)| f == rel)
            .map(|(_, b)| b)
            .unwrap_or_else(|| panic!("{rel} is allow-listed but does not exist"));
        assert!(
            code_only(body).contains("ureq::"),
            "{rel} no longer makes an HTTP call. Reason on record: {why}"
        );
    }
}

#[test]
fn every_hard_coded_host_is_allow_listed() {
    let mut offenders: Vec<String> = Vec::new();
    let mut seen: Vec<String> = Vec::new();

    for (rel, body) in sources() {
        for host in hosts_in(&code_only(&body)) {
            if !seen.contains(&host) {
                seen.push(host.clone());
            }
            if !ALLOWED_HOSTS.iter().any(|(h, _)| *h == host) {
                offenders.push(format!("{rel}: {host}"));
            }
        }
    }

    offenders.sort();
    offenders.dedup();
    assert!(
        offenders.is_empty(),
        "a hostname is baked into the backend that nobody has argued for:\n  {}\n\n\
         The README promises the only outbound traffic is your git remotes, the \
         update check, and forge APIs you configured. Add the host to \
         ALLOWED_HOSTS with a comment saying WHY it is legitimate — that comment \
         is the review checkpoint this test exists to create. If the host is a \
         self-hosted forge, it should be read off the user's remote at runtime \
         (`src/forge/remote.rs`), never baked in.",
        offenders.join("\n  ")
    );

    // A stale entry is a hole: it lets a host be reintroduced later without
    // anyone arguing for it, because the argument is already sitting here.
    for (host, why) in ALLOWED_HOSTS {
        assert!(
            seen.iter().any(|h| h == host),
            "`{host}` is allow-listed but no longer appears in the backend; drop \
             the entry. Reason on record: {why}"
        );
    }
}

#[test]
fn the_updater_endpoint_is_exactly_the_disclosed_one() {
    let conf = read("tauri.conf.json");
    let parsed: serde_json::Value =
        serde_json::from_str(&conf).expect("tauri.conf.json is valid JSON");
    let endpoints = parsed["plugins"]["updater"]["endpoints"]
        .as_array()
        .expect("plugins.updater.endpoints is an array")
        .iter()
        .map(|v| v.as_str().expect("endpoint is a string").to_string())
        .collect::<Vec<_>>();

    assert_eq!(
        endpoints, DISCLOSED_UPDATER_ENDPOINTS,
        "the updater endpoints changed. This is the ONE request the app makes to \
         us, and the README and site disclose it verbatim; a second endpoint, or \
         a different host, is a change to what the project promises. Update the \
         disclosure in the same commit."
    );
}

/// The first permission id in `ids` that hands the webview a network client of
/// its own, if any. Split out from the test so it can be shown to fail on an
/// input the real tree does not contain.
fn network_permission_in(ids: &[String]) -> Option<String> {
    ids.iter()
        .find(|id| id.starts_with("http:") || id.starts_with("shell:allow-execute"))
        .cloned()
}

#[test]
fn the_webview_is_granted_no_network_capability() {
    // Defence in depth, and it is worth saying which layer this is.
    // `tauri-build` already refuses an unknown permission id, so `http:default`
    // cannot be added without also adding `tauri-plugin-http` — which the test
    // above catches. This one catches the case where the plugin IS a legitimate
    // dependency later and the permission is granted quietly alongside it. A
    // webview-side client routes around every Rust-side guard in this file, the
    // README's disclosure, and the credential rules in one move.
    let dir = manifest_dir().join("capabilities");
    let mut checked = 0;
    for entry in std::fs::read_dir(&dir).expect("read capabilities dir") {
        let path = entry.expect("dir entry").path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        let body = std::fs::read_to_string(&path).expect("read capability");
        let parsed: serde_json::Value =
            serde_json::from_str(&body).unwrap_or_else(|e| panic!("{name}: {e}"));
        let ids: Vec<String> = parsed["permissions"]
            .as_array()
            .unwrap_or_else(|| panic!("{name}: permissions is not an array"))
            .iter()
            .filter_map(|p| p.as_str().map(str::to_string))
            .collect();
        assert!(!ids.is_empty(), "{name} lists no permissions at all");
        assert_eq!(
            network_permission_in(&ids),
            None,
            "{name} hands the webview its own way out to the network"
        );
        checked += 1;
    }
    assert!(checked >= 2, "expected the default and updater capabilities");
}
