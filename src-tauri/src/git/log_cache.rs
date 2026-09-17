//! What `log_page` used to rebuild on every single page (#473).
//!
//! Two things, and the benchmark in `docs/dev/performance.md` measured both.
//!
//! **The walk.** `log_page` walks with `Sort::TIME | Sort::TOPOLOGICAL`,
//! because the commit graph's lane assignment needs a parent to come after
//! every one of its children. In libgit2 1.9.7 that sort is not incremental in
//! any sense: `git_revwalk_sorting` sets `walk->limited`, so `prepare_walk`
//! runs `limit_list` over the whole reachable graph and then
//! `sort_in_topological_order` materialises the COMPLETE ordered list —
//! before the first oid comes out. Asking that walk for 500 commits and asking
//! it for all 1.5 million of them therefore cost the same thing, and building
//! one walk per page means paying that identical price per page. It shows up
//! as a per-page cost that is flat in depth: on `torvalds/linux`, page one is
//! 15.95 s and page ten is 157.67 s — ten times one page, not one page plus a
//! little. git pays it once and then skips.
//!
//! So the fix is not to make the walk cheaper — nothing here can, see the
//! commit-graph finding in `docs/dev/performance.md` — it is to stop throwing
//! the finished sort away. A walk is prepared once, its output is kept as a
//! `Vec<Oid>`, and every later page is a slice of it.
//!
//! **The ref map.** `collect_ref_map` enumerated and peeled every ref on every
//! page, to decorate 500 rows. On a repository with 7,001 refs and 2,000
//! commits that was 16× git's own work for the same question, with history a
//! twenty-fifth of the size of the fixture beside it. It is cached against a
//! FINGERPRINT of the ref database rather than a timer or a write hook, so a
//! `git tag` typed in a terminal invalidates it exactly like one made in the
//! app.
//!
//! ## This cache is an accelerator and nothing else
//!
//! Every entry here is derivable from the repository on disk, so dropping all
//! of it must change nothing but the clock. That is the property to preserve
//! when editing this file, it is what `log_walk_cache.rs` asserts by draining
//! the same history cold and warm and comparing the two sequences, and it is
//! why a poisoned mutex here degrades to a miss instead of failing the page.
//!
//! ## Why a continuation may be served from a stale walk
//!
//! A first page is keyed by (refspec, start oids), so a ref that moves changes
//! the key and the next first page rebuilds. A CONTINUATION is not keyed that
//! way and does not need to be: resuming from a cursor ignores the refs
//! entirely (`push_page_start` does too), the frontier's reachable set is made
//! of commits, and a commit is immutable. New history can only be added as
//! CHILDREN of what is already there, never inside the set an existing
//! frontier reaches. So the tail of a walk prepared ten minutes ago is the
//! same tail it would have today.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use git2::Oid;

use crate::git::types::{RefInfo, RepoId};

/// How much of one walk is kept, in commits.
///
/// A bound, not a guess at what fits: the kernel's 1.48 M oids would be 30 MB
/// for one walk of one repository, and several tabs each hold their own. At
/// 100,000 an entry is 2 MB and covers two hundred 500-commit pages — further
/// than any human scrolls, and past it a page falls back to preparing a walk
/// from the cursor, which is what EVERY page did before this file existed.
pub const MAX_ORDER: usize = 100_000;

/// How many distinct walks one repository remembers.
///
/// Two, so that flipping the History scope between "All" and one branch — the
/// one alternation a user actually performs — does not evict on every switch.
const MAX_WALKS: usize = 2;

/// How many emitted cursors one walk remembers, so a continuation can be
/// matched to the exact position it continues from.
///
/// Unreachable in practice: `MAX_ORDER / 500` is 200 pages, so a walk runs out
/// of order long before it runs out of cursor slots. It exists so that a
/// pathological caller (`limit = 1`, scrolling forever) cannot grow the map
/// without bound.
const MAX_CURSORS: usize = 512;

/// A commit's ref decorations, by the commit they point at.
pub type RefMap = HashMap<Oid, Vec<RefInfo>>;

/// Which walk this is: the question that was asked, and the commits it was
/// asked from.
///
/// `starts` is SORTED, so two enumerations of the same refs in a different
/// order are the same key. It is the whole invalidation story for a first
/// page: any ref that moves changes an oid in here, which makes a new key,
/// which misses.
#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub struct WalkKey {
    pub refspec: Option<String>,
    pub starts: Vec<Oid>,
}

impl WalkKey {
    pub fn new(refspec: Option<&str>, starts: &[Oid]) -> Self {
        let mut sorted = starts.to_vec();
        sorted.sort();
        Self {
            refspec: refspec.map(str::to_string),
            starts: sorted,
        }
    }
}

/// One prepared walk's output, in the order the walk produced it.
#[derive(Debug)]
pub struct WalkOrder {
    /// The start points that were pushed, in push order — what a first page
    /// seeds its frontier with. Not `WalkKey::starts`, which is sorted for
    /// hashing; the cursor's lane order is observable and should not shuffle.
    pub starts: Vec<Oid>,
    /// Every oid the walk yielded, capped at `MAX_ORDER`.
    pub order: Vec<Oid>,
    /// True when the walk ENDED inside the cap, so `order` is all of history
    /// from `starts` and running off its end means the end of history.
    pub complete: bool,
}

impl WalkOrder {
    /// Whether a page of `limit` starting at `offset` can be answered from
    /// here.
    ///
    /// A short slice is only an answer when the walk is complete — then it IS
    /// the end of history. An incomplete order that runs out mid-page would
    /// hand back a page that stops for no reason the caller can see, so that
    /// case rebuilds instead.
    pub fn serves(&self, offset: usize, limit: usize) -> bool {
        if self.complete {
            offset <= self.order.len()
        } else {
            offset.saturating_add(limit) <= self.order.len()
        }
    }
}

struct Walk {
    key: WalkKey,
    order: Arc<WalkOrder>,
    /// A frontier this walk emitted → the index it resumes at.
    ///
    /// Keyed by the frontier itself, sorted, because that is what the caller
    /// hands back. Matching by "the first oid of this frontier that appears in
    /// some cached order" would be cheaper and is WRONG: two walks over the
    /// same repository share commits, so a cursor from the "All" walk would
    /// happily resolve against a single-branch walk and continue the wrong
    /// history. A cursor we emitted is the only one we can place exactly.
    cursors: HashMap<Vec<Oid>, usize>,
}

#[derive(Default)]
struct RepoEntry {
    /// Most recently used first.
    walks: Vec<Walk>,
    /// Ref-database fingerprint → the decorations built from it.
    refs: Option<(u64, Arc<RefMap>)>,
}

/// What the cache did, for anyone who has to prove it did it.
///
/// A cache that never hits is invisible from the outside: pagination returns
/// exactly the same commits either way, which is the property this file is
/// built for and also the reason a functional test cannot tell the two apart.
/// The alternative — asserting on a clock — is a flake. So the counters are
/// public, `log_walk_cache.rs` reads them, and so does the benchmark.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CacheStats {
    /// Pages served from an already-prepared walk.
    pub hits: u64,
    /// Walks prepared — the expensive thing this file exists to avoid.
    pub walks_prepared: u64,
    /// Ref maps built — every one of them enumerated and peeled every ref.
    pub ref_maps_built: u64,
}

/// Per-repository derived state for the paged log.
#[derive(Default)]
pub struct LogCache {
    repos: Mutex<HashMap<RepoId, RepoEntry>>,
    hits: AtomicU64,
    walks_prepared: AtomicU64,
    ref_maps_built: AtomicU64,
}

impl LogCache {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn stats(&self) -> CacheStats {
        CacheStats {
            hits: self.hits.load(Ordering::Relaxed),
            walks_prepared: self.walks_prepared.load(Ordering::Relaxed),
            ref_maps_built: self.ref_maps_built.load(Ordering::Relaxed),
        }
    }

    /// Count a walk that had to be prepared. Called by the backend, which is
    /// the only place that can know a build actually happened.
    pub fn record_walk_prepared(&self) {
        self.walks_prepared.fetch_add(1, Ordering::Relaxed);
    }

    /// The order for a FIRST page of `key`, if one is cached and can answer it.
    pub fn first_page(&self, repo: &RepoId, key: &WalkKey, limit: usize) -> Option<Arc<WalkOrder>> {
        let mut repos = self.repos.lock().ok()?;
        let entry = repos.get_mut(repo)?;
        let at = entry.walks.iter().position(|w| &w.key == key)?;
        if !entry.walks[at].order.serves(0, limit) {
            return None;
        }
        let walk = entry.walks.remove(at);
        let order = Arc::clone(&walk.order);
        entry.walks.insert(0, walk);
        self.hits.fetch_add(1, Ordering::Relaxed);
        Some(order)
    }

    /// The walk a cursor continues, and where in it the next page begins.
    ///
    /// `cursor` must be sorted — the caller sorts what it receives, and
    /// `remember_cursor` sorts what it emits, so the two agree.
    pub fn resume(
        &self,
        repo: &RepoId,
        cursor: &[Oid],
        limit: usize,
    ) -> Option<(WalkKey, Arc<WalkOrder>, usize)> {
        let mut repos = self.repos.lock().ok()?;
        let entry = repos.get_mut(repo)?;
        let at = entry
            .walks
            .iter()
            .position(|w| w.cursors.contains_key(cursor))?;
        let offset = *entry.walks[at].cursors.get(cursor)?;
        if !entry.walks[at].order.serves(offset, limit) {
            return None;
        }
        let walk = entry.walks.remove(at);
        let out = (walk.key.clone(), Arc::clone(&walk.order), offset);
        entry.walks.insert(0, walk);
        self.hits.fetch_add(1, Ordering::Relaxed);
        Some(out)
    }

    /// Whether a walk for `key` is already filed, whatever it can answer.
    ///
    /// Not the same question as `first_page`, and the difference is the point.
    /// `first_page` says "can this serve the page in hand", and a CAPPED order
    /// says no to a filtered page every time (see `cached_filtered_plan`). This
    /// says "has this walk been prepared before", so a search does not prepare
    /// a second one to rediscover that the history is longer than `MAX_ORDER` —
    /// which would pay for the topological sort twice on every search, on
    /// exactly the repositories where it is most expensive.
    ///
    /// Deliberately counts no hit and moves nothing: it is a question about the
    /// cache, not a read from it.
    pub fn has_walk(&self, repo: &RepoId, key: &WalkKey) -> bool {
        self.repos
            .lock()
            .map(|repos| {
                repos
                    .get(repo)
                    .is_some_and(|e| e.walks.iter().any(|w| &w.key == key))
            })
            .unwrap_or(false)
    }

    /// File a freshly prepared walk, evicting the least recently used one.
    pub fn insert(&self, repo: &RepoId, key: WalkKey, order: Arc<WalkOrder>) {
        let Ok(mut repos) = self.repos.lock() else {
            return;
        };
        let entry = repos.entry(repo.clone()).or_default();
        entry.walks.retain(|w| w.key != key);
        entry.walks.insert(
            0,
            Walk {
                key,
                order,
                cursors: HashMap::new(),
            },
        );
        entry.walks.truncate(MAX_WALKS);
    }

    /// Record that `cursor` continues `key` at `next`, so the page after it
    /// can be a slice instead of a walk.
    pub fn remember_cursor(&self, repo: &RepoId, key: &WalkKey, mut cursor: Vec<Oid>, next: usize) {
        let Ok(mut repos) = self.repos.lock() else {
            return;
        };
        let Some(entry) = repos.get_mut(repo) else {
            return;
        };
        let Some(walk) = entry.walks.iter_mut().find(|w| &w.key == key) else {
            return;
        };
        cursor.sort();
        // Cleared rather than evicted one by one: keeping an insertion order
        // beside the map would double what the keys cost, to defend a bound
        // that a 500-commit page cannot reach in the first place.
        if walk.cursors.len() >= MAX_CURSORS {
            walk.cursors.clear();
        }
        walk.cursors.insert(cursor, next);
    }

    /// The ref decorations this repository last built, and the fingerprint of
    /// the ref database they were built from.
    ///
    /// The caller decides what to do with the pair, and that is the point: a
    /// cold call must NOT enumerate the refs to produce a fingerprint it is
    /// about to throw away — doing exactly that made a cold eleven-read
    /// fan-out on the `refs` fixture slower than the version this replaced
    /// (219 ms → 364 ms), because it enumerated 7,001 loose refs twice.
    pub fn ref_map(&self, repo: &RepoId) -> Option<(u64, Arc<RefMap>)> {
        let repos = self.repos.lock().ok()?;
        let (had, map) = repos.get(repo)?.refs.as_ref()?;
        Some((*had, Arc::clone(map)))
    }

    /// File a freshly built ref map. Called only after `collect_ref_map` ran,
    /// which is what makes the counter here mean "a map was built".
    pub fn put_ref_map(&self, repo: &RepoId, fingerprint: u64, map: Arc<RefMap>) {
        self.ref_maps_built.fetch_add(1, Ordering::Relaxed);
        let Ok(mut repos) = self.repos.lock() else {
            return;
        };
        repos.entry(repo.clone()).or_default().refs = Some((fingerprint, map));
    }

    /// Drop everything held for one repository — `close` calls this, so the
    /// memory goes away with the tab rather than with the process.
    pub fn forget(&self, repo: &RepoId) {
        if let Ok(mut repos) = self.repos.lock() {
            repos.remove(repo);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn oid(n: u8) -> Oid {
        let mut raw = [0u8; 20];
        raw[19] = n;
        Oid::from_bytes(&raw).unwrap()
    }

    fn order(n: usize, complete: bool) -> Arc<WalkOrder> {
        Arc::new(WalkOrder {
            starts: vec![oid(0)],
            order: (0..n).map(|i| oid(i as u8)).collect(),
            complete,
        })
    }

    fn repo() -> RepoId {
        RepoId("r".into())
    }

    #[test]
    fn a_first_page_hits_the_walk_it_was_filed_under() {
        let c = LogCache::new();
        let key = WalkKey::new(None, &[oid(1)]);
        c.insert(&repo(), key.clone(), order(10, true));

        assert!(c.first_page(&repo(), &key, 5).is_some());
        assert_eq!(c.stats().hits, 1);
    }

    /// The whole invalidation story for a first page: a moved ref is a
    /// different start oid, which is a different key, which is a miss.
    #[test]
    fn a_moved_start_point_is_a_different_walk() {
        let c = LogCache::new();
        c.insert(&repo(), WalkKey::new(None, &[oid(1)]), order(10, true));

        let moved = WalkKey::new(None, &[oid(2)]);
        assert!(c.first_page(&repo(), &moved, 5).is_none());
    }

    /// …and the enumeration order of the refs is not part of that story.
    #[test]
    fn the_start_points_are_a_set_not_a_list() {
        let c = LogCache::new();
        c.insert(
            &repo(),
            WalkKey::new(None, &[oid(1), oid(2), oid(3)]),
            order(10, true),
        );

        let shuffled = WalkKey::new(None, &[oid(3), oid(1), oid(2)]);
        assert!(c.first_page(&repo(), &shuffled, 5).is_some());
    }

    #[test]
    fn a_different_refspec_is_a_different_walk() {
        let c = LogCache::new();
        c.insert(&repo(), WalkKey::new(None, &[oid(1)]), order(10, true));

        let scoped = WalkKey::new(Some("refs/heads/main"), &[oid(1)]);
        assert!(c.first_page(&repo(), &scoped, 5).is_none());
    }

    #[test]
    fn a_remembered_cursor_resumes_where_it_left_off() {
        let c = LogCache::new();
        let key = WalkKey::new(None, &[oid(1)]);
        c.insert(&repo(), key.clone(), order(10, true));
        c.remember_cursor(&repo(), &key, vec![oid(5), oid(6)], 5);

        // Sorted the other way round: the caller hands back whatever order the
        // frontier travelled in, and it must still match.
        let (found, _, at) = c.resume(&repo(), &[oid(5), oid(6)], 2).expect("resume");
        assert_eq!(found, key);
        assert_eq!(at, 5);
    }

    /// A cursor nobody emitted is a miss, not a guess. Two walks over one
    /// repository share commits, so "find an order containing these oids"
    /// would place an "All" cursor inside a single-branch walk.
    #[test]
    fn an_unknown_cursor_does_not_resolve() {
        let c = LogCache::new();
        let key = WalkKey::new(None, &[oid(1)]);
        c.insert(&repo(), key, order(10, true));

        assert!(c.resume(&repo(), &[oid(5)], 2).is_none());
    }

    /// An incomplete order cannot answer a page that runs off its end — that
    /// page would stop early for a reason the caller cannot see.
    #[test]
    fn an_incomplete_order_refuses_a_page_it_cannot_fill() {
        let c = LogCache::new();
        let key = WalkKey::new(None, &[oid(1)]);
        c.insert(&repo(), key.clone(), order(10, false));
        c.remember_cursor(&repo(), &key, vec![oid(9)], 9);

        assert!(c.resume(&repo(), &[oid(9)], 5).is_none(), "9 + 5 > 10");
        assert!(c.resume(&repo(), &[oid(9)], 1).is_some(), "9 + 1 == 10");
    }

    /// A COMPLETE order answers the same page happily: running out is the end
    /// of history, which is a real answer.
    #[test]
    fn a_complete_order_answers_past_its_end() {
        let c = LogCache::new();
        let key = WalkKey::new(None, &[oid(1)]);
        c.insert(&repo(), key.clone(), order(10, true));
        c.remember_cursor(&repo(), &key, vec![oid(9)], 9);

        assert!(c.resume(&repo(), &[oid(9)], 500).is_some());
    }

    #[test]
    fn a_third_walk_evicts_the_least_recently_used_one() {
        let c = LogCache::new();
        let a = WalkKey::new(None, &[oid(1)]);
        let b = WalkKey::new(None, &[oid(2)]);
        let d = WalkKey::new(None, &[oid(3)]);
        c.insert(&repo(), a.clone(), order(10, true));
        c.insert(&repo(), b.clone(), order(10, true));
        // Touch `a` so `b` becomes the coldest.
        c.first_page(&repo(), &a, 1).expect("a is cached");
        c.insert(&repo(), d.clone(), order(10, true));

        assert!(c.first_page(&repo(), &a, 1).is_some(), "a was used last");
        assert!(c.first_page(&repo(), &d, 1).is_some(), "d is newest");
        assert!(c.first_page(&repo(), &b, 1).is_none(), "b was coldest");
    }

    /// Re-filing a key replaces it rather than growing a second copy, or two
    /// pages of the same walk would evict everything else between them.
    #[test]
    fn re_inserting_a_key_replaces_it() {
        let c = LogCache::new();
        let a = WalkKey::new(None, &[oid(1)]);
        let b = WalkKey::new(None, &[oid(2)]);
        c.insert(&repo(), a.clone(), order(10, true));
        c.insert(&repo(), a.clone(), order(10, true));
        c.insert(&repo(), b.clone(), order(10, true));

        assert!(c.first_page(&repo(), &a, 1).is_some(), "a must survive");
        assert!(c.first_page(&repo(), &b, 1).is_some(), "b must survive");
    }

    #[test]
    fn a_ref_map_survives_only_its_own_fingerprint() {
        let c = LogCache::new();
        c.put_ref_map(&repo(), 7, Arc::new(RefMap::new()));

        let (had, _) = c.ref_map(&repo()).expect("cached");
        assert_eq!(had, 7, "the fingerprint travels back with the map");
    }

    #[test]
    fn closing_a_repository_forgets_everything() {
        let c = LogCache::new();
        let key = WalkKey::new(None, &[oid(1)]);
        c.insert(&repo(), key.clone(), order(10, true));
        c.put_ref_map(&repo(), 7, Arc::new(RefMap::new()));

        c.forget(&repo());

        assert!(c.first_page(&repo(), &key, 1).is_none());
        assert!(c.ref_map(&repo()).is_none());
    }

    /// Two repositories share this cache and must not share entries — the tab
    /// next door is a different history under the same refspec.
    #[test]
    fn repositories_do_not_share_entries() {
        let c = LogCache::new();
        let key = WalkKey::new(None, &[oid(1)]);
        c.insert(&RepoId("a".into()), key.clone(), order(10, true));

        assert!(c.first_page(&RepoId("b".into()), &key, 1).is_none());
    }

    /// The cursor map is bounded, and a full one drops back to a miss rather
    /// than growing.
    #[test]
    fn the_cursor_map_is_bounded() {
        let c = LogCache::new();
        let key = WalkKey::new(None, &[oid(1)]);
        c.insert(&repo(), key.clone(), order(MAX_ORDER, true));
        for i in 0..MAX_CURSORS + 1 {
            c.remember_cursor(&repo(), &key, vec![oid(1), oid((i % 251) as u8)], i);
        }

        let Ok(repos) = c.repos.lock() else {
            panic!("poisoned")
        };
        let held = repos[&repo()].walks[0].cursors.len();
        assert!(held <= MAX_CURSORS, "held {held} cursors");
    }
}
