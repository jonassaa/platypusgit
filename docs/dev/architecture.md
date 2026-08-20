# Architecture — annotated source trees

Part of the `docs/dev/` set (`architecture`, `testing`, `frontend`, `backend`,
`distribution`) — deep-dive notes split out of CLAUDE.md, which keeps only the
operational rules and points here. A section referenced but not found in this
file lives in a sibling. `test/docs.test.ts` reads this set together with
CLAUDE.md, so the tree listings and command lists here are build-checked.

## Backend (`src-tauri/src/`)

```
error.rs         AppError enum (thiserror + serde-tagged) — ONLY error type crossing IPC
state.rs         AppState { backend: Arc<dyn GitBackend> }
opener.rs        Handing URLs/paths to the OS default handler. SECURITY-critical:
                 safe_url (parse + https-only + reject quotes/control chars),
                 safe_workdir_path (no absolute/`..` escape), and a spawn that
                 NEVER goes through a shell — no `cmd /C start`, and the child's
                 exit status is checked. Both open_url and open_in_editor use it.
update.rs        Update discovery — semver compare (semver crate, cmp_precedence),
                 dev-build (0.0.0) short-circuit BEFORE any network call,
                 GitHub release parsing, ureq agent w/ timeout + https_only.
                 The LOGIC; its Tauri handlers are commands/update.rs. Two
                 different files with the same basename — see the note there
proc.rs          THE ONLY sanctioned way to spawn a child process (issue 172):
                 `git` / `git_async` / `git_async_in` (+ CREATE_NO_WINDOW,
                 GIT_TERMINAL_PROMPT=0, stdin closed), `program` /
                 `program_async` (flag only), and the two
                 `*_keeping_console` exceptions. See "Spawning processes" in backend.md
forge/           Forge (GitHub / GitLab) integration — PR/MR list, create, checkout,
                 CI status (#92). The trait is split into URL BUILDERS + RESPONSE
                 PARSERS, not `list_pull_requests()`, so every forge-specific line
                 is pure and testable against recorded JSON with no network:
├── mod.rs       ForgeKind/ForgeRepo/ForgeDetection/PullRequest/ChecksSummary/
│                NewPullRequest + the `Forge` trait, `forge_for(kind)`, and the
│                injection guards every URL and git argv goes through:
│                validate_host, encode_segment, validate_sha, validate_ref_name
├── remote.rs    parse_remote_url + detect. PURE. Handles scp-like SSH, ssh://,
│                http(s)://, git://, GitLab subgroups, self-hosted hosts. NOTE the
│                port asymmetry: an SSH port is DROPPED (it is not where the API
│                listens), an HTTPS port is KEPT (for self-hosted it is). A repo
│                with no parseable remote yields None — a STATE, not an error
├── token.rs     `Secret` (no Display, no Serialize, Debug prints `Secret(***)`),
│                `redact`, and storage delegated to the user's git credential
│                helper under `<host>.platypusgit-forge.invalid` (RFC 6761) —
│                see the forge-token note in backend.md
├── http.rs      The ONLY impure file: one ureq agent, https_only + timeout +
│                4MB body cap; 401/403 → ForgeAuth, other non-2xx → Forge with the
│                API's own message, everything scrub_credentials'd
├── github.rs    REST v3. api.github.com for github.com, /api/v3 for Enterprise
├── gitlab.rs    REST v4. Project id is the URL-encoded FULL PATH; MR create has
│                NO draft param — draft is a `Draft: ` title prefix
└── checkout.rs  The git half of "check out this PR": fetch_args / checkout_args /
                 branch_exists, split out so tests/forge_checkout.rs can drive
                 them against a real repo whose bare origin carries
                 refs/pull/1/head at a commit on no branch (the fork case).
                 The fetch writes NO ref (lands in FETCH_HEAD) — fetching into
                 refs/heads/<local> is refused for a checked-out branch and would
                 force-update someone's commits away. And do NOT pass `--` to
                 `git rev-parse`: after it everything is a PATH, so every branch
                 reads as absent (regression-tested)
main.rs          Binary entry — calls `platypusgit_lib::run()`, nothing else.
                 Keeps the `windows_subsystem = "windows"` attribute; leave it
lib.rs           Tauri builder + invoke_handler! registry (all commands listed there)
cli.rs           CLI arg parsing (LaunchIntent, parse_args, resolve_repo_root)
                 and the whole `pgit` shim story (#144): the PURE core
                 (shim_dirs_for / package_shim_paths_for / path_dirs /
                 shim_scan_order / references_app / classify_sighting /
                 plan_install) plus the impure shim_status / install_shim over
                 it. `ShimOs` is an explicit parameter, not a `cfg!` at the
                 point of use, so all three platform tables are testable from
                 any host — two of the three cannot be exercised otherwise.
                 Not to be confused with git/cli.rs (CliBackend) below
detach.rs        Handing the terminal back on a `pgit …` launch (#163):
                 `should_detach` (PURE — the whole gate, and the reason the
                 askpass path still authenticates) + `spawn_detached`, the
                 re-exec that carries argv and cwd into a child with no stdio
                 and its own session. See "The `pgit` launch detaches" in distribution.md
windows/         add-user-path.ps1 — the per-user PATH append, `include_str!`'d
                 as `WINDOWS_PATH_SCRIPT` and fed to powershell on stdin
deb/             pgit (the /usr/bin wrapper, committed 100755) + postinst
wix/             pgit-cli.wxs (the MSI component) + pgit.cmd
git/
├── mod.rs       GitBackend trait — every git op, returns AppResult<T>
├── types.rs     RepoHandle, FileStatus, CommitInfo, BranchInfo, TagInfo, StashInfo,
│                RemoteInfo, FileDiff, BlameLine, ReflogEntry, RebaseStep, RepoState,
│                ConflictSides, CommitOptions, StashSaveOptions, TagTarget, ResetMode,
│                SubmoduleInfo/SubmoduleState, WorktreeInfo/WorktreeBranch,
│                LfsStatus/LfsFile/LfsPointer/LfsDiff, BisectStatus/BisectMark, etc.
├── libgit2.rs   Libgit2Backend — active impl, most ops real. NOTE: merge_branch
│                and rebase_onto shell out to real git, so a conflicted rebase is
│                git's on-disk state, not ours — continue/abort_operation detect
│                that (cli_rebase_in_progress) and hand off to `git rebase
│                --continue/--abort`. The libgit2 path would drop queued steps.
├── cli.rs       CliBackend — stub for ops libgit2 handles poorly (LFS, creds, complex merges).
│                Still 100% NotImplemented: the #93 shell-outs live in libgit2.rs
│                because they need the same opened `Repository` their neighbours do
├── submodule.rs SubmoduleStatus → the four `SubmoduleState`s (priority order:
│                uninitialized > pointer moved > dirty inside), the per-listing
│                declared-path set (free when there is no `.gitmodules`), and
│                `git submodule update`'s arg builder. libgit2 for list/init/sync;
│                update shells out because it FETCHES and credentials only flow
│                through the askpass subprocess env (#93)
├── worktree.rs  Linked worktrees: libgit2 for list/add/lock/unlock/prune (its
│                prune defaults ARE `git worktree prune`'s). `remove` shells out —
│                libgit2's only option is prune-with-WORKING_TREE, which deletes
│                the directory with NO dirty check; `git worktree remove` refuses
│                on uncommitted work, mapped to `DirtyWorktree` (#93)
├── lfs.rs       git-LFS. Pointer parsing + `lfs_diff_of` are PURE, derived from a
│                diff we already produced (a pointer is ≤3 lines, so it is all in
│                the diff's own lines — no extra I/O). "Does this repo use LFS" is
│                answered from `.gitattributes` via the INDEX, NOT `git lfs track`:
│                it must be answerable with the binary MISSING (#93)
├── stash.rs     Stash helpers that need no repository (#133): the `git stash
│                push` / `git stash store` argv builders (the `--` placement and
│                GIT_LITERAL_PATHSPECS live here), `validate_message`, and
│                `rename_store_landed` — the pure gate the rename's DROP is
│                conditioned on. All unit-tested with no temp repo
├── bisect.rs    Bisect. Reads GIT's own `.git/BISECT_*` + `refs/bisect/*` — there
│                is deliberately NO parallel state file (see the bisect note in backend.md), and
│                progress comes from `git rev-list --bisect-vars`, git's own
│                arithmetic, so it is recomputable after a restart (#93)
├── ownership.rs libgit2's dubious-ownership refusal (GIT_EOWNER, git's
│                CVE-2022-24765 check — the WSL `/mnt/c` case): error mapping,
│                RepoPresence probe (Present/Absent/Refused — NEVER infer
│                "no repo" from a failed open), non-opening repo_root_for
│                walk, and the global `safe.directory` writer
├── rebase_plan.rs  Plan validation, run BEFORE `rebase_start` touches the repo:
│                merge-legal actions, duplicate/unknown oids, all-drop plans.
│                A rejected plan must leave HEAD, the branch ref, and the
│                worktree untouched — that is the whole point of the module
├── rebase_state.rs  On-disk mirror of an in-progress rebase
│                (`.git/platypusgit-rebase.json` + `ORIG_HEAD`) so Continue and
│                Abort survive an app restart, PLUS the last completed rebase's
│                summary in a SECOND file (`platypusgit-rebase-last.json`) —
│                separate because everything that asks "is a rebase in
│                progress?" answers by the first file's existence. Deliberately
│                NOT git's own `.git/rebase-merge/` dir — a half-compatible one
│                would let `git status` / `git rebase --continue` claim a rebase
│                they cannot drive
├── auth.rs      Auth-failure classification + credential hygiene (#61 D5).
│                PURE: `classify_auth_failure` (git's stderr → `AuthKind`, or
│                `None` for "not an auth failure" — host-key verification is
│                deliberately in that second bucket), `AuthChallenge`, and
│                `scrub_credentials`. See "Network ops and credentials" in backend.md
├── signing.rs   CRYPTOGRAPHIC signing — GPG/SSH (#61 D6, #132). NOT
│                signature.rs (below); read the pair note after this tree.
│                PURE: gpg.format → program →
│                user.signingkey resolution, `resolve_key_file` (the ssh
│                key-PATH restriction — `key::…` literals refused), the signer
│                argv, and `parse_verify_output` for git's `%G?` triple.
│                Format-agnostic about WHAT is signed — a commit buffer and a
│                tag body are both just payloads, which is why the tag path
│                reuses it whole instead of growing a second chain
├── tag.rs       Tag signing's pure half (#132): armor-header detection,
│                `append_signature`, `validate_tag_name` (the argv guard), and
│                `parse_verify_tag` for `git verify-tag --raw` — see the
│                tag-signing note in backend.md for why `%G?` can't be used
└── signature.rs IDENTITY, not cryptography. `default_signature` (the
                 `user.name` / `user.email` lookup, local → global → system,
                 `NoSignature` when unset) and `apply_signoff` (the
                 `Signed-off-by:` TRAILER, `git commit -s` semantics, idempotent
                 + its trailer-line rule). Nothing here signs anything
commands/        Thin Tauri handlers, one file per area:
├── repo.rs        open_repo, close_repo, trust_repo_path, get_status,
│                  list_all_files, append_gitignore, open_in_editor, and THREE
│                  file readers that are not interchangeable:
│                  read_file_content (the working tree, on disk),
│                  read_file_content_at_rev + list_files_at_rev (a commit's
│                  tree — what the repo browser reads at a revision) and
│                  read_file_content_at_index (the STAGED blob, which is
│                  neither of the other two whenever a file is staged and then
│                  edited again)
├── cli.rs         take_launch_intent, cli_shim_status, install_cli_shim
├── commits.rs     get_log, commit, file_history, verify_commit (one commit's
│                  signature status, called lazily for the SELECTED commit —
│                  never per log row). The `refspec` arg takes the
│                  `REFSPEC_ALL` sentinel ("--all", git's own spelling) meaning
│                  "walk every branch we know of" — local + remote-tracking heads
│                  plus a detached HEAD, one graph. History's default scope; the
│                  frontend mirrors it as `LOG_REF_ALL` in lib/types.ts.
│                  CONSEQUENCE: the loaded log is NOT HEAD's ancestry, so any
│                  rebase op must run it through `headAncestryOf` first (see
│                  features/commits/headAncestry.ts) — a plan built from the raw
│                  log replays another branch's commits onto the current one.
│                  THE LOG IS PAGED — see "The log is paged" in frontend.md. `get_log`
│                  is the one-shot walk; `get_log_page` /
│                  `get_log_filtered_page` are what History actually calls, and
│                  `get_log_filtered` is the unpaged filtered walk.
│                  Also `commits_since` (`base..HEAD`, base must be an ANCESTOR),
│                  `commits_between` (`base..tip`, NO ancestry requirement —
│                  `commits_since` refuses a non-ancestor base, which is right for
│                  a rebase base and wrong for two diverged branches) and
│                  `ahead_behind` (counts read FROM `a` TOWARD `b`, plus the merge
│                  base; unrelated histories are `mergeBase: null`, not an error).
├── diff.rs        get_diff, stage/unstage/discard_paths,
│                  stage/unstage/discard_hunk, stage/unstage/discard_lines,
│                  diff_ref_to_workdir, blame_file, and the two commit diffs
│                  ONE CHARACTER apart: `diff_commit` (one oid — that commit
│                  against its first parent, "what this commit changed") and
│                  `diff_commits` (from_oid + to_oid — an arbitrary rev↔rev
│                  range). Reaching for the wrong one compiles and returns a
│                  plausible diff, so check the arity
├── branches.rs    list_branches/tags/stashes/remotes, checkout/create/delete/rename_branch,
│                  set_upstream, fetch, fetch_all, pull, push,
│                  add/remove/rename/prune_remote, set_remote_url,
│                  create/delete/push_tag, verify_tag, merge_branch, rebase_onto,
│                  checkout_ref, push_delete_branch
├── net.rs         NOT a command area — the shared network plumbing every
│                  credentialed git shell-out goes through (`Credentials`,
│                  `run_git_authenticated`, `apply_auth_env`, `map_git_failure`,
│                  `credential_approve`) plus ONE registered command,
│                  `remember_credential`: separate from the ops on purpose, so a
│                  credential is stored only after it has actually worked rather
│                  than on submit, which would persist a typo. See "Network ops
│                  and credentials" in backend.md
├── update.rs      check_for_update, get_update_capability, open_url — the
│                  handlers for the top-level `update.rs` logic. Two files named
│                  `update.rs`: THIS one is thin Tauri commands,
│                  `src-tauri/src/update.rs` is the semver + release-parsing
│                  engine they call
├── history.rs     reset, cherry_pick, revert
├── stash.rs       stash_save/apply/pop/drop/branch, plus stash_save_paths
│                  (pathspec-scoped), stash_rename and stash_diff (#133)
├── conflict.rs    repo_state, conflict_sides, accept_ours/theirs, mark_resolved,
│                  save_resolution, abort/continue_operation, run_mergetool,
│                  restart_conflict
├── rebase.rs      rebase_start/continue/abort/status/acknowledge (interactive)
├── forge.rs       forge_detect, forge_sign_in/sign_out/token_status/validate_token,
│                  forge_list_pull_requests, forge_pull_request_checks,
│                  forge_create_pull_request, forge_checkout_pull_request.
│                  Owns `ForgeTokens` (managed per-process token cache) and
│                  `blocking_forge`, which redacts the token out of any error
├── reflog.rs      get_reflog, checkout_detached
├── submodule.rs   list_submodules, submodule_init/sync/update (the last takes
│                  `credentials` and retries through net::run_git_authenticated)
├── worktree.rs    list_worktrees, worktree_add/remove/lock/unlock/prune
├── lfs.rs         lfs_status, lfs_checkout (local), lfs_fetch/lfs_pull (network,
│                  credentialed like fetch/pull/push)
├── bisect.rs      bisect_status/start/mark/reset
└── create.rs      init_repo, default_init_branch, clone_repo (streaming
                   git clone → clone://progress events)
```

**Three pairs of near-identical filenames live in this tree, and the two halves
of each pair do different jobs.** Check which one you want before editing:

- `git/signing.rs` vs `git/signature.rs` — **cryptography vs identity.**
  `signing.rs` resolves a GPG/SSH signer and produces or verifies a real
  signature; `signature.rs` reads `user.name`/`user.email` and appends a
  `Signed-off-by:` trailer. A sign-off is plain text anyone can type — it proves
  nothing and involves no key. "Add signing" almost always means `signing.rs`.
- `src-tauri/src/update.rs` vs `src-tauri/src/commands/update.rs` — engine vs
  handlers. Both exist; neither is dead.
- `src-tauri/src/cli.rs` vs `src-tauri/src/git/cli.rs` — the `pgit` launch
  argument parser vs the `CliBackend` git implementation. (Already flagged at
  `cli.rs` above.)

## Frontend (`src/`)

```
main.tsx             Entry point
App.tsx              Thin wrapper around <AppShell />
AppShell.tsx         Primary shell: titlebar (branch chip + picker, remote buttons),
                     repository tab strip, activity bar (screen switcher), status
                     bar, error banner, settings. Also owns the per-tab screen
                     (restore on switch) and keys the screen subtree by the
                     active repository so a switch REMOUNTS it
store.ts             Re-export hub (keep thin — no global Zustand composition)

design/              In-house design system (NOT components/ui/). Exports via design/index.ts.
├── primitives.tsx       PGButton, PGIconButton, PGSelect (an in-page listbox,
│                        NOT a native <select> — see "No native <select>" in frontend.md), etc.
├── selectPos.ts         PGSelect's popover placement as PURE arithmetic
│                        (`selectPopoverPos`) — below the trigger, else above,
│                        then clamped into the viewport on both axes AND both
│                        ends. Separate for the reason paneSize.ts is: jsdom
│                        measures everything as 0
├── chrome.tsx           PGTitlebar, PGTabStrip (repository tabs), PGActivityBar,
│                        PGStatusBar, PGStatusItem
├── window-controls.tsx  Minimize / maximize / close (the titlebar is ours)
├── git-components.tsx   Git-specific UI bits — PGCommitRow, PGGraphRow,
│                        PGChangeRow, PGFileTree(Row), PGRebaseRow, PGDiffRow,
│                        PGHunkActions + PGFoldSeparator (what replaced the `@@`
│                        banner, #157)…
├── PGWindowedDiff.tsx   The ONE diff renderer over `DiffRow[]` (see "Diff
│                        rendering" in frontend.md). Reuses PGDiffRow / PGFoldSeparator /
│                        PGHunkActions, so the windowed and unwindowed paths
│                        cannot drift
├── graph-geometry.ts    Lane geometry for the History graph in SVG user units —
│                        the one place the lane pitch and gutter width live, so
│                        PGGraphRow's path math and PGCommitRow's grid agree
├── icons.tsx            Icon set (name-based <PGIcon>), incl. file-type glyphs
├── logo.tsx             App mark
├── context-menu.tsx     Context menu primitive
├── dialog.tsx           PGDialogHost + pgConfirm/pgPrompt — the ONLY confirm /
│                        prompt path (no window.confirm/prompt anywhere)
├── empty-state.tsx      Empty-state component
├── skeleton.tsx         Loading placeholders
├── error-boundary.tsx   Per-window last line of defence — React unmounts the
│                        whole root when a render throws, so without it one
│                        broken screen leaves a blank window and no message
├── modal.tsx            PGModal — shared dialog shell
├── resizable.tsx        Resizable panes — PGResizeHandle + usePaneSize (the
│                        container-relative clamp; see "Resizable panes" in frontend.md)
├── paneSize.ts          That clamp as PURE arithmetic: paneMaxSize /
│                        clampPaneSize, PANE_HANDLE_PX, DEFAULT_SIBLING_MIN
├── ui-helpers.tsx       pgFlash (ONE reused toast element — it used to append a
│                        node per call) + PG_FLASH_MS, misc helpers
└── use-prevent-browser-context-menu.ts

screens/             One screen per activity-bar item + modal-ish deep views:
  RepoBrowser, CommitPanel, History, DiffViewer, Branches, Rebase,
  Remote, Pulls, Welcome, Reflog, CommitDiff, Compare, FileHistory, Blame,
  Submodules, Worktrees, Settings
                     There is deliberately NO Conflict screen (#108): conflicts
                     are announced by OperationBar and resolved in the merge
                     window. Nothing restores a screen from localStorage any
                     more, so retiring an id is just deleting it — but each TAB
                     remembers its screen for the session (see the navigation
                     model).

features/            Per-feature: components + Zustand store colocated
├── repo/            useRepoStore (the big one — but only ever ONE repository's
│                    state: the active tab's), repoSlice (RepoSlice /
│                    REPO_SLICE_KEYS / emptySlice — the multi-repo anti-leak
│                    contract), repoActivity (RepoActivity, split out so
│                    repoSlice needn't import the store), tabs.ts (pure tab-list
│                    reducers, `labelTabs`, `pg-open-repos` persistence),
│                    useTabsStore (the open set + activate/close/cycle + lazy
│                    session restore), RepoTabs (the strip's wiring + its context
│                    menu), useRecentsStore, ops (shared keymap/palette/titlebar
│                    runners), OperationBar (the `repoState !== "Clean"` bar under
│                    the titlebar: what operation is open, conflicts left,
│                    Resolve/Finish/Abort), ownership (the `safe.directory`
│                    confirm — outside the store so store tests need no dialog)
├── nav/             useNavStore — cross-screen intents (diff-file, commit-vs-wt,
│                    file-history, blame, rebase-plan, rebase-onto, stash-diff) +
│                    DeepViewHeader (the origin crumb a deep view goes back to)
├── branches/        BranchChip (titlebar), BranchPicker (popover), orderBranches
│                    (PURE, #135: default branch first, then newest `tipTime`
│                    first, then name — a plain `<` compare, not `localeCompare`,
│                    because branches cut from one commit share a tip time and
│                    that tiebreaker must not depend on the runtime's ICU data).
│                    EVERY branch list goes through it — picker, Branches screen,
│                    palette rows, the commit menu's "check out the branch that is
│                    on this commit" group (#179); a second ordering is how the
│                    first three drifted apart before. `isHead` is deliberately
│                    NOT a sort key: the current branch is the one branch the
│                    picker exists to leave
├── commits/         The log's pure logic, all tested: graphLayout + laneColors +
│                    graphAncestry + rowIdentity (the graph — #68 G2/G4/G9),
│                    buildRebasePlan / buildPreservePlan / withPlanBase /
│                    runRebasePlan /
│                    planCommitSelection / squashMessage (the rebase plans), plus
│                    headAncestry (`headAncestryOf`, see commands/commits.rs) and
│                    logFilter (History's search inputs → a backend `LogFilter`)
├── rebase/          RebaseBasePicker + useRebaseMergeMode (persisted
│                    flatten ⇄ preserve for merge commits in a plan)
├── dnd/             ALL drag-and-drop (#91). `useDragSource` / `useDropZone`
│                    (useDnd.ts) over a module-level pointer gesture
│                    (dragController.ts); `resolveDrop.ts` holds the PURE
│                    staging + graph drop tables; `useRowReorder` (the rebase
│                    plan's reorder) lives here too; `StageDropBar` is the
│                    Files screen's drag-only Stage/Unstage targets.
│                    See the "Drag and drop" convention in frontend.md.
├── reflog/          useReflogStore, DirtyTreeDialog, ReflogActionDialog
├── settings/        useSettingsStore (autoFetch, defaultPullMode, etc.),
│                    headMarks (the HEAD row treatment: independent marks ×
│                    one weight, resolved to draw numbers by resolveHeadDecor —
│                    zero means "don't draw", so PGCommitRow never reads the
│                    mark list) + HeadMarksControl (checkbox grid, weight knob,
│                    and a live preview built from the real PGCommitRow)
├── palette/         usePaletteStore (step stack + chips), commands (catalog),
│                    frecency, CommandPalette (⌘P runner: nav + search + actions;
│                    rows show live keymap chords via PaletteItem.actionId)
├── keymap/          Keyboard system (specs/2026-07-02-keyboard-navigation-v2 +
│                    specs/2026-07-06-keymap-power-shortcuts):
│                    actions.ts (catalog + default runners), presets.ts (rider
│                    default + classic), useKeymapStore (dispatcher: pane-scope
│                    enforcement, DoubleShift, input policy, speed-search
│                    fallback), useFocusStore (spatial Alt+Arrow + Tab cycling),
│                    usePaneList (list nav + type-to-jump speed-search),
│                    useHunkNav (F7/⇧F7 diff hunks — and opening a diff AT its
│                    first change + carrying F7 into the next file, issue 188),
│                    useDiffLineFocus (the
│                    diff pane's per-LINE cursor + Space, see frontend.md),
│                    useSpeedSearchStore, PGPane / FocusableScroll / CheatSheet
├── merge/           Merge resolver window — separate Tauri window (label
│                    "merge"), routed via ?window=merge in main.tsx. mergeModel
│                    (diff3 chunking, node-diff3), resultEditor (CM6 result pane
│                    w/ tracked conflict regions), MergeWindow/MergeBody/SidePane
│                    (Rider 3-pane: ours | editable result | theirs), chevron +
│                    F7/⌘1-3/⌘↵ chords, openMergeWindow (opener; path optional —
│                    no path opens on the list), FileList (conflicted-file
│                    sidebar + its own menu — this window's store has no open
│                    repo, so it uses IPC wrappers, never useRepoStore/
│                    conflictMenuItems). Applies via save_resolution, emits
│                    merge://resolved → main refreshes.
├── update/          useUpdateStore (discovery, semver-aware dismiss memory,
│                    self-update install w/ its own `installing` flag),
│                    semver.ts (§11 precedence, hand-rolled + tested),
│                    UpdateChip (titlebar), UpdatePanel (Escape via the
│                    keymap's app.closeOverlay, not a local listener)
├── auth/            Credential challenge/retry (#61 D5): useAuthStore (the one
│                    pending challenge + the retry closure its raiser supplies —
│                    deliberately NOT the secret) + CredentialDialog. The retry
│                    helper is `withAuthRetry`, which LIVES IN useRepoStore.ts
│                    and is exported so another feature store can reuse it
│                    rather than grow a second retry path (useForgeStore.checkout
│                    fetches a PR head ref, #92). It resolves as soon as it
│                    RAISES a challenge, so a caller that needs to distinguish
│                    "prompt is up" from "op failed" cannot use a boolean — see
│                    `CheckoutOutcome`. useCreateStore hand-rolls the same shape
│                    for clone because it must drop `busy` before prompting and
│                    only has a repo id after the clone succeeds.
├── create/          Clone + Init dialogs (PGModal), useCreateStore,
│                    deriveRepoName. Clone shells out to real git with the
│                    same prompt-less env as fetch/pull/push.
├── forge/           PR/MR feature (#92): useForgeStore (detection, list, checks,
│                    create, checkout, sign-in/out; hostKinds+logins persisted
│                    under `pg-forge-hosts`, NEVER a token), forgeLabels (pure:
│                    prNoun/prNumberLabel per forge — `!7` on GitLab, `#7` on
│                    GitHub — and localBranchFor, which numbers a FORK request
│                    instead of reusing its branch name), PullRequestRow,
│                    CreatePullRequestDialog, ForgeSettings (rendered inside the
│                    Settings screen; state lives here because an account list is
│                    not a preference)
├── compare/         Branch compare (#131): compareSides (PURE — CompareSide,
│                    labels, the "workdir cannot be the left side" swap rule; the
│                    nav store imports the TYPE from here, so nav never depends on
│                    a feature store), useCompareStore (sides + results + the
│                    compare mark, its own store so RepoSlice is untouched),
│                    CompareSidePicker
├── diff/            CommitDiffPanel (shared commit-diff view), DiffMinimap (the
│                    canvas gutter, #161 — the only impure half of the minimap:
│                    measuring, painting, and the gesture), useDiffGaps (the
│                    `gaps` + `text` options for `flattenDiffRows` — one hook so
│                    four surfaces cannot drift on which setting they read; plus
│                    useExpandedGaps, the fold separator's expand state, which
│                    took the retired per-hunk `collapsed` set's place; plus
│                    `diffOpenReady`, the one answer to "is the row model final
│                    enough to scroll to the first change?" — issue 188)
│                    + WhitespaceToggle
│                    (ignore-whitespace control; also owns
│                    useHunkActionsDisabledReason — hunk staging is disabled
│                    while whitespace is ignored, see #61 D2)
├── submodules/      useSubmodulesStore (list + init/sync/update, persisted
│                    `recursive` toggle). Update goes through useRepoStore's
│                    exported `withAuthRetry` — one credential flow, not two (#93)
├── worktrees/       useWorktreesStore + WorktreeAddDialog. The store owns the
│                    destructive flows so the screen and the row menu cannot drift:
│                    remove is a `pgConfirm`, and git's `DirtyWorktree` refusal
│                    becomes a SECOND, `requireText` confirm that passes --force
├── signing/         SignatureBadgeView + useLazyVerification (the shared
│                    debounce-then-verify), SignatureBadge (commits, #61 D6) and
│                    TagSignatureBadge (tags, #132). Both verify ONE object, for
│                    the current selection — never per row
├── tags/            useCreateTagStore + CreateTagDialog (#132): name +
│                    annotation + three-state sign, mounted once in AppShell.
│                    Store-driven and promise-shaped because two of its three
│                    call sites (a context-menu item builder and a palette step)
│                    are not React components
├── lfs/             useLfsStore, LfsPanel (a section on the REMOTE screen, not a
│                    screen — `git lfs fetch/pull` are remote-object transfers),
│                    LfsDiffNotice (what all four diff surfaces render instead of
│                    pointer text) (#93)
└── cli/             useCliLaunch — takes the stashed first-launch intent +
                     listens for forwarded `cli-launch` events, opens/focuses a
                     TAB (`useTabsStore.openRepo`, so a forwarded `pgit <path>`
                     no longer evicts the current repo) + nav screen-switch intent

lib/
├── tauri.ts         Typed invoke() wrappers — frontend NEVER calls invoke() directly
├── types.ts         Shared types mirroring Rust types.rs
├── errors.ts        AppError discriminated union 1:1 with Rust enum
├── derive.ts        Selectors: currentBranch, isStaged, isUnstaged, totalAheadBehind, …
├── syntax/          Shiki highlighting, OFF the main thread (see "Diff rendering" in frontend.md)
│   ├── tokenizeCore.ts   Shiki-FREE: SyntaxLine/SyntaxToken, MAX_HIGHLIGHT_*,
│   │                     toLineRelative, packLines/unpackLines, skipHighlight
│   ├── shiki.ts          The ONE Shiki instance — lazy, so app start pays
│   │                     nothing, and shared so grammars register once.
│   │                     engine-javascript, not WASM Oniguruma: no .wasm asset
│   │                     to ship or fetch through the Tauri custom protocol
│   ├── langs.ts          path → Shiki language + the grammar loaders.
│   │                     LANG_LOADERS is an EXPLICIT map of static `import()`s —
│   │                     a template-literal specifier is not statically
│   │                     analysable, so Vite could neither resolve nor split it
│   ├── scopes.ts         One table drives the SENTINEL theme we tokenize with
│   │                     and the colour→CSS-class lookup that reads it back, so
│   │                     token colours live in CSS, not in the tokenizer
│   ├── tokenizeShiki.ts  The one place codeToTokens is called
│   ├── tokenize.worker.ts  Module worker running tokenizeShiki
│   ├── tokenize.ts       Main-thread API: LRU cache + worker client + fallback.
│   │                     `tokenizeFile(path, text)` — null means render plain
│   ├── useSyntax.ts / useDiffSyntax.ts  Hooks; useDiffSyntax also EXPOSES the
│   │                     texts it reads, which whole-file mode fills gaps from
│   └── usePrefetchSyntax.ts  Bounded idle warm-up of a commit's other files
├── diffRows.ts      Flat DiffRow model (line | fill | fold) + exact
│                    variable-height window. `fill` = whole-file gap filler,
│                    `fold` = chunked mode's separator; there is deliberately no
│                    `@@` header row (#157). Also `hunkAnchorRows`, the hunk
│                    index → flat row index map F7 scrolls by
├── diffMinimap.ts   The minimap gutter's PURE core (#161): per-row marks, the one
│                    content-px ⇄ minimap-px scale, the viewport band, the scrub
│                    (and its inverse), and `buildMinimapBands` — which buckets
│                    rows into DEVICE PIXEL rows so a 20 000-line file costs a
│                    bounded number of `fillRect`s and a lone changed line is
│                    guaranteed one visible pixel. No React, no DOM
├── cssColor.ts      `parseCssColor` / `rgbaCss` — hex, rgb() and **oklch()** →
│                    sRGB bytes, in TypeScript. A canvas cannot be handed a CSS
│                    variable, and the values behind ours are `oklch(...)`; see
│                    the minimap convention in frontend.md for why passing one on is a
│                    silent no-op rather than an error
├── wordDiff.ts      Intra-line (word) diff for one rem/add pair (#61 D8)
├── pairChangedLines.ts  WHICH rem pairs with WHICH add — one definition shared
│                    by the unified hunk, the split view and the commit panel
├── lineSpans.ts     The ONE place syntax tokens and word-diff spans reconcile
│                    into a single tiling of the line, so every renderer is a
│                    flat `spans.map()` with no gap or overlap reasoning
├── codeLines.ts     Split file text into DISPLAY lines — `text.split("\n")`
│                    gets empty text and a trailing newline wrong, both visible
├── useViewportH.ts  Scroll-container height WITHOUT depending on ResizeObserver
├── useElementSize.ts  The same rule generalised to BOTH axes, for the pane
│                    clamp: a ref CALLBACK (so a remounted container is
│                    re-measured with no deps list), measured on attach BEFORE
│                    any capability check, then kept fresh by `window`'s resize
│                    event, a ResizeObserver when there is one, and a bounded
│                    rAF poll while it still reads 0
├── useWindowedList.ts  Fixed-pitch windowing for the plain lists
├── useVariableWindow.ts  Scroll → windowVariable state for the diff surfaces;
│                    updates state only when the window RANGE changes, so
│                    scrolling inside the overscan band costs zero re-renders.
│                    Also `scrollTo`, which a PROGRAMMATIC scroll goes through —
│                    see the note in frontend.md on why an assignment is not an event
├── useDiffRowHeight.ts  Resolves `--diff-row-h` to px, with a fallback for
│                    jsdom (which does not evaluate `calc()`); CSS stays the
│                    source of truth — NaN here would collapse every row to zero
├── platform.ts      `getPlatform` / `usePlatform` — the OS, resolved once and
│                    cached (chord labels, platform-conditional chrome)
├── fileIcon.ts      path → file-type glyph + themeable tint (tested)
├── selection.ts     Multi-select click/range/prune model AND
│                    `splitFileSelection` — the one place a multi-selection is
│                    bucketed into staged/unstaged/untracked/embedded paths for
│                    `multiFileMenuItems`. Each surface supplies only its own
│                    key→row lookup (`sidedSelectionSource` for the commit
│                    panel's `side:path` keys, `treeSelectionSource` for the
│                    repo browser's `/a/b` tree keys); folder expansion and
│                    embedded-repo bucketing live in the shared splitter
├── tree.ts          buildStatusTree / buildStatusList — SAME row keys, which is
│                    what makes the tree⇄flat toggle free of per-mode branches
├── useTreeViewMode.ts  Persisted tree|flat preference, one key per surface
└── recents.ts       Recent-repo persistence (`pg-recent-repos`). The OPEN set is
                     a separate key, `pg-open-repos`, in features/repo/tabs.ts —
                     recents are where you have been, the open set where you are

test/                Component-test harness for the jsdom suite. NOT shipped
                     code — nothing under src/ imports it at runtime:
├── setup.ts         Vitest global setup — installs the invoke/dialog/event/
│                    webview mocks (`mockInvoke(cmd, handler)` registers a
│                    per-command response). jsdom-only: it shims `Range` and
│                    runs RTL `cleanup`, so it cannot load in a node-env test
├── invokeMock.ts / dialogMock.ts / eventMock.ts / webviewMock.ts  The mocks
├── dialog.tsx       `WithDialogs` — a screen rendered in isolation has no
│                    <PGDialogHost/>, so every pgConfirm silently reads as
│                    "cancelled" without this
├── select.ts        `pgSelectTrigger` / `pgSelectValues` / `pgPickOption` —
│                    driving a PGSelect, which has no `<option>` and fires no
│                    `change`, so `userEvent.selectOptions` does not apply. Keeps
│                    the same attributes e2e's `jsPickOption` selects on
├── elementSize.ts   `stubContainerSize` / `stubContainerWidth` — jsdom performs
│                    no layout, so every `clientWidth` is 0, which is exactly
│                    the "unmeasured" branch of the pane clamp. A test that wants
│                    the CLAMPED branch has to say what the container measures
└── settle.ts        The shared settle guard for tests driving a diff surface —
                     subtle enough that a second copy drifts
```

