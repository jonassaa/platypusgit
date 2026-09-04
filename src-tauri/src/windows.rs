//! Repository windows — the registry behind "multiple windows, not just tabs"
//! (#256).
//!
//! Repositories open as tabs, and tabs are for *switching*. Windows are for
//! *comparing*: two repositories side by side, one per monitor, a build running
//! in one while you work in the other. Since #256 the app can have several
//! windows, each running the whole frontend with its own tab strip.
//!
//! ## Labels are the identity
//!
//! * `main` — the window `tauri.conf.json` declares. Always the first one.
//! * `pg-1`, `pg-2`, … — siblings, created at runtime; the number is the lowest
//!   one not currently taken, so labels stay short and predictable.
//! * `merge` — the conflict resolver (`features/merge/`), which is a window but
//!   NOT a repository window: it drives one repository handed to it by whoever
//!   opened it, and none of the bookkeeping here applies to it.
//!
//! Deterministic labels are not cosmetic. They key the frontend's per-window
//! storage, a capability glob (`pg-*`) has to match them, and an e2e spec has to
//! name one to `browser.tauri.switchWindow(…)`.
//!
//! ## Why the backend has to know anything at all
//!
//! Each window's *state* is entirely its own — a second webview gets a second
//! copy of every Zustand store for free, and two windows on one repository get
//! two `RepoId`s, so there is no shared handle to corrupt. Three questions still
//! have no answer inside a single webview, and this module is where they live:
//!
//! 1. **Which window should a `pgit …` launch go to?** [`WindowRegistry::route`]
//!    — the window that already has that repository open, else the last-focused
//!    one, else the first. A webview cannot see another window's tabs.
//!    ⚠️ Routing here is only half of it: a plain JS `listen()` registers
//!    `EventTarget::Any`, which Tauri matches against EVERY emit — including an
//!    `emit_to` naming one window. The frontend listener has to name its own
//!    window (`listenToThisWindow`, src/features/windows/windowEvents.ts) or
//!    this decision is quietly undone in the webview.
//! 2. **What happens when one window closes?** Its repositories, its pty
//!    sessions and its filesystem watch have to go with it. Process exit used to
//!    cover that; with several windows it no longer does, and a closed window
//!    would otherwise leak a `git2::Repository` and a shell for the rest of the
//!    session. See [`on_window_destroyed`].
//! 3. **Was that a close, or a quit?** Both destroy windows, and the answer
//!    decides whether the window comes back next launch. The rule needs no flag
//!    and no event ordering: a window destroyed **while another repository
//!    window is still alive** is forgotten, and one destroyed with none left is
//!    remembered. `on_window_destroyed` implements it by emitting
//!    [`WINDOW_CLOSED_EVENT`] to a *survivor* — when there is no survivor there
//!    is nobody to tell, which is exactly the quit case.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::git::types::RepoId;

/// The window `tauri.conf.json` declares.
pub const MAIN_WINDOW: &str = "main";
/// The conflict resolver. A window, but not a repository window.
pub const MERGE_WINDOW: &str = "merge";
/// Every sibling window's label starts with this.
pub const REPO_WINDOW_PREFIX: &str = "pg-";

/// Emitted to a SURVIVING repository window when another one is destroyed, so
/// the frontend can drop that label's persisted session. Never emitted when
/// nothing survives — see the module note on close-versus-quit.
pub const WINDOW_CLOSED_EVENT: &str = "window://closed";

/// True for `main` and for `pg-<n>`, false for the resolver and for anything
/// else a future feature might open.
pub fn is_repo_window(label: &str) -> bool {
    if label == MAIN_WINDOW {
        return true;
    }
    match label.strip_prefix(REPO_WINDOW_PREFIX) {
        // `parse` rather than `is_ascii_digit`: it rejects `pg-` (empty),
        // `pg-01x`, and anything that would not round-trip through
        // `next_label`.
        Some(rest) => rest.parse::<u32>().is_ok(),
        None => false,
    }
}

/// One repository a window currently holds. `id` is null while the tab is still
/// pending — the frontend registers the tab strip as it is, not only once every
/// tab has opened, so routing works before the last tab has loaded.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowRepo {
    pub id: Option<String>,
    pub path: String,
}

/// The frontend's `repoPathKey` (src/features/repo/tabs.ts), on this side.
///
/// A path arrives from several producers that disagree about the trailing
/// separator, and routing compares one against another. Kept deliberately
/// identical to the frontend's rule, including its two exceptions: a path that
/// is only separators, and a Windows drive root, are left alone rather than
/// trimmed into a different path.
fn path_key(path: &str) -> &str {
    let trimmed = path.trim_end_matches(['/', '\\']);
    if trimmed.is_empty() || trimmed.ends_with(':') {
        return path;
    }
    trimmed
}

/// Which repositories each window holds, and which window the user touched last.
#[derive(Default)]
pub struct WindowRegistry {
    repos: Mutex<HashMap<String, Vec<WindowRepo>>>,
    focused: Mutex<Option<String>>,
}

impl WindowRegistry {
    /// Replace what `label` holds. Called on every tab-strip change, so it is a
    /// whole-set write rather than an add/remove pair — the frontend's tab list
    /// is the truth and there is no diff worth computing.
    pub fn register(&self, label: &str, repos: Vec<WindowRepo>) {
        if let Ok(mut map) = self.repos.lock() {
            map.insert(label.to_string(), repos);
        }
    }

    /// Remove and return what `label` held. Used exactly once, by
    /// [`on_window_destroyed`], so the eviction cannot run twice.
    pub fn take(&self, label: &str) -> Vec<WindowRepo> {
        self.repos
            .lock()
            .ok()
            .and_then(|mut map| map.remove(label))
            .unwrap_or_default()
    }

    /// What `label` holds right now. Diagnostics and tests.
    pub fn holdings(&self, label: &str) -> Vec<WindowRepo> {
        self.repos
            .lock()
            .ok()
            .and_then(|map| map.get(label).cloned())
            .unwrap_or_default()
    }

    pub fn note_focus(&self, label: &str) {
        if !is_repo_window(label) {
            return;
        }
        if let Ok(mut f) = self.focused.lock() {
            *f = Some(label.to_string());
        }
    }

    /// Where a `pgit <path>` launch should land, given the windows that are
    /// currently alive.
    ///
    /// Order: the window that already has `path` open, else the last-focused
    /// live window, else the first live label in sort order (`main` sorts before
    /// every `pg-n`, which is the right default). `None` only when no repository
    /// window is alive at all.
    ///
    /// `live` is passed in rather than read from an `AppHandle` so the rule is
    /// testable without a Tauri app — this is the part with the branches.
    pub fn route(&self, path: &str, live: &[String]) -> Option<String> {
        if live.is_empty() {
            return None;
        }
        let key = path_key(path);
        if let Ok(map) = self.repos.lock() {
            // Sorted so a repository open in two windows routes to the same one
            // every time; an arbitrary HashMap order would make `pgit` feel
            // random.
            let mut holders: Vec<&String> = live
                .iter()
                .filter(|label| {
                    map.get(*label)
                        .is_some_and(|repos| repos.iter().any(|r| path_key(&r.path) == key))
                })
                .collect();
            holders.sort();
            if let Some(found) = holders.first() {
                return Some((*found).clone());
            }
        }
        self.preferred(live)
    }

    /// Where "the app" is, with no repository in the question: the last-focused
    /// live window, else the first live label in sort order. What a bare `pgit`
    /// surfaces, and `route`'s own fallback.
    pub fn preferred(&self, live: &[String]) -> Option<String> {
        if let Ok(f) = self.focused.lock() {
            if let Some(label) = f.as_ref() {
                if live.iter().any(|l| l == label) {
                    return Some(label.clone());
                }
            }
        }
        let mut sorted: Vec<&String> = live.iter().collect();
        sorted.sort();
        sorted.first().map(|l| (*l).clone())
    }
}

/// The lowest free `pg-<n>`, given the labels already in use.
///
/// Reuse rather than a counter: labels are storage keys, and a monotonically
/// growing one leaves `pg-open-repos:pg-37` behind forever. Starts at 1 —
/// `pg-0` would read as "the zeroth window" next to `main`.
pub fn next_label(live: &[String]) -> String {
    for n in 1u32.. {
        let candidate = format!("{REPO_WINDOW_PREFIX}{n}");
        if !live.iter().any(|l| l == &candidate) {
            return candidate;
        }
    }
    unreachable!("u32 exhausted while naming a window")
}

/// Every repository window currently alive, by label. Excludes the resolver.
pub fn live_repo_windows(app: &AppHandle) -> Vec<String> {
    let mut labels: Vec<String> = app
        .webview_windows()
        .keys()
        .filter(|l| is_repo_window(l))
        .cloned()
        .collect();
    labels.sort();
    labels
}

/// Tear down one window's backend state, and decide whether it is remembered.
///
/// Called from `lib.rs`'s window-event handler on `Destroyed`. Everything the
/// window held is released here: its repositories (each window opens its own
/// `RepoId`, so this evicts nothing another window is using), the pty sessions
/// keyed by those ids, and its filesystem watch.
///
/// The eviction runs on its own thread. Dropping a `git2::Repository` takes the
/// backend's repo map lock, and this handler runs on the event loop — the thread
/// that also has to finish tearing the window down.
pub fn on_window_destroyed(app: &AppHandle, label: &str) {
    if !is_repo_window(label) {
        return;
    }
    let repos = app.state::<WindowRegistry>().take(label);
    app.state::<crate::watcher::WatchState>().stop(label);

    if !repos.is_empty() {
        let backend = app.state::<crate::state::AppState>().backend.clone();
        let terminals: Arc<crate::terminal::TerminalState> =
            app.state::<Arc<crate::terminal::TerminalState>>().inner().clone();
        std::thread::spawn(move || {
            for repo in repos {
                let Some(id) = repo.id else { continue };
                terminals.close(&id);
                if let Err(e) = backend.close(&RepoId(id.clone())) {
                    log::warn!("closing {id} after its window went away failed: {e}");
                }
            }
        });
    }

    if let Some(target) = survivor_to_notify(label, &live_repo_windows(app)) {
        if let Err(e) = app.emit_to(target.as_str(), WINDOW_CLOSED_EVENT, label) {
            log::warn!("failed to announce the close of {label}: {e}");
        }
    }
}

/// Close, or quit? — the whole rule, as a function of two lists.
///
/// A survivor means the user closed this one window: it is told, and forgets
/// the closed window's session. No survivor means the app is on its way out,
/// there is nobody to tell, and the session is left alone to be restored. That
/// asymmetry is the entire mechanism; there is no "are we exiting" flag and
/// nothing depends on the order Tauri destroys windows in.
///
/// The survivor is the first label in sort order rather than an arbitrary one,
/// so `main` is preferred while it is up and a sibling takes over when the user
/// closed `main` first — deterministic either way, which matters because the
/// chosen window is the only one that will act on the event.
fn survivor_to_notify(destroyed: &str, live: &[String]) -> Option<String> {
    let mut survivors: Vec<&String> = live.iter().filter(|l| *l != destroyed).collect();
    survivors.sort();
    survivors.first().map(|l| (*l).clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo(path: &str) -> WindowRepo {
        WindowRepo {
            id: Some(format!("id-for-{path}")),
            path: path.to_string(),
        }
    }

    #[test]
    fn labels_the_app_owns() {
        assert!(is_repo_window("main"));
        assert!(is_repo_window("pg-1"));
        assert!(is_repo_window("pg-42"));
        assert!(!is_repo_window("merge"));
        assert!(!is_repo_window("pg-"));
        assert!(!is_repo_window("pg-x"));
        assert!(!is_repo_window("pg-1x"));
        assert!(!is_repo_window("something"));
    }

    #[test]
    fn next_label_takes_the_lowest_free_number() {
        assert_eq!(next_label(&["main".into()]), "pg-1");
        assert_eq!(next_label(&["main".into(), "pg-1".into()]), "pg-2");
        // Reuse, not a high-water mark: closing pg-1 frees the name again.
        assert_eq!(next_label(&["main".into(), "pg-2".into()]), "pg-1");
    }

    #[test]
    fn routes_to_the_window_that_already_has_the_repository() {
        let reg = WindowRegistry::default();
        reg.register("main", vec![repo("/dev/api")]);
        reg.register("pg-1", vec![repo("/dev/web")]);
        let live = vec!["main".to_string(), "pg-1".to_string()];
        assert_eq!(reg.route("/dev/web", &live).as_deref(), Some("pg-1"));
        assert_eq!(reg.route("/dev/api", &live).as_deref(), Some("main"));
    }

    #[test]
    fn a_trailing_separator_is_the_same_repository() {
        let reg = WindowRegistry::default();
        reg.register("pg-1", vec![repo("/dev/web")]);
        let live = vec!["main".to_string(), "pg-1".to_string()];
        assert_eq!(reg.route("/dev/web/", &live).as_deref(), Some("pg-1"));
    }

    #[test]
    fn falls_back_to_the_last_focused_window_then_the_first() {
        let reg = WindowRegistry::default();
        reg.register("main", vec![repo("/dev/api")]);
        reg.register("pg-1", vec![repo("/dev/web")]);
        let live = vec!["main".to_string(), "pg-1".to_string()];
        // Nobody holds it.
        assert_eq!(reg.route("/dev/other", &live).as_deref(), Some("main"));
        reg.note_focus("pg-1");
        assert_eq!(reg.route("/dev/other", &live).as_deref(), Some("pg-1"));
        // A focus record for a window that has since closed is ignored.
        assert_eq!(
            reg.route("/dev/other", &["main".to_string()]).as_deref(),
            Some("main")
        );
    }

    #[test]
    fn the_resolver_never_takes_focus_or_a_launch() {
        let reg = WindowRegistry::default();
        reg.note_focus("merge");
        let live = vec!["main".to_string()];
        assert_eq!(reg.route("/dev/other", &live).as_deref(), Some("main"));
    }

    #[test]
    fn no_live_window_routes_nowhere() {
        let reg = WindowRegistry::default();
        assert_eq!(reg.route("/dev/api", &[]), None);
    }

    #[test]
    fn one_window_left_alive_is_told_so_it_can_forget_the_closed_one() {
        let live = vec!["main".to_string(), "pg-1".to_string()];
        assert_eq!(survivor_to_notify("pg-1", &live).as_deref(), Some("main"));
        // The user closed `main` first: a sibling takes over as the pruner, so
        // closing the rest of the windows still forgets them.
        assert_eq!(survivor_to_notify("main", &live).as_deref(), Some("pg-1"));
    }

    #[test]
    fn the_last_window_out_is_remembered() {
        // The quit case, and the only thing that distinguishes it: there is
        // nobody left to tell, so nothing prunes the session and every window
        // that was up comes back.
        assert_eq!(survivor_to_notify("main", &["main".to_string()]), None);
        assert_eq!(survivor_to_notify("main", &[]), None);
    }

    #[test]
    fn the_resolver_is_never_a_survivor() {
        // A resolver left open while the last repository window closes must not
        // make a quit look like a close — the session would be pruned and the
        // user's windows would not come back. `live_repo_windows` is what keeps
        // it out of the list `survivor_to_notify` ever sees.
        let live: Vec<String> = ["main", "merge"]
            .into_iter()
            .filter(|l| is_repo_window(l))
            .map(str::to_string)
            .collect();
        assert_eq!(live, vec!["main".to_string()]);
        assert_eq!(survivor_to_notify("main", &live), None);
    }

    #[test]
    fn taking_a_window_empties_it_once() {
        let reg = WindowRegistry::default();
        reg.register("pg-1", vec![repo("/dev/web")]);
        assert_eq!(reg.take("pg-1").len(), 1);
        assert_eq!(reg.take("pg-1").len(), 0);
        assert_eq!(reg.holdings("pg-1").len(), 0);
    }
}
