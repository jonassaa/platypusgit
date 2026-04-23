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
        backend.checkout_branch(&handle.id, "feature").unwrap();
        write_file(tr.path(), "README.md", "feature branch content\n");
        backend.stage(&handle.id, &[PathBuf::from("README.md")]).unwrap();
        backend
            .commit(
                &handle.id,
                platypusgit_lib::git::types::CommitOptions {
                    message: "feature change".into(),
                    amend: false,
                    author_override: None,
                },
            )
            .unwrap();

        // main: change README differently.
        backend.checkout_branch(&handle.id, "main").unwrap();
        write_file(tr.path(), "README.md", "main branch content\n");
        backend.stage(&handle.id, &[PathBuf::from("README.md")]).unwrap();
        backend
            .commit(
                &handle.id,
                platypusgit_lib::git::types::CommitOptions {
                    message: "main change".into(),
                    amend: false,
                    author_override: None,
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

/// A bare git repository in a tempdir — acts as a "remote" for network tests.
pub struct BareTempRepo {
    pub dir: TempDir,
    pub path: PathBuf,
}

impl BareTempRepo {
    pub fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().to_path_buf();
        Repository::init_bare(&path).expect("init bare");
        BareTempRepo { dir, path }
    }
}
