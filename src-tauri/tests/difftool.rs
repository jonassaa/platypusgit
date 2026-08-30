//! `git difftool` — the plan, and a real run (#235).
//!
//! Two halves, and the second is the one that matters.
//!
//! The plan tests pin what we decide: which revisions a target resolves to, that
//! a root commit gets the empty tree rather than a diff against the working
//! tree, that a pathspec cannot leave the worktree. They can be asserted from
//! the values alone.
//!
//! The end-to-end tests pin what we DON'T decide. The feature's central promise
//! is "respect `diff.tool` / `difftool.*` from git config", and that promise is
//! kept by shelling out rather than by any code of ours — so the only honest
//! proof is a real repository, a real `diff.tool`, and a real tool that leaves
//! evidence. They also prove the three flags the argv builder cannot:
//! `--no-prompt` really does suppress the prompt, `--` really does scope the
//! run to one file, and `--tool=` really does outrank `diff.tool`.

mod support;

use std::path::{Path, PathBuf};

use platypusgit_lib::error::AppError;
use platypusgit_lib::git::difftool::{difftool_args, normalize_tool, DiffSpec};
use platypusgit_lib::git::types::{DiffToolTarget, RepoId};
use platypusgit_lib::git::GitBackend;
use support::TempRepo;

fn paths(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| s.to_string()).collect()
}

// ═══════════════════════════════════════════════════════════════════════════
// THE PLAN
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn a_worktree_target_passes_no_revisions_and_scopes_to_the_path() {
    let tr = TempRepo::with_initial_commit("one\n");
    let (backend, handle) = tr.open_with_backend();

    let plan = backend
        .difftool_plan(
            &handle.id,
            &DiffToolTarget::Worktree,
            &paths(&["README.md"]),
            None,
        )
        .expect("plan");

    assert_eq!(plan.tool, None, "nothing configured means git decides");
    assert_eq!(
        plan.args,
        vec!["difftool", "--no-prompt", "--gui", "--", "README.md"]
    );
    assert_eq!(
        plan.workdir.canonicalize().unwrap(),
        tr.path().canonicalize().unwrap()
    );
}

#[test]
fn a_staged_target_is_the_index_side() {
    let tr = TempRepo::with_initial_commit("one\n");
    let (backend, handle) = tr.open_with_backend();

    let plan = backend
        .difftool_plan(
            &handle.id,
            &DiffToolTarget::Staged,
            &paths(&["README.md"]),
            None,
        )
        .expect("plan");

    assert!(plan.args.contains(&"--cached".to_string()), "{:?}", plan.args);
}

#[test]
fn a_commit_target_resolves_its_first_parent() {
    let tr = TempRepo::with_initial_commit("one\n");
    tr.add_commit("README.md", "two\n", "second");
    let (backend, handle) = tr.open_with_backend();

    let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
    let parent = head.parent(0).unwrap();

    let plan = backend
        .difftool_plan(
            &handle.id,
            &DiffToolTarget::Commit {
                oid: head.id().to_string(),
            },
            &paths(&["README.md"]),
            None,
        )
        .expect("plan");

    let sep = plan.args.iter().position(|a| a == "--").unwrap();
    assert_eq!(
        &plan.args[sep - 2..sep],
        [parent.id().to_string(), head.id().to_string()],
        "old then new, both resolved: {:?}",
        plan.args
    );
}

/// The trap this whole `Commit` variant exists for.
///
/// `<oid>^` fails to resolve at a root commit, and `<oid>^!` — git's own
/// documented "changes on this commit" shorthand — silently degrades to
/// `git diff <oid>`, which diffs the commit against the WORKING TREE. Verified
/// against git 2.50 before this variant was written. The empty tree is the pair
/// `git show` uses, and it is the only one that is neither an error nor a lie.
#[test]
fn a_root_commit_diffs_against_the_empty_tree_not_the_working_tree() {
    let tr = TempRepo::with_initial_commit("one\n");
    let (backend, handle) = tr.open_with_backend();

    let root = tr.repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(root.parent_count(), 0, "fixture must be a root commit");

    let plan = backend
        .difftool_plan(
            &handle.id,
            &DiffToolTarget::Commit {
                oid: root.id().to_string(),
            },
            &paths(&["README.md"]),
            None,
        )
        .expect("plan");

    let sep = plan.args.iter().position(|a| a == "--").unwrap();
    let old = &plan.args[sep - 2];
    let new = &plan.args[sep - 1];
    assert_eq!(new, &root.id().to_string());
    assert_ne!(old, &root.id().to_string(), "two sides, not one");
    // It is a tree, it is empty, and it exists — so git can read it.
    let oid = git2::Oid::from_str(old).expect("an oid");
    let tree = tr.repo.find_tree(oid).expect("the empty tree is written");
    assert_eq!(tree.len(), 0);
}

#[test]
fn a_range_target_resolves_both_revisions_to_oids() {
    let tr = TempRepo::with_initial_commit("one\n");
    tr.add_commit("README.md", "two\n", "second");
    let (backend, handle) = tr.open_with_backend();

    let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
    let parent = head.parent(0).unwrap();

    let plan = backend
        .difftool_plan(
            &handle.id,
            &DiffToolTarget::Range {
                from: parent.id().to_string(),
                to: "HEAD".into(),
            },
            &paths(&["README.md"]),
            None,
        )
        .expect("plan");

    // Still the same two commits, in git's own old-then-new order — the
    // resolution changes the SPELLING, never the pair.
    let sep = plan.args.iter().position(|a| a == "--").unwrap();
    assert_eq!(
        &plan.args[sep - 2..sep],
        [parent.id().to_string(), head.id().to_string()]
    );
}

/// A branch name resolves to the commit it points at, so the argv never carries
/// the name — which is what makes the option-injection shape unrepresentable
/// rather than merely unlikely.
#[test]
fn a_range_named_by_refs_still_resolves_to_the_same_two_commits() {
    let tr = TempRepo::with_initial_commit("one\n");
    tr.add_commit("README.md", "two\n", "second");
    let (backend, handle) = tr.open_with_backend();
    let head = tr.repo.head().unwrap().peel_to_commit().unwrap();

    let plan = backend
        .difftool_plan(
            &handle.id,
            &DiffToolTarget::Range {
                from: "main".into(),
                to: "HEAD".into(),
            },
            &paths(&["README.md"]),
            None,
        )
        .expect("plan");

    let sep = plan.args.iter().position(|a| a == "--").unwrap();
    assert_eq!(
        &plan.args[sep - 2..sep],
        [head.id().to_string(), head.id().to_string()],
        "both name the same commit here; neither reaches argv as a name"
    );
    assert!(
        !plan.args.contains(&"main".to_string()),
        "a ref NAME must not survive into argv: {:?}",
        plan.args
    );
}

#[test]
fn a_rev_to_worktree_target_resolves_its_one_revision() {
    let tr = TempRepo::with_initial_commit("one\n");
    let (backend, handle) = tr.open_with_backend();
    let head = tr.repo.head().unwrap().peel_to_commit().unwrap();

    let plan = backend
        .difftool_plan(
            &handle.id,
            &DiffToolTarget::RevToWorktree { rev: "HEAD".into() },
            &paths(&["README.md"]),
            None,
        )
        .expect("plan");

    let sep = plan.args.iter().position(|a| a == "--").unwrap();
    assert_eq!(&plan.args[sep - 1..sep], [head.id().to_string()]);
}

/// **A revision that looks like an option is refused, never passed through.**
///
/// `git difftool` requires its revisions AHEAD of `--`, so the separator that
/// protects the pathspecs cannot protect these: a `--output=/tmp/x` in a
/// revision slot sits in an option position. Every rev therefore goes through
/// `revparse_single`, and a string that is not a revision fails there — the same
/// refusal `git/tag.rs`, `forge/mod.rs` and `ssh.rs` make for their own argv.
#[test]
fn a_revision_that_looks_like_an_option_is_refused() {
    let tr = TempRepo::with_initial_commit("one\n");
    let (backend, handle) = tr.open_with_backend();
    let head = tr.repo.head().unwrap().peel_to_commit().unwrap().id().to_string();

    let hostile = ["--output=/tmp/pgpwn", "-c", "--exit-code", "-"];
    let mut targets: Vec<DiffToolTarget> = Vec::new();
    for bad in hostile {
        targets.push(DiffToolTarget::Range {
            from: bad.into(),
            to: head.clone(),
        });
        // The SECOND slot too: a guard on the first only would leave half the
        // shape open.
        targets.push(DiffToolTarget::Range {
            from: head.clone(),
            to: bad.into(),
        });
        targets.push(DiffToolTarget::RevToWorktree { rev: bad.into() });
        targets.push(DiffToolTarget::Commit { oid: bad.into() });
    }

    for target in targets {
        let err = backend
            .difftool_plan(&handle.id, &target, &paths(&["README.md"]), None)
            .expect_err(&format!("must refuse {target:?}"));
        assert!(
            matches!(err, AppError::InvalidRef(_)),
            "{target:?} gave {err:?}"
        );
    }
}

/// The invariant behind all of the above, asserted over every target shape at
/// once: **nothing between the options and `--` is anything but a hex oid.**
///
/// Written as a property rather than as another example because a new
/// `DiffToolTarget` variant is exactly the change that would reintroduce a
/// pass-through, and this fails for it without anyone remembering to come back
/// here.
#[test]
fn every_revision_reaching_argv_is_a_hex_oid() {
    let tr = TempRepo::with_initial_commit("one\n");
    tr.add_commit("README.md", "two\n", "second");
    let (backend, handle) = tr.open_with_backend();
    let head = tr.repo.head().unwrap().peel_to_commit().unwrap().id().to_string();

    let targets = [
        DiffToolTarget::Worktree,
        DiffToolTarget::Staged,
        DiffToolTarget::Commit { oid: head.clone() },
        DiffToolTarget::Range {
            from: "main".into(),
            to: "HEAD".into(),
        },
        DiffToolTarget::RevToWorktree { rev: "HEAD".into() },
    ];

    // Every flag the builder is allowed to emit. Anything else ahead of `--`
    // came from a caller.
    let ours = ["difftool", "--no-prompt", "--gui", "--cached"];

    for target in targets {
        for tool in [None, Some("meld")] {
            let plan = backend
                .difftool_plan(&handle.id, &target, &paths(&["README.md"]), tool)
                .expect("plan");
            let sep = plan.args.iter().position(|a| a == "--").expect("separator");
            for arg in &plan.args[..sep] {
                if ours.contains(&arg.as_str()) || arg.starts_with("--tool=") {
                    continue;
                }
                assert!(
                    arg.len() == 40 && arg.chars().all(|c| c.is_ascii_hexdigit()),
                    "{target:?}: {arg:?} is not a hex oid and is not one of our \
                     own flags — a caller-supplied string reached an option \
                     position. Full argv: {:?}",
                    plan.args
                );
            }
        }
    }
}

#[test]
fn a_path_outside_the_worktree_is_refused() {
    let tr = TempRepo::with_initial_commit("one\n");
    let (backend, handle) = tr.open_with_backend();

    for bad in ["../escape", "/etc/passwd", ""] {
        let err = backend
            .difftool_plan(
                &handle.id,
                &DiffToolTarget::Worktree,
                &paths(&[bad]),
                None,
            )
            .expect_err("must refuse {bad}");
        assert!(matches!(err, AppError::InvalidPath(_)), "{bad}: {err:?}");
    }
}

#[test]
fn a_batch_is_refused_whole_when_one_path_escapes() {
    // The same all-or-nothing rule `delete_untracked` makes (#245): validate the
    // batch, then act. Half an argv is not a smaller version of the request.
    let tr = TempRepo::with_initial_commit("one\n");
    let (backend, handle) = tr.open_with_backend();

    let err = backend
        .difftool_plan(
            &handle.id,
            &DiffToolTarget::Worktree,
            &paths(&["README.md", "../escape"]),
            None,
        )
        .expect_err("must refuse");
    assert!(matches!(err, AppError::InvalidPath(_)), "{err:?}");
}

#[test]
fn an_empty_path_list_is_refused() {
    let tr = TempRepo::with_initial_commit("one\n");
    let (backend, handle) = tr.open_with_backend();

    let err = backend
        .difftool_plan(&handle.id, &DiffToolTarget::Worktree, &[], None)
        .expect_err("must refuse");
    assert!(matches!(err, AppError::InvalidArgument(_)), "{err:?}");
}

#[test]
fn a_bad_tool_name_is_refused_before_the_repository_is_touched() {
    // Asserted against an id no repository was ever opened under: reaching
    // `UnknownRepo` would mean the name was validated too late.
    let backend = platypusgit_lib::git::libgit2::Libgit2Backend::new();
    let err = backend
        .difftool_plan(
            &RepoId("never-opened".into()),
            &DiffToolTarget::Worktree,
            &paths(&["a"]),
            Some("bcompare $LOCAL $REMOTE"),
        )
        .expect_err("must refuse");
    assert!(matches!(err, AppError::InvalidArgument(_)), "{err:?}");
}

#[test]
fn an_unresolvable_commit_is_an_invalid_ref_not_a_bare_git_error() {
    let tr = TempRepo::with_initial_commit("one\n");
    let (backend, handle) = tr.open_with_backend();

    let err = backend
        .difftool_plan(
            &handle.id,
            &DiffToolTarget::Commit {
                oid: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef".into(),
            },
            &paths(&["README.md"]),
            None,
        )
        .expect_err("must refuse");
    assert!(matches!(err, AppError::InvalidRef(_)), "{err:?}");
}

#[test]
fn the_settings_override_reaches_the_argv() {
    let tr = TempRepo::with_initial_commit("one\n");
    let (backend, handle) = tr.open_with_backend();

    let plan = backend
        .difftool_plan(
            &handle.id,
            &DiffToolTarget::Worktree,
            &paths(&["README.md"]),
            Some("  meld  "),
        )
        .expect("plan");

    assert_eq!(plan.tool.as_deref(), Some("meld"));
    assert!(plan.args.contains(&"--tool=meld".to_string()), "{:?}", plan.args);
    // git refuses `--gui` beside `--tool`; the builder must never emit both.
    assert!(!plan.args.contains(&"--gui".to_string()), "{:?}", plan.args);
}

#[test]
fn normalize_tool_is_the_one_gate_on_the_settings_field() {
    assert_eq!(normalize_tool(Some("")).unwrap(), None);
    assert_eq!(normalize_tool(Some("kdiff3")).unwrap().as_deref(), Some("kdiff3"));
    assert!(normalize_tool(Some("a b")).is_err());
}

#[test]
fn the_argv_builder_is_reachable_and_pure() {
    // The module's own unit tests cover the matrix; this only pins that the
    // builder is part of the crate's public surface, which is what lets the
    // end-to-end tests below run a plan without a Tauri command.
    let spec = DiffSpec {
        cached: false,
        revs: vec!["a".into()],
    };
    assert_eq!(
        difftool_args(&spec, None, &paths(&["p"])),
        vec!["difftool", "--no-prompt", "--gui", "a", "--", "p"]
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// A REAL RUN
// ═══════════════════════════════════════════════════════════════════════════

/// Is `git difftool` usable here?
///
/// It ships with git, but it is a separate script and a stripped-down
/// installation can lack it. Skipped rather than failed for the same reason the
/// gpg and git-lfs suites skip: a missing optional binary is an environment
/// fact, not a regression.
fn difftool_available() -> bool {
    platypusgit_lib::proc::git(Path::new("."))
        .arg("difftool")
        .arg("--tool-help")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Point `diff.tool` at a tool that leaves evidence instead of a window.
///
/// `difftool.<tool>.cmd` is run by git through a shell with `$LOCAL` and
/// `$REMOTE` set to the two sides, which is exactly the contract a real tool is
/// invoked under — so a tool that copies them into a marker file proves the
/// whole chain: config read, sides extracted, tool launched.
fn configure_fake_tool(root: &Path, name: &str, marker: &str) {
    let repo = git2::Repository::open(root).unwrap();
    let mut cfg = repo.config().unwrap();
    cfg.set_str(
        &format!("difftool.{name}.cmd"),
        // Appends, so a run over two files is visible as two records.
        &format!("cat \"$LOCAL\" >> {marker}; echo '---' >> {marker}; cat \"$REMOTE\" >> {marker}"),
    )
    .unwrap();
}

/// Run a plan the way the Tauri command does, minus the console handling — the
/// spawner differs only in the Windows console flag, which no assertion here is
/// about.
fn run(plan: &platypusgit_lib::git::difftool::DiffToolPlan) -> std::process::Output {
    let (key, value) = platypusgit_lib::git::stash::LITERAL_PATHSPECS;
    platypusgit_lib::proc::git(&plan.workdir)
        .args(&plan.args)
        .env(key, value)
        .output()
        .expect("spawn git difftool")
}

fn marker_body(root: &Path, marker: &str) -> String {
    std::fs::read_to_string(root.join(marker)).unwrap_or_default()
}

#[test]
fn diff_tool_from_git_config_is_what_actually_runs() {
    if !difftool_available() {
        eprintln!("skipping: `git difftool` is not available here");
        return;
    }
    let tr = TempRepo::with_initial_commit("committed\n");
    configure_fake_tool(tr.path(), "pgfake", "marker.txt");
    {
        let repo = git2::Repository::open(tr.path()).unwrap();
        repo.config().unwrap().set_str("diff.tool", "pgfake").unwrap();
    }
    // An unstaged change, so there is something for the tool to be given.
    support::fs::write_file(tr.path(), "README.md", "edited\n");
    // A second changed file the run must NOT touch — that is what `--` buys.
    support::fs::write_file(tr.path(), "other.md", "untracked\n");
    tr.add_commit("other.md", "other v1\n", "add other");
    support::fs::write_file(tr.path(), "other.md", "other v2\n");

    let (backend, handle) = tr.open_with_backend();
    let plan = backend
        .difftool_plan(
            &handle.id,
            &DiffToolTarget::Worktree,
            &paths(&["README.md"]),
            None,
        )
        .expect("plan");

    let out = run(&plan);
    assert!(
        out.status.success(),
        "git difftool failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );

    let body = marker_body(tr.path(), "marker.txt");
    assert!(
        body.contains("committed") && body.contains("edited"),
        "the configured tool saw both sides: {body:?}"
    );
    assert!(
        !body.contains("other v"),
        "`--` must scope the run to the one path: {body:?}"
    );
}

#[test]
fn the_tool_override_outranks_diff_tool() {
    if !difftool_available() {
        eprintln!("skipping: `git difftool` is not available here");
        return;
    }
    let tr = TempRepo::with_initial_commit("committed\n");
    configure_fake_tool(tr.path(), "chosen", "chosen.txt");
    configure_fake_tool(tr.path(), "configured", "configured.txt");
    {
        let repo = git2::Repository::open(tr.path()).unwrap();
        repo.config()
            .unwrap()
            .set_str("diff.tool", "configured")
            .unwrap();
    }
    support::fs::write_file(tr.path(), "README.md", "edited\n");

    let (backend, handle) = tr.open_with_backend();
    let plan = backend
        .difftool_plan(
            &handle.id,
            &DiffToolTarget::Worktree,
            &paths(&["README.md"]),
            Some("chosen"),
        )
        .expect("plan");

    let out = run(&plan);
    assert!(
        out.status.success(),
        "git difftool failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(
        !marker_body(tr.path(), "chosen.txt").is_empty(),
        "the override should have run"
    );
    assert!(
        marker_body(tr.path(), "configured.txt").is_empty(),
        "diff.tool should have been overridden, not merged"
    );
}

#[test]
fn a_commits_own_diff_reaches_the_tool_with_both_sides() {
    if !difftool_available() {
        eprintln!("skipping: `git difftool` is not available here");
        return;
    }
    let tr = TempRepo::with_initial_commit("v1\n");
    tr.add_commit("README.md", "v2\n", "second");
    configure_fake_tool(tr.path(), "pgfake", "marker.txt");
    {
        let repo = git2::Repository::open(tr.path()).unwrap();
        repo.config().unwrap().set_str("diff.tool", "pgfake").unwrap();
    }

    let (backend, handle) = tr.open_with_backend();
    let head = tr.repo.head().unwrap().peel_to_commit().unwrap().id();
    let plan = backend
        .difftool_plan(
            &handle.id,
            &DiffToolTarget::Commit {
                oid: head.to_string(),
            },
            &paths(&["README.md"]),
            None,
        )
        .expect("plan");

    let out = run(&plan);
    assert!(
        out.status.success(),
        "git difftool failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    // Both sides are blobs in the ODB, not files — this is the case the whole
    // "shell out rather than materialise" decision was made for.
    let body = marker_body(tr.path(), "marker.txt");
    assert!(body.contains("v1") && body.contains("v2"), "{body:?}");
}

/// The `--cached` shape, run for real.
///
/// It is the one target whose argv puts an extra option ahead of the
/// `--gui`/`--tool` slot, and the only way to know git is happy with that
/// ordering is to run it. The tell is deliberate: the worktree copy differs from
/// BOTH the index and HEAD, so a run that reached the working tree by mistake
/// would show `worktree only` and this would catch it.
#[test]
fn a_staged_target_reaches_the_tool_as_the_index_against_head() {
    if !difftool_available() {
        eprintln!("skipping: `git difftool` is not available here");
        return;
    }
    let tr = TempRepo::with_initial_commit("committed\n");
    support::fs::write_file(tr.path(), "README.md", "staged\n");
    {
        let (backend, handle) = tr.open_with_backend();
        backend
            .stage(&handle.id, &[PathBuf::from("README.md")])
            .expect("stage");
    }
    support::fs::write_file(tr.path(), "README.md", "worktree only\n");

    configure_fake_tool(tr.path(), "pgfake", "marker.txt");
    {
        let repo = git2::Repository::open(tr.path()).unwrap();
        repo.config().unwrap().set_str("diff.tool", "pgfake").unwrap();
    }

    let (backend, handle) = tr.open_with_backend();
    let plan = backend
        .difftool_plan(
            &handle.id,
            &DiffToolTarget::Staged,
            &paths(&["README.md"]),
            None,
        )
        .expect("plan");

    let out = run(&plan);
    assert!(
        out.status.success(),
        "git difftool failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let body = marker_body(tr.path(), "marker.txt");
    assert!(
        body.contains("committed") && body.contains("staged"),
        "the index against HEAD: {body:?}"
    );
    assert!(
        !body.contains("worktree only"),
        "`--cached` must not reach the working tree: {body:?}"
    );
}

#[test]
fn a_root_commits_diff_shows_the_file_as_added_not_as_the_worktree() {
    if !difftool_available() {
        eprintln!("skipping: `git difftool` is not available here");
        return;
    }
    let tr = TempRepo::with_initial_commit("original\n");
    configure_fake_tool(tr.path(), "pgfake", "marker.txt");
    {
        let repo = git2::Repository::open(tr.path()).unwrap();
        repo.config().unwrap().set_str("diff.tool", "pgfake").unwrap();
    }
    // The tell: an uncommitted edit sitting in the worktree. `<root>^!` would
    // put THIS on the right-hand side; the empty-tree pair must not.
    support::fs::write_file(tr.path(), "README.md", "uncommitted\n");

    let (backend, handle) = tr.open_with_backend();
    let root = tr.repo.head().unwrap().peel_to_commit().unwrap().id();
    let plan = backend
        .difftool_plan(
            &handle.id,
            &DiffToolTarget::Commit {
                oid: root.to_string(),
            },
            &paths(&["README.md"]),
            None,
        )
        .expect("plan");

    let out = run(&plan);
    assert!(
        out.status.success(),
        "git difftool failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let body = marker_body(tr.path(), "marker.txt");
    assert!(body.contains("original"), "the commit's content: {body:?}");
    assert!(
        !body.contains("uncommitted"),
        "the working tree leaked into a commit's diff — the `^!` bug: {body:?}"
    );
}

/// The range shape, run for real, named by REFS.
///
/// The point is the resolution added for the argv fix: `main`/`HEAD` never reach
/// git, only the oids they resolved to — and the tool must still be handed the
/// same two file versions it was before. A test on the argv alone could not tell
/// a correct resolution from one that silently picked the wrong commits.
#[test]
fn a_range_named_by_refs_reaches_the_tool_with_the_right_two_versions() {
    if !difftool_available() {
        eprintln!("skipping: `git difftool` is not available here");
        return;
    }
    let tr = TempRepo::with_initial_commit("v1\n");
    tr.add_commit("README.md", "v2\n", "second");
    configure_fake_tool(tr.path(), "pgfake", "marker.txt");
    {
        let repo = git2::Repository::open(tr.path()).unwrap();
        repo.config().unwrap().set_str("diff.tool", "pgfake").unwrap();
    }
    // A worktree edit that belongs to NEITHER side, so a range that leaked into
    // a worktree comparison would show up here.
    support::fs::write_file(tr.path(), "README.md", "uncommitted\n");

    let (backend, handle) = tr.open_with_backend();
    let root = tr
        .repo
        .head()
        .unwrap()
        .peel_to_commit()
        .unwrap()
        .parent(0)
        .unwrap()
        .id()
        .to_string();
    let plan = backend
        .difftool_plan(
            &handle.id,
            &DiffToolTarget::Range {
                from: root,
                to: "HEAD".into(),
            },
            &paths(&["README.md"]),
            None,
        )
        .expect("plan");

    let out = run(&plan);
    assert!(
        out.status.success(),
        "git difftool failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let body = marker_body(tr.path(), "marker.txt");
    assert!(body.contains("v1") && body.contains("v2"), "{body:?}");
    assert!(
        !body.contains("uncommitted"),
        "a range must not reach the working tree: {body:?}"
    );
}

#[test]
fn a_pathspec_shaped_filename_selects_itself() {
    if !difftool_available() {
        eprintln!("skipping: `git difftool` is not available here");
        return;
    }
    // `GIT_LITERAL_PATHSPECS`, tested rather than trusted: git reads `[ab]` as a
    // glob, so without it the row the user right-clicked and the file git opens
    // are different files.
    let tr = TempRepo::with_initial_commit("readme\n");
    let literal = "a[bc].txt";
    support::fs::write_file(tr.path(), literal, "literal v1\n");
    support::fs::write_file(tr.path(), "ab.txt", "decoy v1\n");
    tr.commit_all("add both");
    support::fs::write_file(tr.path(), literal, "literal v2\n");
    support::fs::write_file(tr.path(), "ab.txt", "decoy v2\n");

    configure_fake_tool(tr.path(), "pgfake", "marker.txt");
    {
        let repo = git2::Repository::open(tr.path()).unwrap();
        repo.config().unwrap().set_str("diff.tool", "pgfake").unwrap();
    }

    let (backend, handle) = tr.open_with_backend();
    let plan = backend
        .difftool_plan(
            &handle.id,
            &DiffToolTarget::Worktree,
            &paths(&[literal]),
            None,
        )
        .expect("plan");

    let out = run(&plan);
    assert!(
        out.status.success(),
        "git difftool failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let body = marker_body(tr.path(), "marker.txt");
    assert!(body.contains("literal v2"), "{body:?}");
    assert!(!body.contains("decoy"), "the glob matched a decoy: {body:?}");
}

#[test]
fn a_repository_with_no_tool_at_all_fails_with_gits_own_words() {
    if !difftool_available() {
        eprintln!("skipping: `git difftool` is not available here");
        return;
    }
    // `--tool` names something no config defines, which is the shape of "nothing
    // resolved" we can produce deterministically — autodetect would find
    // whatever the test machine has installed. The point is the same: git
    // explains itself, so `commands::diff` has something worth putting in a
    // banner and no reason to mint an error variant.
    let tr = TempRepo::with_initial_commit("committed\n");
    support::fs::write_file(tr.path(), "README.md", "edited\n");
    let (backend, handle) = tr.open_with_backend();
    let plan = backend
        .difftool_plan(
            &handle.id,
            &DiffToolTarget::Worktree,
            &paths(&["README.md"]),
            Some("pg-no-such-tool"),
        )
        .expect("plan");

    let out = run(&plan);
    assert!(!out.status.success(), "an unknown tool must fail");
    let stderr = String::from_utf8_lossy(&out.stderr).to_lowercase();
    assert!(
        stderr.contains("pg-no-such-tool"),
        "git should name the tool it could not find: {stderr:?}"
    );
}

/// A plan is a value, so the workdir it carries has to be the repository's — the
/// command runs `git -C` with it and every pathspec is relative to it.
#[test]
fn the_plan_names_the_repository_the_id_belongs_to() {
    let a = TempRepo::with_initial_commit("a\n");
    let b = TempRepo::with_initial_commit("b\n");
    let backend = platypusgit_lib::git::libgit2::Libgit2Backend::new();
    let ha = backend.open(a.path()).unwrap();
    let hb = backend.open(b.path()).unwrap();

    let plan_a = backend
        .difftool_plan(&ha.id, &DiffToolTarget::Worktree, &paths(&["README.md"]), None)
        .unwrap();
    let plan_b = backend
        .difftool_plan(&hb.id, &DiffToolTarget::Worktree, &paths(&["README.md"]), None)
        .unwrap();

    assert_eq!(
        PathBuf::from(&plan_a.workdir).canonicalize().unwrap(),
        a.path().canonicalize().unwrap()
    );
    assert_eq!(
        PathBuf::from(&plan_b.workdir).canonicalize().unwrap(),
        b.path().canonicalize().unwrap()
    );
}

/// The command's own spawn shape, since the command itself needs a Tauri
/// `State` no test can build: console kept, **stderr piped, stdout inherited**.
///
/// That combination is the one thing in `open_in_difftool` that could silently
/// stop working — `wait_with_output` on a child whose stdout was never piped is
/// exactly the shape people get wrong — and its failure mode is the banner going
/// back to `git difftool exited with exit status: 1`, which tells the reader
/// nothing. stdout stays inherited so a console difftool still owns the
/// terminal.
#[tokio::test]
async fn the_spawn_shape_captures_stderr_without_taking_stdout() {
    if !difftool_available() {
        eprintln!("skipping: `git difftool` is not available here");
        return;
    }
    let tr = TempRepo::with_initial_commit("committed\n");
    support::fs::write_file(tr.path(), "README.md", "edited\n");
    let (backend, handle) = tr.open_with_backend();
    let plan = backend
        .difftool_plan(
            &handle.id,
            &DiffToolTarget::Worktree,
            &paths(&["README.md"]),
            Some("pg-no-such-tool"),
        )
        .expect("plan");

    let (key, value) = platypusgit_lib::git::stash::LITERAL_PATHSPECS;
    let mut cmd = platypusgit_lib::proc::git_async_keeping_console(&plan.workdir);
    cmd.args(&plan.args)
        .env(key, value)
        .stderr(std::process::Stdio::piped());
    let out = cmd
        .spawn()
        .expect("spawn")
        .wait_with_output()
        .await
        .expect("wait");

    assert!(!out.status.success());
    assert!(
        !out.stderr.is_empty(),
        "stderr must reach the caller — it is the only useful thing git says here"
    );
    assert!(out.stdout.is_empty(), "stdout was never piped");
}
