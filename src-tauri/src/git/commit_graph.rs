//! The commit-graph file this backend keeps warm (#483).
//!
//! # Why the app writes it at all
//!
//! `git/log_walk.rs` takes the log's order from `git rev-list --date-order`,
//! and that is only affordable with a commit-graph. Measured on
//! `torvalds/linux`, for the 100,000-oid walk `MAX_ORDER` asks for:
//!
//! | | no commit-graph | with one |
//! | --- | --- | --- |
//! | `rev-list --date-order` | 10,123 ms | **188 ms** |
//!
//! A fresh clone has none. `git clone` does not write one, and `gc --auto`
//! does not fire on a single packfile, so this is exactly what a user gets on
//! day one — which is also the day they are most likely to be waiting on a
//! repository they have just cloned.
//!
//! It is written into the USER'S OWN repository, because that is where git
//! itself writes it (`git gc`, `git maintenance`), because it is derived data
//! git knows how to keep current, and because it makes the user's own
//! `git log` fast too rather than only ours.
//!
//! # `--split`, and it is not a preference
//!
//! Measured on the kernel:
//!
//! | | cost |
//! | --- | --- |
//! | `commit-graph write --reachable`, cold | 14,509 ms |
//! | `commit-graph write --reachable`, **already fresh** | 14,305 ms |
//! | `commit-graph write --reachable --split`, cold | 14,531 ms |
//! | `commit-graph write --reachable --split`, nothing new | **59.9 ms** |
//!
//! The plain form rewrites the whole file every time, so scheduling it on open
//! would burn fourteen seconds of CPU on every open forever. `--split` adds an
//! incremental layer and costs sixty milliseconds when there is nothing to do.
//!
//! # It is best effort, always
//!
//! Every failure here is silent and costs only speed: a repository with no
//! commit-graph gets the 10-second `rev-list`, or the libgit2 walk behind it.
//! Nothing about correctness depends on this file existing, which is what
//! makes it safe to run in the background without a user waiting on it.

use std::path::Path;

use git2::Repository;

/// Whether this repository should get one.
///
/// Honours `core.commitGraph`: a user who turned git's own commit-graph
/// reading off has said what they want, and writing one anyway would leave a
/// file they never asked for AND no speedup, since git would not read it.
pub fn should_write(repo: &Repository) -> bool {
    if repo.workdir().is_none() {
        return false;
    }
    // Default TRUE — git's own default, and the one that makes the log fast.
    !matches!(repo.config().and_then(|c| c.get_bool("core.commitGraph")), Ok(false))
}

/// Write, or incrementally extend, the split commit-graph.
///
/// `false` on any failure. This is a cache: a repository without one is only
/// slower, so a caller has nothing useful to do with an error beyond not
/// retrying it in a loop.
pub fn write_split(workdir: &Path) -> bool {
    crate::proc::git(workdir)
        .arg("commit-graph")
        .arg("write")
        .arg("--reachable")
        .arg("--split")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// `should_write` + `write_split`, for a caller holding only a path.
///
/// Opens its own handle rather than borrowing the cached one, because this
/// runs in the background and must not sit on the per-repository lock that
/// every read and write in `git/repo_locks.rs` is ordered by — the whole point
/// is that nothing waits for it.
pub fn refresh(workdir: &Path) {
    let Ok(repo) = Repository::open(workdir) else {
        return;
    };
    if !should_write(&repo) {
        return;
    }
    drop(repo);

    let started = std::time::Instant::now();
    if write_split(workdir) {
        // Logged because the first one on a very large repository is a real
        // cost (14.5 s on the kernel) that nobody waits for and therefore
        // nobody can see — and because "why is my fan on after opening a
        // repository" deserves an answer in the log.
        log::info!(
            "commit-graph refreshed in {} ms for {}",
            started.elapsed().as_millis(),
            workdir.display()
        );
    } else {
        log::debug!("commit-graph write skipped for {}", workdir.display());
    }
}
