# Competitor pain points and our gaps — August 2026

Research note. Where the other git GUIs hurt their users, what of that we can
solve, and where we are behind the table stakes.

**Method.** Primary sources only: the public issue trackers of GitHub Desktop,
Fork, Sublime Merge and Git Extensions, ranked by reaction count (a reaction is
a user who bothered to vote, which is a far better demand signal than a review
site), plus Hacker News comment search. Review aggregators (G2, Capterra,
Product Hunt) were read and discarded — they are marketing surface, not
complaints. Every "we don't have this" claim below was checked against the tree
on `main` at `42f1e82`, and every "already tracked" claim against our own open
issues.

Reaction counts are quoted as of 2026-08-26.

---

## TL;DR

1. **We silently skip `pre-commit`, `prepare-commit-msg`, `commit-msg` and
   `post-commit` hooks.** Commits go through libgit2, which does not run hooks;
   push shells out to real git, which does. Any team on husky / lefthook /
   pre-commit / commitlint gets their checks bypassed by our app without being
   told. This is the most serious finding here and it is a trust problem, not a
   feature gap.
2. **Linux is the single largest unserved demand in the entire category**, and
   we already ship it. GitHub Desktop's most-reacted issue of all time is
   "GitHub Desktop for Linux?" (4,842 reactions); Fork's is "Linux version?"
   (543). Sourcetree has no Linux build. Our open #187 (one-line install +
   package-manager updates) is therefore the highest-leverage issue on the board.
3. **"No account, no telemetry, no cloud, not Electron" is a real, currently
   unoccupied position.** The loudest 2026 complaint about the market leader is
   that it is going the other way.
4. Table stakes we genuinely lack, in rough priority order: hooks + a
   `--no-verify` escape hatch, per-repo identity / multi-account, cancelling a
   running clone or fetch, external diff tool, follow-system theme, update
   opt-out, favourites/pinning in the repo and branch lists.

---

## 1. What the other tools are actually blamed for

### GitKraken

Sentiment on HN is a clean split: people who love it, and people watching it
decay. The decay complaints are specific and recent:

- *"Been using gitkraken for ages and still like it, but they do make it harder
  and harder to like every update. The enshittification seems to have started
  and every update seems to bring more and more ai features, and pushing more
  'cloud' features as well."*
- *"Compare that to GitKraken where you need to create an IT owner account
  inside their system, and then distribute the annual licenses manually."*
- *"I found it too much cluttering."*
- *"I just don't feel in control of what I'm trying to achieve with Git."*
- Electron: listed among the apps broken on macOS 26 Tahoe. Slower than native
  clients on repos past ~50k commits.
- On WSL: *"the WSL-g does not really work well. It's blurry for Hi-Res screen
  and the performance is like hell."* — the commenter dropped their
  subscription over it.

### Sourcetree

- *"For me, Source Tree is very unusable and doesn't make any sense."*
- *"Source Tree is good but it happens to have noticeable slowdown and 'jank' on
  both OS X and Windows after a while."*
- Windows and macOS only.
- Praised for exactly one thing, repeatedly: **line-level staging and diffs.**
  *"Good visual layout of your diffs at any given point with the ability to
  stage/discard/unstage specific lines."* We have this; it is the thing users
  leave the CLI for.

### GitHub Desktop

Deliberately shallow. Its top issues are its missing half:

| Reactions | Issue |
|---|---|
| 4,842 | [#1525 GitHub Desktop for Linux?](https://github.com/desktop/desktop/issues/1525) |
| 1,365 | [#3707 Options > Git > manage multiple accounts](https://github.com/desktop/desktop/issues/3707) |
| 340 | [#78 Setup gpg signing](https://github.com/desktop/desktop/issues/78) |
| 294 | [#9452 History graph in comparison view](https://github.com/desktop/desktop/issues/9452) |
| 223 | [#3606 Support multiple windows](https://github.com/desktop/desktop/issues/3606) |
| 199 | [#11531 Stash specific files](https://github.com/desktop/desktop/issues/11531) |
| 131 | [#12699 Support multiple stashes](https://github.com/desktop/desktop/issues/12699) |
| 105 | [#3410 Opt-out of auto-updating](https://github.com/desktop/desktop/issues/3410) |
| 96 | [#7022 Commit searchability and navigation](https://github.com/desktop/desktop/issues/7022) |
| 55 | [#12195 Default editor per repository](https://github.com/desktop/desktop/issues/12195) |
| 32 | [#11052 Turn off text wrap in side-by-side diff](https://github.com/desktop/desktop/issues/11052) |
| 29 | [#15767 Pin branches in the branch list](https://github.com/desktop/desktop/issues/15767) |
| 28 | [#11608 Reorder the repository list](https://github.com/desktop/desktop/issues/11608) |
| 27 | [#9609 Allow Beyond Compare for merge conflicts](https://github.com/desktop/desktop/issues/9609) |
| 26 | [#19207 Revert changes for a single file](https://github.com/desktop/desktop/issues/19207) |
| 24 | [#2082 Cancel a clone in progress](https://github.com/desktop/desktop/issues/2082) |
| 23 | [#2981 Image previews for LFS-tracked images](https://github.com/desktop/desktop/issues/2981) |

Of these we already ship: signing, graph, multiple stashes, path-scoped stash,
commit search, single-file revert, and the whole Linux answer. That is the
shape of the opportunity.

### Fork

The tracker of a well-liked, mature client — so its top issues are the honest
long tail of what a *good* GUI still misses:

| Reactions | Issue |
|---|---|
| 543 | Linux version? |
| 82 | Support multiple working trees |
| 37 | Vertical layout / orientation |
| 33 | Show uncommitted changes in commit history |
| 24 | **Allow skipping pre-push hooks** |
| 23 | **Incorrect `$PATH` in the pre-commit exec environment** |
| 21 | Support for `Co-Authored-By` |
| 20 | UI to add semantic (conventional) commits |
| 19 | Rebase dependent branches (`--update-refs`, git 2.38) |
| 19 | Customise branch colours |
| 18 | Configurable keyboard shortcuts |
| 15 | Commit signing with SSH keys |

The two bolded rows are the shape of the hook problem from the *other* side:
once you run hooks, users need a way to skip them, and a GUI launched from
Finder/Explorer does not inherit the shell `$PATH`, so hooks that call `node`
or `python` fail in ways that look like the app is broken.

### Sublime Merge

| Reactions | Issue |
|---|---|
| 106 | Diff/merge on non-git files |
| 79 | Diff between branches |
| 73 + 55 | Worktree support (two separate issues) |
| 46 | Modified files in tree view |
| 46 | Searching in the blame window |
| 36 | GitHub pull request support |
| 34 | Stash individual files |
| 34 | Drag & drop cherry-pick / reorder / squash |
| 33 | Branch graph in topological order |
| 32 | **External diff/merge tool** |
| 27 | **`blame.ignoreRevsFile`** |
| 21 | First-class reflog view |
| 17 | Annotated tag support |
| 16 | **`git notes`** |
| 16 | Image diffs |

We already have: branch compare, worktrees, PR integration, path-scoped stash,
drag-and-drop rebase, reflog, annotated + signed tags, tree staging. The bolded
rows are ours to close.

### Git Extensions

Mostly Windows-legacy concerns, but three transferable ones: **system colour
theme** (#8342), **import/export of settings** (#3563), **`--no-verify` option
on push** (#10823), plus markdown rendering in commit messages (#6509) and
auto-inserting a ticket number into the commit message (#6468).

### The 2026-specific one

A theme that did not exist two years ago, from HN:

- *"I purchased GitKraken, because they have a decent automated 'AI' merge
  conflict resolution tool. My use case is resolving conflicts from multiple
  parallel coding agent sessions."*
- *"VS Code Copilot workflows use git worktrees for AI-generated code changes,
  allowing step-by-step review of modifications before integration."*
- *"if you can review things in GitKraken or another program with diffs, things
  are closer to what you want"* — on catching LLM slop before it lands.

People are now running several agents in parallel worktrees and need to review
and reconcile the results. We already have worktrees, a strong conflict
resolver in its own window, multi-repo tabs and a fast diff. Nobody is aiming
those at this workflow yet, and it requires no account and no cloud.

---

## 2. Verified gaps in our tree

Each checked against the code, and against our open issues (#187, #211, #212,
#214, #215, #224, #225, #226) for duplicates.

### A. Hooks are silently skipped — the one to fix first

`Libgit2Backend::commit` (`src-tauri/src/git/libgit2.rs:3752`) builds the commit
with `repo.commit(...)`, or `commit_signed` when signing. libgit2 runs **no
hooks, ever**. `grep -ri hook src-tauri/src/**/*.rs` returns nothing outside
unrelated comments. So:

- `pre-commit`, `prepare-commit-msg`, `commit-msg` and `post-commit` never run.
- `pre-push` **does** run, because push shells out to real git through
  `commands::net::run_git_authenticated`.

A repo with husky or lefthook installed is therefore protected when you push
from us and unprotected when you commit from us, with nothing in the UI saying
so. Formatting, lint and commitlint gates are bypassed. This is the exact
failure that makes teams ban a GUI client.

Fixing it means three things, and the third is not optional:

1. Run the commit-side hooks. Either shell out to `git commit` on the hook path,
   or invoke the hook scripts around the libgit2 commit. The signing chain rule
   (one chain, a failure creates nothing) has to hold: a non-zero `pre-commit`
   must create nothing either.
2. A visible, per-commit **"skip hooks" (`--no-verify`)** toggle, and the same
   on push — we have no `--no-verify` anywhere today. Fork's users ask for this
   loudly precisely *because* Fork runs hooks.
3. Get `$PATH` right. Launched from Finder/Explorer we inherit a minimal
   environment, so a hook calling `node`/`python`/`pnpm` fails with a confusing
   error. Fork has an open, well-upvoted bug about exactly this. Our `pgit` CLI
   launch path inherits the shell environment; a Dock launch does not — so this
   will reproduce differently depending on how the app was started.

Not a duplicate of #225 (custom actions): that is user-invoked commands, this is
git's own contract.

### B. Table stakes we lack

| Gap | Evidence | State in our tree |
|---|---|---|
| Per-repo identity / multiple accounts | GH Desktop #3707 (1,365) | Only `default_signature` reading git config (`git/signature.rs`). No UI to set or switch identity, no "committing as X" affordance. We support an author override per commit, which is not the same thing. |
| Cancel a running clone / fetch / push | GH Desktop #2082; unchecked in our own #212 | `create.rs:253` has a comment admitting it: *"a clone has no cancel button, so a hang here is force-quit"*. Should be its own issue per #212's own rule. |
| External diff tool | Sublime Merge (32), GH Desktop #9609 (27) | We have `run_mergetool` for conflicts only. No way to open an arbitrary diff in Beyond Compare / Kaleidoscope / `difftool`. |
| Multiple windows | GH Desktop #3606 (223), Fork (16) | Tabs only. The merge resolver already runs in its own window, so the plumbing exists. |
| Follow-system theme | Git Extensions #8342 | 9 built-in themes + custom, each hard-coded `mode: "dark" \| "light"`. No "system" option, no `prefers-color-scheme` listener. |
| Update opt-out | GH Desktop #3410 (105) | `useUpdateStore` has per-version `dismissedVersion` only. No setting for "don't check", no channel choice; nothing update-related in `PersistedState`. |
| Favourites / pinning / reordering | GH Desktop #15767, #11608, #19828 | #135 pins the *default* branch and orders by recency, which is not user-controlled pinning. Repo tab order is open-order. |
| Stacked branches (`rebase --update-refs`) | Fork (19) | Not implemented. This is the modern stacked-PR workflow and GitButler's entire pitch. |
| Commit message templates / conventional commits / ticket prefix | Fork (20), Git Extensions #6468 | Nothing; no `commit.template` support either. We do have recent-message recall and sign-off. |
| `git notes` | Sublime Merge (16) | Not implemented. |
| `blame.ignoreRevsFile` | Sublime Merge (27) | Not honoured by the Blame screen. |
| Markdown rendering of commit bodies | Git Extensions #6509 | Plain text. |
| Settings import/export | Git Extensions #3563 | Themes export/import only; the rest of `PersistedState` is localStorage-only. |
| Shallow / partial clone | Git Extensions #10971 | No `--depth`, no `--filter` in `create.rs`. |

### C. Already tracked — do not refile

- Image / binary diff previews → **#224**
- Reveal in Finder / open in terminal → **#215**
- Linux one-line install + package managers → **#187**
- No-telemetry guarantee → **#226**
- Branch name validation → **#214**
- User-defined commands → **#225**
- Clone/commit/push/diff unhappy paths → **#212** (the missing clone-cancel
  button is listed there but wants its own issue)

---

## 3. Where we are already ahead, and should press

- **Linux, as a first-class target.** The biggest single pool of frustrated
  users in the category, and both leaders have refused it for a decade. This is
  not a feature, it is the wedge. #187 is the follow-through.
- **No account, no telemetry, no cloud, native.** The market leader is moving
  the other way and being criticised for it by name. #226 makes the promise
  testable; it should also be a stated product position, not just a guard test.
- **Native performance.** "Slow on big repos", "jank after a while", "Electron
  app broken on Tahoe" are the recurring structural complaints. We are Rust +
  a system webview, so we should be able to win this — but we should *measure*
  it on a 50k+ commit repo and publish the number rather than assert it.
- **WSL.** GitKraken through WSLg is described as unusable; GitHub Desktop has a
  cluster of WSL issues. We already fixed the dubious-ownership case (#83). A
  deliberate WSL story is a cheap Windows win.
- **The parallel-agent workflow.** Worktrees + a good conflict resolver + fast
  diff review, aimed explicitly at reviewing and reconciling what several
  coding agents did. Unoccupied, and it is adjacent to what we already built.

---

## Sources

- [GitHub Desktop issue tracker](https://github.com/desktop/desktop/issues) —
  queried by reaction count
- [Fork issue tracker](https://github.com/fork-dev/Tracker/issues)
- [Sublime Merge issue tracker](https://github.com/sublimehq/sublime_merge/issues)
- [Git Extensions issue tracker](https://github.com/gitextensions/gitextensions/issues)
- Hacker News comment search via the [Algolia API](https://hn.algolia.com/api)
  for `GitKraken`, `Sourcetree`, `git client`
- [GitKraken review roundup, The Software Scout](https://thesoftwarescout.com/gitkraken-review-2026-the-best-git-gui-client-for-most-developers/)
  (secondary; used only for the large-repo performance claim)
