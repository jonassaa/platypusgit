//! The large-repo benchmark (issue 257).
//!
//! "Slow on big repositories" is the one structural complaint every established
//! GUI client shares, and "fast" is one of this project's two strongest claims.
//! Until this file existed the claim was an adjective. What it produces is a
//! number per operation per fixture, in a JSON document `scripts/bench.sh`
//! renders into `docs/dev/performance.md` and into the figure the marketing site
//! prints — so a regression shows up as a smaller claim rather than as a
//! stranger's bug report.
//!
//! ## What it measures, and what it therefore does not
//!
//! It drives `Libgit2Backend` — the real backend, through the real `GitBackend`
//! trait, with no test doubles anywhere. That is the layer where a big
//! repository is actually expensive, and it is the layer a regression lands in.
//!
//! It stops at the IPC boundary. There is no webview here, so nothing below
//! measures React rendering, and the honest name for every number is "what the
//! backend costs", not "what the user waits". Two things narrow that gap on
//! purpose:
//!
//!   * `open_screen` runs the ELEVEN reads `useRepoStore.refreshAll` issues,
//!     simultaneously, from separate threads — the real fan-out, including
//!     whatever the per-repository lock does to it. A composite is the only
//!     number that can catch "a slow status blocks everything else on that
//!     repo", which is the trap `git/repo_locks.rs` exists to avoid and the one
//!     an op-at-a-time benchmark is structurally blind to.
//!   * `open_screen_ipc` is the same fan-out plus `serde_json` encoding of every
//!     payload, because that encoding is real work on a 500-commit page and it
//!     happens before the frontend sees a byte.
//!
//! The render on top of those is bounded by the window, not by the repository:
//! the log is paged at 500, diff rows are windowed, and long lists are
//! virtualised. That is the argument for why the backend number is the
//! interesting one — it is not a proof, and `docs/dev/performance.md` says so.
//!
//! ## "first" and "repeat", not "cold" and "warm"
//!
//! `first` is one call on a freshly constructed backend and a freshly opened
//! repository, which is what happens when you open a repository in the app:
//! libgit2's object database, ref database and pack indices are all unbuilt.
//! `repeat` is the median of many calls on that same handle.
//!
//! Neither purges the operating system's file cache, and the words "cold" and
//! "warm" are avoided because they would imply it did. A first-boot number is
//! larger than anything here, by an amount that depends on the disk rather than
//! on this code.
//!
//! ## The `git` baseline
//!
//! Every op that a single `git` invocation can answer is also measured as that
//! invocation. The point is NOT to win: `git` is the floor, and a ratio near it
//! is the good outcome. The point is that a ratio is a comparison a reader can
//! check on their own machine, in a way that a bare millisecond figure from
//! somebody else's laptop is not — and a ratio that doubles is a regression
//! even on a machine that got faster.
//!
//! The baselines are chosen to ask the SAME question, not the cheapest one that
//! shares a name. `status` here is the clearest case: `GitBackend::status`
//! returns per-file added/removed counts, so its baseline is
//! `git status --porcelain` plus both `--numstat` diffs, and comparing it to a
//! bare `git status` would be comparing it to less work than it does.
//!
//! ## Why this lives in `benches/` and spawns processes directly
//!
//! `benches/` is outside the tree `tests/spawn_no_window.rs` guards, and the
//! `Command::new` calls below are deliberate rather than an oversight of that
//! rule: the rule exists so no SHIPPED spawn opens a console window on Windows,
//! and nothing in this file ships. It is behind `required-features = ["bench"]`
//! for the same reason — `cargo test` and `cargo check` must not pay to build
//! it.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Barrier};
use std::time::{Duration, Instant};

use platypusgit_lib::git::libgit2::Libgit2Backend;
use platypusgit_lib::git::types::{DiffKind, RepoId};
use platypusgit_lib::git::GitBackend;

/// The log page size the frontend asks for (`PAGE_SIZE` in `useRepoStore.ts`).
/// Hard-coded rather than shared because the two trees do not share constants —
/// if that one changes, this one has to change with it or the benchmark stops
/// measuring the thing the app does.
const PAGE_SIZE: usize = 500;

/// How deep `log_page_deep` walks before timing a page. Ten pages in is past
/// anything a first screen touches, which is the point: the paged tail is where
/// a naive implementation re-walks history from the top every time.
const DEEP_PAGES: usize = 10;

/// Diff context lines, matching the app's default.
const CONTEXT: u32 = 3;

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

fn ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

fn time<T>(f: impl FnOnce() -> T) -> (f64, T) {
    let at = Instant::now();
    let out = f();
    (ms(at.elapsed()), out)
}

/// Summary statistics over the repeat samples.
///
/// Median rather than mean, and p95 alongside it, because the distribution is
/// not symmetric: one sample in a run lands on a page fault or a scheduler
/// hiccup and drags a mean somewhere the operation never actually was. The
/// samples are kept in the JSON too, so anyone who disagrees with the summary
/// can compute their own.
#[derive(Clone)]
struct Stats {
    n: usize,
    min: f64,
    median: f64,
    p95: f64,
    max: f64,
}

impl Stats {
    fn of(samples: &[f64]) -> Option<Stats> {
        if samples.is_empty() {
            return None;
        }
        let mut s = samples.to_vec();
        s.sort_by(|a, b| a.partial_cmp(b).unwrap());
        // Nearest-rank p95: with ten samples that is the worst one, which is
        // the honest reading of "95th percentile of ten measurements".
        let rank = ((0.95 * s.len() as f64).ceil() as usize).max(1) - 1;
        Some(Stats {
            n: s.len(),
            min: s[0],
            median: if s.len() % 2 == 1 {
                s[s.len() / 2]
            } else {
                (s[s.len() / 2 - 1] + s[s.len() / 2]) / 2.0
            },
            p95: s[rank],
            max: s[s.len() - 1],
        })
    }
}

/// One measured operation.
struct Measured {
    /// Stable machine key. The doc renderer and the guard test both key on it.
    key: &'static str,
    /// What the operation is, in the words the published table uses.
    label: &'static str,
    /// One call on a fresh handle. `None` when the op has no meaningful
    /// first-call form (the composites open their own handle).
    first_ms: Option<f64>,
    samples: Vec<f64>,
    /// What came back — "55,000 entries", "500 commits". A timing with no size
    /// beside it cannot be sanity-checked by a reader, and a benchmark that
    /// silently started measuring an empty result is the classic way to publish
    /// an excellent number for nothing at all.
    scale: String,
    /// The `git` invocation asking the same question, and what it cost.
    baseline: Option<Baseline>,
}

struct Baseline {
    command: String,
    /// How many processes one sample launched. A baseline can be several
    /// invocations (see `status`), and each one pays the spawn floor, so the
    /// count is what makes "is this comparable at all?" answerable downstream.
    invocations: usize,
    samples: Vec<f64>,
}

// ---------------------------------------------------------------------------
// The git baseline
// ---------------------------------------------------------------------------

/// Run one or more `git` invocations and return their combined wall time.
///
/// A list rather than one command because some of our single calls genuinely
/// are several of git's — see the `status` note in the module doc. Output is
/// discarded to a null sink so the measurement is git's work rather than the
/// terminal's.
fn git_time(repo: &Path, invocations: &[&[&str]]) -> f64 {
    let at = Instant::now();
    for args in invocations {
        let status = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(*args)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .expect("spawn git");
        assert!(status.success(), "git {args:?} failed in {}", repo.display());
    }
    ms(at.elapsed())
}

/// What one `git` invocation costs before it has done anything.
///
/// Every baseline below pays for a `fork`, an `exec`, the dynamic loader and
/// git's own start-up, and on this class of machine that is over ten
/// milliseconds — more than most of the operations being measured take in
/// total. Without this number the table would report that we open a repository
/// a hundred times faster than `git`, which is true and meaningless: what it
/// measures is process creation.
///
/// `rev-parse --git-dir` is the cheapest invocation that still opens the
/// repository, so it is the floor rather than a lower bound nothing can reach.
/// `measured_json` drops the ratio for any baseline within twice it.
fn spawn_floor_ms(repo: &Path) -> f64 {
    let once = || git_time(repo, &[&["rev-parse", "--git-dir"]]);
    once();
    let mut samples: Vec<f64> = (0..10).map(|_| once()).collect();
    samples.sort_by(|a, b| a.partial_cmp(b).unwrap());
    samples[samples.len() / 2]
}

fn render_command(invocations: &[&[&str]]) -> String {
    invocations
        .iter()
        .map(|a| format!("git {}", a.join(" ")))
        .collect::<Vec<_>>()
        .join(" && ")
}

fn measure_baseline(repo: &Path, cfg: &Config, invocations: &[&[&str]]) -> Option<Baseline> {
    if !cfg.baseline {
        return None;
    }
    // One untimed run first: the first `git` of a run pays for loading the
    // binary and its libraries, which is a cost the app never pays twice
    // either. It doubles as the estimate the repeat count comes from.
    let estimate = git_time(repo, invocations);
    let samples = (0..repeats(estimate, cfg))
        .map(|_| git_time(repo, invocations))
        .collect();
    Some(Baseline {
        command: render_command(invocations),
        invocations: invocations.len(),
        samples,
    })
}

// ---------------------------------------------------------------------------
// The measured operations
// ---------------------------------------------------------------------------

/// Everything the harness needs to know about the repository before it can
/// choose paths and revisions to measure against. Derived from the repository
/// rather than configured, so the same command works on any fixture.
struct Subject {
    path: PathBuf,
    head_oid: String,
    /// The path changed most often in recent history.
    ///
    /// NOT simply "a path HEAD touched", which is the obvious choice and is
    /// unusable: `file_history` filters a walk by path and stops at `limit`
    /// matches, so on a rarely-touched file it never reaches 500 and walks the
    /// WHOLE history with a tree comparison per commit. On `torvalds/linux`
    /// that is 1.4 million commits and the benchmark simply does not finish.
    ///
    /// A hot file is also the honest subject: file history is a thing people
    /// open on files that change. The pathological case is real and is written
    /// up in `docs/dev/performance.md` rather than measured here, because
    /// "unbounded" is not a number.
    hot_path: Option<PathBuf>,
    /// A path the working tree has modified, if any. `None` on a clean fixture,
    /// which simply skips the worktree diff.
    dirty_path: Option<PathBuf>,
}

/// The path touched by the most of the last 2,000 commits.
///
/// Asked of `git` rather than computed here: this is fixture selection, not a
/// measurement, and one `git log --name-only` is both faster and less code than
/// walking it ourselves. A window of 2,000 keeps it cheap even on a repository
/// with over a million commits, and any file that is hot in the last 2,000 is
/// hot enough to bound the walk being measured.
fn hottest_path(repo: &Path) -> Option<PathBuf> {
    let out = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["log", "--max-count=2000", "--name-only", "--format=", "HEAD"])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for line in text.lines().filter(|l| !l.trim().is_empty()) {
        *counts.entry(line).or_default() += 1;
    }
    // Ties broken by name so the choice is deterministic across runs on the
    // same repository — otherwise the fixture silently changes under the
    // numbers.
    counts
        .into_iter()
        .max_by(|a, b| a.1.cmp(&b.1).then_with(|| b.0.cmp(a.0)))
        .map(|(p, _)| PathBuf::from(p))
}

fn probe(path: &Path) -> Subject {
    let backend = Libgit2Backend::new();
    let handle = backend.open(path).expect("open the repository");
    let head = backend.head_info(&handle.id).expect("head_info");
    let head_oid = head.head_oid.clone().expect("the fixture has commits");

    let hot_path = hottest_path(path).or_else(|| {
        backend
            .diff_commit(&handle.id, &head_oid, 0, false)
            .ok()
            .and_then(|diffs| diffs.into_iter().next())
            .map(|d| PathBuf::from(d.path))
    });

    let dirty_path = backend.status(&handle.id).ok().and_then(|entries| {
        entries
            .into_iter()
            .find(|e| matches!(e.worktree, platypusgit_lib::git::types::StatusFlag::Modified))
            .map(|e| PathBuf::from(e.path))
    });

    Subject {
        path: path.to_path_buf(),
        head_oid,
        hot_path,
        dirty_path,
    }
}

struct Config {
    /// The MOST repeats any operation takes. What it actually takes is
    /// `repeats()`, below.
    iterations: usize,
    /// `spawn_floor_ms`, measured once per run. A baseline within twice it is
    /// reported without a ratio.
    floor_ms: f64,
    warmup: usize,
    baseline: bool,
    /// Roughly how long one operation's repeats may take, in milliseconds.
    budget_ms: f64,
}

/// Never fewer than this many repeats: a median of two is the mean of two, and
/// a single sample is not a measurement at all.
const MIN_REPEATS: usize = 3;

/// How many repeats to actually take, given what the first call cost.
///
/// A fixed count is wrong at both ends. Ten repeats of a 0.15 ms operation is a
/// rounding error's worth of extra confidence; ten repeats of an eight-second
/// log page on a kernel clone is thirteen minutes for one row of one table, and
/// a benchmark nobody has time to finish produces no numbers at all.
///
/// The budget is per operation, not per run, so the cheap operations keep the
/// sample count their variance actually needs. Each row records how many
/// samples it took, so the table never implies a confidence it does not have.
fn repeats(first_ms: f64, cfg: &Config) -> usize {
    if first_ms <= 0.0 {
        return cfg.iterations;
    }
    let affordable = (cfg.budget_ms / first_ms).floor() as usize;
    affordable.clamp(MIN_REPEATS, cfg.iterations)
}

/// Warm-up is skipped outright once one call would eat half the budget. Its
/// purpose is to settle caches that a slow operation has already settled by
/// being slow.
fn warmups(first_ms: f64, cfg: &Config) -> usize {
    if first_ms * cfg.warmup as f64 > cfg.budget_ms / 2.0 {
        0
    } else {
        cfg.warmup
    }
}

/// Measure one op: a first call on a brand-new backend, then `iterations`
/// repeats on a single handle.
///
/// The fresh backend is what makes `first` mean anything — `Libgit2Backend`
/// caches a `Repository` per `RepoId`, so reusing one would measure libgit2's
/// caches rather than the work of building them.
fn measure<T>(
    key: &'static str,
    label: &'static str,
    subject: &Subject,
    cfg: &Config,
    scale: impl Fn(&T) -> String,
    op: impl Fn(&Libgit2Backend, &RepoId) -> T,
) -> Measured {
    // Progress on stderr, never on stdout: stdout is the JSON document when no
    // `--out` is given. A run against a real kernel clone takes minutes, and a
    // benchmark that spends them in silence is a benchmark people kill halfway
    // and conclude is hung.
    eprint!("  {key} … ");
    let started = Instant::now();
    let first_ms = {
        let backend = Libgit2Backend::new();
        let handle = backend.open(&subject.path).expect("open");
        let (t, _) = time(|| op(&backend, &handle.id));
        t
    };

    let backend = Libgit2Backend::new();
    let handle = backend.open(&subject.path).expect("open");
    for _ in 0..warmups(first_ms, cfg) {
        op(&backend, &handle.id);
    }
    let n = repeats(first_ms, cfg);
    let mut samples = Vec::with_capacity(n);
    let mut last = None;
    for _ in 0..n {
        let (t, out) = time(|| op(&backend, &handle.id));
        samples.push(t);
        last = Some(out);
    }

    let scale = last.as_ref().map(scale).unwrap_or_default();
    eprintln!("{scale} in {:.1}s", started.elapsed().as_secs_f64());

    Measured {
        key,
        label,
        first_ms: Some(first_ms),
        samples,
        scale,
        baseline: None,
    }
}

fn with_baseline(mut m: Measured, b: Option<Baseline>) -> Measured {
    m.baseline = b;
    m
}

/// The eleven reads `refreshAll` issues, all at once.
///
/// A `Barrier` rather than "spawn eleven threads and hope": spawning is slow
/// enough that the first read can finish before the last starts, which would
/// quietly turn the one measurement that exists to find lock contention into a
/// measurement with no contention in it.
fn open_screen(subject: &Subject, encode: bool) -> f64 {
    let backend = Arc::new(Libgit2Backend::new());
    let handle = backend.open(&subject.path).expect("open");
    let id = handle.id.clone();

    const N: usize = 11;
    let gate = Arc::new(Barrier::new(N + 1));
    let mut threads = Vec::with_capacity(N);
    for slot in 0..N {
        let backend = Arc::clone(&backend);
        let gate = Arc::clone(&gate);
        let id = id.clone();
        threads.push(std::thread::spawn(move || {
            gate.wait();
            // Each arm produces the JSON the command handler would return, so
            // `encode` can charge for the same bytes the webview receives.
            let json = match slot {
                0 => serde_json::to_string(&backend.status(&id).expect("status")),
                1 => serde_json::to_string(&backend.branches(&id).expect("branches")),
                2 => serde_json::to_string(&backend.tags(&id).expect("tags")),
                3 => serde_json::to_string(&backend.stashes(&id).expect("stashes")),
                4 => serde_json::to_string(&backend.remotes(&id).expect("remotes")),
                5 => serde_json::to_string(
                    &backend
                        .log_page(&id, None, None, PAGE_SIZE)
                        .expect("log_page"),
                ),
                6 => serde_json::to_string(&backend.repo_state(&id).expect("repo_state")),
                7 => serde_json::to_string(&backend.rebase_status(&id).expect("rebase_status")),
                8 => serde_json::to_string(&backend.bisect_status(&id).expect("bisect_status")),
                9 => serde_json::to_string(&backend.head_info(&id).expect("head_info")),
                _ => serde_json::to_string(&backend.shallow_info(&id).expect("shallow_info")),
            };
            if encode {
                // Touch the string so the encode cannot be optimised away.
                std::hint::black_box(json.expect("encode").len());
            }
        }));
    }

    gate.wait();
    let at = Instant::now();
    for t in threads {
        t.join().expect("a read panicked");
    }
    ms(at.elapsed())
}

fn measure_open_screen(key: &'static str, label: &'static str, subject: &Subject, cfg: &Config, encode: bool) -> Measured {
    eprint!("  {key} … ");
    let started = Instant::now();
    let first_ms = open_screen(subject, encode);
    for _ in 0..warmups(first_ms, cfg) {
        open_screen(subject, encode);
    }
    let samples: Vec<f64> = (0..repeats(first_ms, cfg))
        .map(|_| open_screen(subject, encode))
        .collect();
    eprintln!("11 reads in {:.1}s", started.elapsed().as_secs_f64());
    Measured {
        key,
        label,
        first_ms: Some(first_ms),
        samples,
        scale: "11 concurrent reads".to_string(),
        baseline: None,
    }
}

fn thousands(n: usize) -> String {
    let s = n.to_string();
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    out
}

fn run_suite(subject: &Subject, cfg: &Config) -> Vec<Measured> {
    let repo = subject.path.as_path();
    let mut out = Vec::new();

    // Opening the repository is its own cost, and on a repository with 5,000
    // refs it is not a rounding error.
    //
    // Measured on its own rather than through `measure`, because `open` is the
    // one op for which "repeat it on an existing handle" is meaningless: every
    // call has to build a new one, so `first` and `repeat` measure the same
    // thing and the samples are simply that thing many times.
    let open_first = {
        let backend = Libgit2Backend::new();
        time(|| backend.open(&subject.path).expect("open")).0
    };
    let open_samples: Vec<f64> = (0..repeats(open_first, cfg))
        .map(|_| {
            let backend = Libgit2Backend::new();
            time(|| backend.open(&subject.path).expect("open")).0
        })
        .collect();
    out.push(Measured {
        key: "open",
        label: "Open the repository",
        first_ms: Some(open_first),
        samples: open_samples,
        scale: "a fresh handle".to_string(),
        baseline: measure_baseline(repo, cfg, &[&["rev-parse", "HEAD"]]),
    });

    out.push(with_baseline(
        measure(
            "status",
            "Working-tree status",
            subject,
            cfg,
            |v: &Vec<platypusgit_lib::git::types::FileStatus>| {
                format!("{} entries", thousands(v.len()))
            },
            |b, id| b.status(id).expect("status"),
        ),
        // Three invocations because one `GitBackend::status` answers all three
        // questions: what changed, and how many lines on each side.
        measure_baseline(
            repo,
            cfg,
            &[
                &["status", "--porcelain=v1", "--untracked-files=all"],
                &["diff", "--numstat"],
                &["diff", "--cached", "--numstat"],
            ],
        ),
    ));

    out.push(with_baseline(
        measure(
            "log_first_page",
            "First page of history (500 commits)",
            subject,
            cfg,
            |p: &platypusgit_lib::git::types::LogPage| {
                format!("{} commits", thousands(p.commits.len()))
            },
            |b, id| b.log_page(id, None, None, PAGE_SIZE).expect("log_page"),
        ),
        // `--topo-order`, because `log_page` walks with
        // `Sort::TIME | Sort::TOPOLOGICAL` and the commit graph's lanes depend
        // on it — a plain `git log` is a strictly easier question and quoting
        // it here would be the `status` mistake in the module doc, made the
        // other way round.
        //
        // Measured, not assumed: on the `deep` fixture a default `git log -500`
        // is 41 ms and `--topo-order` is 284 ms, against our 275 ms. The first
        // page is at PARITY. Comparing against the 41 ms would have published a
        // fourteen-fold regression that does not exist.
        measure_baseline(
            repo,
            cfg,
            &[&[
                "log",
                "--topo-order",
                "--max-count=500",
                "--format=%H%n%an%n%ae%n%at%n%s",
            ]],
        ),
    ));

    // The paged tail. `s.commits` is a prefix of history, so scrolling past the
    // first screen is a real backend call, and it is the one that gets slower
    // the further in you are if the walk is restarted each time.
    out.push(with_baseline(
        measure(
            "log_page_deep",
            "Page 10 of history (commits 4,501–5,000)",
            subject,
            cfg,
            |p: &platypusgit_lib::git::types::LogPage| {
                format!("{} commits", thousands(p.commits.len()))
            },
            |b, id| {
                let mut page = b.log_page(id, None, None, PAGE_SIZE).expect("log_page");
                for _ in 1..DEEP_PAGES {
                    // A fixture shallower than ten pages simply stops early and
                    // reports the last page it reached — the `scale` column says
                    // how many commits that was, so a short result is visible
                    // rather than passed off as a fast one.
                    let Some(cursor) = page.next_cursor.clone() else { break };
                    page = b
                        .log_page(id, None, Some(&cursor), PAGE_SIZE)
                        .expect("log_page");
                }
                page
            },
        ),
        // Same order, and `--skip` rather than ten invocations on purpose: git
        // pays for the topological sort ONCE and then skips. That asymmetry is
        // the point of this row — it is what turns "we are at parity on page
        // one" into a number for what paging actually costs.
        measure_baseline(
            repo,
            cfg,
            &[&[
                "log",
                "--topo-order",
                "--skip=4500",
                "--max-count=500",
                "--format=%H%n%an%n%ae%n%at%n%s",
            ]],
        ),
    ));

    out.push(with_baseline(
        measure(
            "branches",
            "List every branch",
            subject,
            cfg,
            |v: &Vec<platypusgit_lib::git::types::BranchInfo>| {
                format!("{} branches", thousands(v.len()))
            },
            |b, id| b.branches(id).expect("branches"),
        ),
        measure_baseline(
            repo,
            cfg,
            &[&[
                "for-each-ref",
                "--format=%(refname)%(objectname)%(upstream)",
                "refs/heads",
                "refs/remotes",
            ]],
        ),
    ));

    out.push(with_baseline(
        measure(
            "tags",
            "List every tag",
            subject,
            cfg,
            |v: &Vec<platypusgit_lib::git::types::TagInfo>| format!("{} tags", thousands(v.len())),
            |b, id| b.tags(id).expect("tags"),
        ),
        measure_baseline(
            repo,
            cfg,
            &[&[
                "for-each-ref",
                "--format=%(refname)%(objectname)%(*objectname)",
                "refs/tags",
            ]],
        ),
    ));

    let head_oid = subject.head_oid.clone();
    out.push(with_baseline(
        measure(
            "diff_commit",
            "Diff the selected commit",
            subject,
            cfg,
            |v: &Vec<platypusgit_lib::git::types::FileDiff>| format!("{} files", thousands(v.len())),
            move |b, id| b.diff_commit(id, &head_oid, CONTEXT, false).expect("diff_commit"),
        ),
        measure_baseline(
            repo,
            cfg,
            &[&["show", "--format=", "--patch", "HEAD"]],
        ),
    ));

    if let Some(path) = subject.hot_path.clone() {
        let for_history = path.clone();
        out.push(with_baseline(
            measure(
                "file_history",
                "History of one file (500 commits)",
                subject,
                cfg,
                |v: &Vec<platypusgit_lib::git::types::CommitInfo>| {
                    format!("{} commits", thousands(v.len()))
                },
                move |b, id| b.file_history(id, &for_history, PAGE_SIZE).expect("file_history"),
            ),
            // Deliberately NOT `--follow`. `Libgit2Backend::file_history` is a
            // plain path filter over the walk — it does not detect renames — so
            // a `--follow` baseline would be asking the harder question and
            // flattering us with the difference.
            measure_baseline(
                repo,
                cfg,
                &[&[
                    "log",
                    "--topo-order",
                    "--max-count=500",
                    "--format=%H%n%an%n%at%n%s",
                    "--",
                    path.to_str().expect("utf-8 fixture path"),
                ]],
            ),
        ));
    }

    if let Some(path) = subject.dirty_path.clone() {
        out.push(with_baseline(
            measure(
                "diff_workdir_file",
                "Diff one modified file",
                subject,
                cfg,
                |d: &platypusgit_lib::git::types::FileDiff| format!("{} hunks", d.hunks.len()),
                move |b, id| {
                    b.diff(id, &path, DiffKind::WorktreeToIndex, CONTEXT, false)
                        .expect("diff")
                },
            ),
            None,
        ));
    }

    out.push(with_baseline(
        measure(
            "list_all_files",
            "Browse the whole tree",
            subject,
            cfg,
            |v: &Vec<platypusgit_lib::git::types::FileStatus>| {
                format!("{} files", thousands(v.len()))
            },
            |b, id| b.list_all_files(id).expect("list_all_files"),
        ),
        measure_baseline(
            repo,
            cfg,
            &[&["ls-files", "--cached", "--others", "--exclude-standard"]],
        ),
    ));

    out.push(measure_open_screen(
        "open_screen",
        "Everything the first screen needs, at once",
        subject,
        cfg,
        false,
    ));
    out.push(measure_open_screen(
        "open_screen_ipc",
        "…including encoding it all for the webview",
        subject,
        cfg,
        true,
    ));

    out
}

// ---------------------------------------------------------------------------
// The soak
// ---------------------------------------------------------------------------

/// Resident set size of this process, in megabytes.
///
/// `ps` rather than a crate: adding a dependency to the shipped manifest for a
/// benchmark would put it in the dependency tree the privacy guard reads, and
/// one subprocess every few seconds is beneath the noise of what is being
/// measured.
fn rss_mb() -> Option<f64> {
    let out = Command::new("ps")
        .args(["-o", "rss=", "-p", &std::process::id().to_string()])
        .output()
        .ok()?;
    let kb: f64 = String::from_utf8_lossy(&out.stdout).trim().parse().ok()?;
    Some(kb / 1024.0)
}

/// "Jank after a while" is the complaint nobody else answers, so it gets its own
/// mode: repeat the whole first-screen fan-out for `minutes` and report both
/// what memory did and whether the operation itself got slower.
///
/// Reported as two halves rather than a slope, because a slope invites reading
/// a trend into noise. First half versus second half of the same run, on the
/// same machine, is a comparison that either shows something or does not.
fn soak(subject: &Subject, minutes: f64) -> JsonValue {
    let until = Instant::now() + Duration::from_secs_f64(minutes * 60.0);
    let start_rss = rss_mb();
    let mut peak = start_rss.unwrap_or(0.0);
    let mut samples: Vec<f64> = Vec::new();

    while Instant::now() < until {
        samples.push(open_screen(subject, true));
        if let Some(r) = rss_mb() {
            peak = peak.max(r);
        }
    }

    let end_rss = rss_mb();
    let half = samples.len() / 2;
    let first_half = Stats::of(&samples[..half]);
    let second_half = Stats::of(&samples[half..]);

    JsonValue::Ordered(vec![
        ("minutes".into(), json_num(minutes)),
        ("iterations".into(), json_num(samples.len() as f64)),
        ("rssStartMb".into(), start_rss.map(json_num).unwrap_or(json_null())),
        ("rssEndMb".into(), end_rss.map(json_num).unwrap_or(json_null())),
        ("rssPeakMb".into(), json_num(peak)),
        (
            "firstHalfMedianMs".into(),
            first_half.map(|s| json_num(s.median)).unwrap_or(json_null()),
        ),
        (
            "secondHalfMedianMs".into(),
            second_half.map(|s| json_num(s.median)).unwrap_or(json_null()),
        ),
    ])
}

// ---------------------------------------------------------------------------
// JSON output
//
// Written by hand rather than with a `Serialize` derive so the key order in the
// published file is the order it is written here. A generated file that
// reorders itself between runs makes every diff of it unreadable, and this one
// is committed.
// ---------------------------------------------------------------------------

enum JsonValue {
    Null,
    Num(f64),
    Str(String),
    Array(Vec<JsonValue>),
    /// Every object here is written in the order its fields should be READ, so
    /// a map that sorts them is the wrong container.
    Ordered(Vec<(String, JsonValue)>),
}

fn json_num(v: f64) -> JsonValue {
    // Three decimals is past the precision anything here is repeatable to, and
    // it keeps the committed file from churning on the last bit.
    JsonValue::Num((v * 1000.0).round() / 1000.0)
}
fn json_str(v: impl Into<String>) -> JsonValue {
    JsonValue::Str(v.into())
}
fn json_null() -> JsonValue {
    JsonValue::Null
}

fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

fn render(v: &JsonValue, indent: usize, out: &mut String) {
    let pad = "  ".repeat(indent);
    let inner = "  ".repeat(indent + 1);
    match v {
        JsonValue::Null => out.push_str("null"),
        JsonValue::Num(n) => {
            if n.fract() == 0.0 && n.abs() < 1e15 {
                out.push_str(&format!("{}", *n as i64));
            } else {
                out.push_str(&format!("{n}"));
            }
        }
        JsonValue::Str(s) => out.push_str(&format!("\"{}\"", escape(s))),
        JsonValue::Array(items) => {
            if items.is_empty() {
                out.push_str("[]");
                return;
            }
            out.push_str("[\n");
            for (i, item) in items.iter().enumerate() {
                out.push_str(&inner);
                render(item, indent + 1, out);
                if i + 1 < items.len() {
                    out.push(',');
                }
                out.push('\n');
            }
            out.push_str(&pad);
            out.push(']');
        }
        JsonValue::Ordered(pairs) => {
            let pairs: Vec<(String, &JsonValue)> =
                pairs.iter().map(|(k, v)| (k.clone(), v)).collect();
            render_pairs(&pairs, indent, out);
        }
    }
}

fn render_pairs(pairs: &[(String, &JsonValue)], indent: usize, out: &mut String) {
    let pad = "  ".repeat(indent);
    let inner = "  ".repeat(indent + 1);
    if pairs.is_empty() {
        out.push_str("{}");
        return;
    }
    out.push_str("{\n");
    for (i, (k, v)) in pairs.iter().enumerate() {
        out.push_str(&inner);
        out.push_str(&format!("\"{}\": ", escape(k)));
        render(v, indent + 1, out);
        if i + 1 < pairs.len() {
            out.push(',');
        }
        out.push('\n');
    }
    out.push_str(&pad);
    out.push('}');
}

fn json_render(v: &JsonValue) -> String {
    let mut s = String::new();
    render(v, 0, &mut s);
    s
}

fn measured_json(m: &Measured) -> JsonValue {
    let stats = Stats::of(&m.samples);
    let mut pairs: Vec<(String, JsonValue)> = vec![
        ("op".into(), json_str(m.key)),
        ("label".into(), json_str(m.label)),
        ("scale".into(), json_str(&m.scale)),
        (
            "firstMs".into(),
            m.first_ms.map(json_num).unwrap_or(json_null()),
        ),
        (
            "repeatMedianMs".into(),
            stats.as_ref().map(|s| json_num(s.median)).unwrap_or(json_null()),
        ),
        (
            "repeatMinMs".into(),
            stats.as_ref().map(|s| json_num(s.min)).unwrap_or(json_null()),
        ),
        (
            "repeatP95Ms".into(),
            stats.as_ref().map(|s| json_num(s.p95)).unwrap_or(json_null()),
        ),
        (
            "repeatMaxMs".into(),
            stats.as_ref().map(|s| json_num(s.max)).unwrap_or(json_null()),
        ),
        (
            "samples".into(),
            JsonValue::Num(stats.as_ref().map(|s| s.n as f64).unwrap_or(0.0)),
        ),
        (
            "sampleMs".into(),
            JsonValue::Array(m.samples.iter().copied().map(json_num).collect()),
        ),
    ];
    // No ratio is computed here, on purpose. Whether a baseline is comparable
    // at all depends on the spawn floor and on how many processes the baseline
    // is, and that judgement belongs with the thing that PUBLISHES the number —
    // `scripts/bench-report.mjs`. This file's job is to measure and to report
    // what it measured, including the invocation count that makes the judgement
    // possible.
    match &m.baseline {
        Some(b) => {
            let bs = Stats::of(&b.samples);
            pairs.push(("gitCommand".into(), json_str(&b.command)));
            pairs.push(("gitInvocations".into(), json_num(b.invocations as f64)));
            pairs.push((
                "gitMedianMs".into(),
                bs.as_ref().map(|s| json_num(s.median)).unwrap_or(json_null()),
            ));
        }
        None => {
            pairs.push(("gitCommand".into(), json_null()));
            pairs.push(("gitInvocations".into(), json_num(0.0)));
            pairs.push(("gitMedianMs".into(), json_null()));
        }
    }
    JsonValue::Ordered(pairs)
}

// ---------------------------------------------------------------------------
// Machine description
// ---------------------------------------------------------------------------

fn sysctl(key: &str) -> Option<String> {
    let out = Command::new("sysctl").args(["-n", key]).output().ok()?;
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!s.is_empty()).then_some(s)
}

fn cpu_model() -> String {
    if let Some(v) = sysctl("machdep.cpu.brand_string") {
        return v;
    }
    if let Ok(info) = std::fs::read_to_string("/proc/cpuinfo") {
        for line in info.lines() {
            if let Some(v) = line.strip_prefix("model name") {
                return v.trim_start_matches([' ', ':']).trim().to_string();
            }
        }
    }
    "unknown".into()
}

fn memory_gb() -> Option<f64> {
    if let Some(v) = sysctl("hw.memsize").and_then(|s| s.parse::<f64>().ok()) {
        return Some(v / 1024.0 / 1024.0 / 1024.0);
    }
    let info = std::fs::read_to_string("/proc/meminfo").ok()?;
    let line = info.lines().find(|l| l.starts_with("MemTotal:"))?;
    let kb: f64 = line.split_whitespace().nth(1)?.parse().ok()?;
    Some(kb / 1024.0 / 1024.0)
}

fn git_version() -> String {
    Command::new("git")
        .arg("--version")
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_else(|| "unknown".into())
}

fn machine_json() -> JsonValue {
    JsonValue::Ordered(vec![
        ("os".into(), json_str(std::env::consts::OS)),
        ("arch".into(), json_str(std::env::consts::ARCH)),
        ("cpu".into(), json_str(cpu_model())),
        (
            "cores".into(),
            json_num(
                std::thread::available_parallelism()
                    .map(|n| n.get() as f64)
                    .unwrap_or(0.0),
            ),
        ),
        (
            "memoryGb".into(),
            memory_gb().map(|g| json_num(g.round())).unwrap_or(json_null()),
        ),
        ("git".into(), json_str(git_version())),
    ])
}

// ---------------------------------------------------------------------------
// Repository description
// ---------------------------------------------------------------------------

fn count(repo: &Path, args: &[&str]) -> usize {
    Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).lines().count())
        .unwrap_or(0)
}

fn repo_json(name: &str, subject: &Subject) -> JsonValue {
    let repo = subject.path.as_path();
    let commits = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["rev-list", "--count", "HEAD"])
        .output()
        .ok()
        .and_then(|o| String::from_utf8_lossy(&o.stdout).trim().parse::<f64>().ok())
        .unwrap_or(0.0);
    JsonValue::Ordered(vec![
        ("fixture".into(), json_str(name)),
        ("commits".into(), json_num(commits)),
        (
            "trackedFiles".into(),
            json_num(count(repo, &["ls-files"]) as f64),
        ),
        (
            "branches".into(),
            json_num(count(repo, &["for-each-ref", "--format=%(refname)", "refs/heads"]) as f64),
        ),
        (
            "tags".into(),
            json_num(count(repo, &["for-each-ref", "--format=%(refname)", "refs/tags"]) as f64),
        ),
        (
            "dirtyEntries".into(),
            json_num(count(repo, &["status", "--porcelain=v1", "--untracked-files=all"]) as f64),
        ),
    ])
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

fn arg(args: &[String], name: &str) -> Option<String> {
    let at = args.iter().position(|a| a == name)?;
    args.get(at + 1).cloned()
}

fn usage() -> ! {
    eprintln!(
        "usage: repo_bench --repo <path> --name <fixture> \
         [--iterations N] [--warmup N] [--budget-seconds S] [--no-baseline] \
         [--soak-minutes M] [--out <file>]"
    );
    std::process::exit(2)
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let Some(repo) = arg(&args, "--repo") else { usage() };
    let name = arg(&args, "--name").unwrap_or_else(|| "repo".into());
    let mut cfg = Config {
        floor_ms: 0.0,
        iterations: arg(&args, "--iterations")
            .and_then(|v| v.parse().ok())
            .unwrap_or(10),
        warmup: arg(&args, "--warmup").and_then(|v| v.parse().ok()).unwrap_or(2),
        baseline: !args.iter().any(|a| a == "--no-baseline"),
        budget_ms: arg(&args, "--budget-seconds")
            .and_then(|v| v.parse::<f64>().ok())
            .unwrap_or(20.0)
            * 1000.0,
    };

    let path = PathBuf::from(&repo);
    if !path.join(".git").exists() {
        eprintln!("not a git repository: {repo}");
        std::process::exit(1);
    }

    eprintln!("benchmarking {name} at {repo}");
    cfg.floor_ms = spawn_floor_ms(&path);
    eprintln!("  one `git` invocation costs {:.1} ms before doing anything", cfg.floor_ms);
    let subject = probe(&path);
    let measured = run_suite(&subject, &cfg);

    let soaked = arg(&args, "--soak-minutes")
        .and_then(|v| v.parse::<f64>().ok())
        .map(|m| {
            eprintln!("  soaking for {m} minute(s)…");
            soak(&subject, m)
        });

    let doc = JsonValue::Ordered(vec![
        ("fixture".into(), json_str(&name)),
        ("repository".into(), repo_json(&name, &subject)),
        ("machine".into(), machine_json()),
        ("iterations".into(), json_num(cfg.iterations as f64)),
        ("warmup".into(), json_num(cfg.warmup as f64)),
        ("budgetSeconds".into(), json_num(cfg.budget_ms / 1000.0)),
        ("gitSpawnFloorMs".into(), json_num(cfg.floor_ms)),
        (
            "operations".into(),
            JsonValue::Array(
                measured
                    .iter()
                    .map(measured_json)
                    .collect(),
            ),
        ),
        ("soak".into(), soaked.unwrap_or_else(json_null)),
    ]);

    let rendered = json_render(&doc);
    match arg(&args, "--out") {
        Some(out) => {
            std::fs::write(&out, format!("{rendered}\n")).expect("write results");
            eprintln!("  wrote {out}");
        }
        None => println!("{rendered}"),
    }
}
