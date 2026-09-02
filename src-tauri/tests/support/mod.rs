#![allow(dead_code)]

pub mod fs;

use std::path::{Path, PathBuf};

use git2::{Repository, Signature};
use tempfile::TempDir;

use platypusgit_lib::git::{libgit2::Libgit2Backend, types::RepoHandle, GitBackend};

/// A throwaway git repo in a tempdir. Dropped = cleaned up.
pub struct TempRepo {
    pub dir: TempDir,
    pub repo: Repository,
}

impl TempRepo {
    /// An empty repo with no commits (unborn HEAD on `main`).
    pub fn fresh() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = Repository::init_opts(
            dir.path(),
            git2::RepositoryInitOptions::new()
                .initial_head("main")
                .mkdir(false),
        )
        .expect("init");
        // Set a committer identity so commit() works without global config leaking in.
        let mut cfg = repo.config().expect("config");
        cfg.set_str("user.name", "Test User").unwrap();
        cfg.set_str("user.email", "test@example.com").unwrap();
        TempRepo { dir, repo }
    }

    /// Repo with one commit that creates `README.md` with the given body.
    pub fn with_initial_commit(readme_body: &str) -> Self {
        let tr = Self::fresh();
        self::fs::write_file(tr.path(), "README.md", readme_body);
        let mut index = tr.repo.index().unwrap();
        index.add_path(Path::new("README.md")).unwrap();
        index.write().unwrap();
        let tree_oid = index.write_tree().unwrap();
        {
            let tree = tr.repo.find_tree(tree_oid).unwrap();
            let sig = Signature::now("Test User", "test@example.com").unwrap();
            tr.repo
                .commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
                .unwrap();
        }
        tr
    }

    pub fn path(&self) -> &Path {
        self.dir.path()
    }

    pub fn path_buf(&self) -> PathBuf {
        self.dir.path().to_path_buf()
    }

    /// Convenience: open via the real backend, returning handle + backend.
    pub fn open_with_backend(&self) -> (Libgit2Backend, RepoHandle) {
        let backend = Libgit2Backend::new();
        let handle = backend.open(self.path()).expect("open");
        (backend, handle)
    }

    /// Stage all tracked/new files and make a commit.
    pub fn commit_all(&self, msg: &str) -> git2::Oid {
        let repo = git2::Repository::open(self.path()).unwrap();
        let mut index = repo.index().unwrap();
        index
            .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
            .unwrap();
        index.write().unwrap();
        let tree_oid = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_oid).unwrap();
        let sig = Signature::now("Test", "test@example.com").unwrap();
        let head = repo
            .head()
            .ok()
            .and_then(|h| h.target())
            .map(|o| repo.find_commit(o).unwrap());
        let parents: Vec<&git2::Commit> = head.as_ref().map(|c| vec![c]).unwrap_or_default();
        repo.commit(Some("HEAD"), &sig, &sig, msg, &tree, &parents)
            .unwrap()
    }

    /// Make an additional commit to this repo (useful to get a commit to push).
    pub fn add_commit(&self, filename: &str, contents: &str, message: &str) {
        self::fs::write_file(self.path(), filename, contents);
        let mut index = self.repo.index().unwrap();
        index.add_path(std::path::Path::new(filename)).unwrap();
        index.write().unwrap();
        let tree_oid = index.write_tree().unwrap();
        let tree = self.repo.find_tree(tree_oid).unwrap();
        let sig = Signature::now("Test User", "test@example.com").unwrap();
        let head = self.repo.head().unwrap().peel_to_commit().unwrap();
        self.repo
            .commit(Some("HEAD"), &sig, &sig, message, &tree, &[&head])
            .unwrap();
    }
}

/// Initiate a merge that conflicts on README.md, returning a TempRepo
/// with the merge state active. The conflicting branch is `feature`.
pub fn with_conflicting_merge() -> TempRepo {
    use self::fs::write_file;
    use std::path::PathBuf;

    let tr = TempRepo::with_initial_commit("hello\n");
    {
        let (backend, handle) = tr.open_with_backend();
        // feature branch: change README.
        backend.create_branch(&handle.id, "feature", None).unwrap();
        backend.checkout_branch(&handle.id, "feature", false).unwrap();
        write_file(tr.path(), "README.md", "feature branch content\n");
        backend.stage(&handle.id, &[PathBuf::from("README.md")]).unwrap();
        backend
            .commit(
                &handle.id,
                platypusgit_lib::git::types::CommitOptions {
                    message: "feature change".into(),
                    amend: false,
                    author_override: None,
                    signoff: false,
                    sign: None,
                    no_verify: false,
                },
            )
            .unwrap();

        // main: change README differently.
        backend.checkout_branch(&handle.id, "main", false).unwrap();
        write_file(tr.path(), "README.md", "main branch content\n");
        backend.stage(&handle.id, &[PathBuf::from("README.md")]).unwrap();
        backend
            .commit(
                &handle.id,
                platypusgit_lib::git::types::CommitOptions {
                    message: "main change".into(),
                    amend: false,
                    author_override: None,
                    signoff: false,
                    sign: None,
                    no_verify: false,
                },
            )
            .unwrap();
    }

    // Kick off the merge directly via git2 so we end up in the merge
    // state with README.md conflicted.
    {
        let feature_ref = tr.repo.find_reference("refs/heads/feature").unwrap();
        let annotated = tr.repo.reference_to_annotated_commit(&feature_ref).unwrap();
        tr.repo
            .merge(&[&annotated], None, None)
            .expect("merge should produce conflicts");
        // annotated and feature_ref are dropped here, releasing borrows on tr.repo.
    }

    tr
}

/// Create `n` commits on main, each touching a unique file `fileN.txt`.
/// Returns the list of OIDs (oldest first).
pub fn linear_history(tr: &TempRepo, n: usize) -> Vec<String> {
    let mut oids = Vec::with_capacity(n);
    for i in 0..n {
        let filename = format!("file{}.txt", i);
        let contents = format!("content {}\n", i);
        let message = format!("commit {}", i);
        tr.add_commit(&filename, &contents, &message);
        let oid = tr.repo.head().unwrap().peel_to_commit().unwrap().id().to_string();
        oids.push(oid);
    }
    oids
}

/// A repository with a merge commit in the middle of the range:
///
/// ```text
/// root ── A ──── C ── M      (main)
///          \        /
///           ─── F ──         (feature)
/// ```
///
/// `F` and `C` touch different files, so `M` is a clean merge. Returns the oids
/// as strings.
pub struct MergeHistory {
    pub root: String,
    pub a: String,
    pub f: String,
    pub c: String,
    pub m: String,
}

pub fn merge_history(tr: &TempRepo) -> MergeHistory {
    let root = tr
        .repo
        .head()
        .unwrap()
        .peel_to_commit()
        .unwrap()
        .id()
        .to_string();

    let commit = |name: &str, body: &str, msg: &str| -> String {
        self::fs::write_file(tr.path(), name, body);
        let mut index = tr.repo.index().unwrap();
        index.add_path(Path::new(name)).unwrap();
        index.write().unwrap();
        let tree_oid = index.write_tree().unwrap();
        let tree = tr.repo.find_tree(tree_oid).unwrap();
        let sig = Signature::now("Test", "test@example.com").unwrap();
        let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
        tr.repo
            .commit(Some("HEAD"), &sig, &sig, msg, &tree, &[&head])
            .unwrap()
            .to_string()
    };

    let a = commit("a.txt", "a\n", "A on main");

    // feature branches off A
    {
        let a_commit = tr
            .repo
            .find_commit(git2::Oid::from_str(&a).unwrap())
            .unwrap();
        tr.repo.branch("feature", &a_commit, false).unwrap();
    }
    tr.repo.set_head("refs/heads/feature").unwrap();
    tr.repo
        .checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
        .unwrap();
    let f = commit("f.txt", "f\n", "F on feature");

    // back to main
    tr.repo.set_head("refs/heads/main").unwrap();
    tr.repo
        .checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
        .unwrap();
    let c = commit("c.txt", "c\n", "C on main");

    // merge feature into main
    let f_oid = git2::Oid::from_str(&f).unwrap();
    let m = {
        let annotated = tr.repo.find_annotated_commit(f_oid).unwrap();
        tr.repo.merge(&[&annotated], None, None).unwrap();
        let mut index = tr.repo.index().unwrap();
        assert!(
            !index.has_conflicts(),
            "merge_history fixture must merge cleanly"
        );
        let tree_oid = index.write_tree().unwrap();
        let tree = tr.repo.find_tree(tree_oid).unwrap();
        let sig = Signature::now("Test", "test@example.com").unwrap();
        let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
        let f_commit = tr.repo.find_commit(f_oid).unwrap();
        tr.repo
            .commit(
                Some("HEAD"),
                &sig,
                &sig,
                "Merge branch 'feature'",
                &tree,
                &[&head, &f_commit],
            )
            .unwrap()
            .to_string()
    };
    tr.repo.cleanup_state().unwrap();

    MergeHistory { root, a, f, c, m }
}

/// Run `git` in `cwd`, panicking with git's own stderr on failure.
///
/// The fixtures below build submodules and worktrees, and both are far easier to
/// set up with the real CLI than by hand — but only in FIXTURE code: the ops under
/// test always go through the backend.
pub fn git_in(cwd: &Path, args: &[&str]) -> String {
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(cwd)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_AUTHOR_NAME", "Test")
        .env("GIT_AUTHOR_EMAIL", "test@example.com")
        .env("GIT_COMMITTER_NAME", "Test")
        .env("GIT_COMMITTER_EMAIL", "test@example.com")
        .output()
        .expect("spawn git");
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).to_string()
}

/// True when `git` can run `git lfs`. LFS tests that need the real binary are
/// conditional on this — it is not installed everywhere, and a test suite that
/// only passes on machines that happen to have it is worse than one that says so.
pub fn lfs_installed() -> bool {
    std::process::Command::new("git")
        .args(["lfs", "version"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// An outer repository with a real submodule checked out at `vendor/inner`.
///
/// Both repos are tempdirs, and `inner` is held so it outlives the submodule's
/// `.git` gitlink. `protocol.file.allow=always` is required: git ≥ 2.38 refuses the
/// `file` transport for submodules by default (CVE-2022-39253), and every
/// local-path submodule fixture needs the opt-in.
pub struct SubmoduleFixture {
    pub outer: TempRepo,
    pub inner: TempRepo,
}

impl SubmoduleFixture {
    pub const SUB_PATH: &'static str = "vendor/inner";

    /// Remove the submodule's checkout and its `.git/config` entry, so it reads
    /// back as `Uninitialized` — the state a fresh clone without
    /// `--recurse-submodules` leaves behind.
    pub fn deinit(&self) {
        git_in(
            self.outer.path(),
            &["submodule", "deinit", "-f", Self::SUB_PATH],
        );
    }
}

pub fn with_submodule() -> SubmoduleFixture {
    let inner = TempRepo::with_initial_commit("inner v1\n");
    let outer = TempRepo::with_initial_commit("outer\n");
    let inner_path = inner.path().to_string_lossy().to_string();
    git_in(
        outer.path(),
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            &inner_path,
            SubmoduleFixture::SUB_PATH,
        ],
    );
    git_in(outer.path(), &["commit", "-m", "add submodule"]);
    SubmoduleFixture { inner, outer }
}

/// A directory path in its own tempdir for a linked worktree to be created AT.
///
/// The path itself must not exist yet (`worktree_add` refuses an existing path), so
/// this hands back a child of the tempdir. The `TempDir` is returned alongside and
/// must be held for as long as the worktree is needed — dropping it deletes the
/// worktree behind git's back, which is exactly what the prune test wants and
/// exactly what every other test must avoid.
///
/// Never, ever point a worktree test at the repository it is running in: this
/// project is developed through `.claude/worktrees/`, and a `worktree_remove` aimed
/// at the wrong path would delete a live checkout.
pub fn worktree_target(label: &str) -> (TempDir, PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join(label);
    (dir, path)
}

/// A bare git repository in a tempdir — acts as a "remote" for network tests.
pub struct BareTempRepo {
    pub dir: TempDir,
    pub path: PathBuf,
}

impl BareTempRepo {
    pub fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().to_path_buf();
        let repo = Repository::init_bare(&path).expect("init bare");
        // `init_bare` always falls back to libgit2's built-in "master"
        // default, ignoring ambient init.defaultBranch config (system
        // gitconfig included) — unlike the real `git` CLI, which on this
        // machine resolves to "main". Pin HEAD here so every test that
        // clones/pushes/fetches against a bare fixture sees a "main" HEAD
        // regardless of the host's config, instead of each caller working
        // around it individually.
        repo.set_head("refs/heads/main").expect("set bare HEAD to main");
        BareTempRepo { dir, path }
    }
}
