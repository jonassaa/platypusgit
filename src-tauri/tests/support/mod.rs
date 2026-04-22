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
}
