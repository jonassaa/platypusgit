# Architecture — annotated source trees

Part of the `docs/dev/` set (`architecture`, `testing`, `frontend`, `backend`,
`distribution`). `test/docs.test.ts` reads this set together with CLAUDE.md, so
the trees and command lists here are build-checked — a new module, command, or
feature directory must be added here.

## Backend (`src-tauri/src/`)

```
error.rs         AppError enum (thiserror + serde-tagged) — ONLY error type crossing IPC
state.rs         AppState { backend: Arc<dyn GitBackend> }
opener.rs        URLs/paths → OS default handler. SECURITY-critical: safe_url
                 (https-only, rejects quotes/control chars), safe_workdir_path
                 (no absolute/`..` escape), never spawns via a shell, child exit checked.
                 THE home for "is this path inside the workdir", in two
                 strengths: safe_workdir_path is LEXICAL (enough to hand a path
                 to an app) and resolved_workdir_path CANONICALIZES both sides
                 and re-checks with the pure contained_in — which is what
                 anything that UNLINKS must use, because the lexical check
                 cannot see a symlink or a path reached through one (#245).
                 contained_in compares components, not string prefixes:
                 /repository is not inside /repo
update.rs        Update discovery: semver compare, dev-build (0.0.0) short-circuit
                 before any network call, GitHub release parsing, ureq w/ timeout +
                 https_only. Logic only — handlers live in commands/update.rs
cancel.rs        Cancelling an in-flight network git subprocess (#234). A
                 process-wide registry keyed by SCOPE (the clone / one
                 repository), not by op id — the auto-fetch pile has no id a
                 user could point at. Registered at the two choke points every
                 network op already goes through (create::run_clone,
                 net::run_git_authenticated), so a new network op inherits
                 cancellation with nothing to remember. See backend.md
proc.rs          THE only sanctioned child-process spawner (issue 172):
                 git / git_async / git_async_in (CREATE_NO_WINDOW,
                 GIT_TERMINAL_PROMPT=0, stdin closed), program / program_async,
                 and the two *_keeping_console exceptions. See backend.md
reveal.rs        "Reveal in Finder/Explorer" + "Open in terminal" (#215).
                 HostPlatform decouples argv building from the actual host, so
                 reveal_plan/terminal_plan are PURE and unit-tested for all
                 three platforms from any host. Spawns via proc.rs only.
                 reveal_target/terminal_target answer WHAT to open for a
                 repo-relative path, reading is-it-a-directory off the
                 filesystem rather than from a parameter — the filesystem is the
                 only authority, and that is what makes a directory row open a
                 window on the folder instead of selecting it in its parent
                 (#245).
                 explorer.exe's exit-1-on-success is carried as a FLAG on the
                 plan (not a program-name compare — the program is an absolute
                 pinned path); Windows launchers are pinned to System32 /
                 WindowsApps against binary planting; a missing Linux terminal
                 falls through an ordered candidate list rather than silently
diagnostics.rs   What the log must say about the machine that wrote it (#274),
                 plus the log-file helpers Settings needs. is_wsl_kernel /
                 describe_wsl / parse_git_version / environment_line /
                 mount_warning / tail_lines are PURE and unit-tested from any
                 host — no WSL box needed to test the WSL logic.
                 TWO fact types, split by COST not topic: WslFacts (two file
                 reads, no spawn) via wsl_facts(), and HostFacts (adds
                 `git --version` through proc.rs) via host_facts(); both cached
                 in a OnceLock. open_repo must use wsl_facts — it is a hot path
                 and e2e opens a repo while the login-shell PATH probe still
                 holds the startup thread, so host_facts there would lose the
                 race and pay for the spawn on every cold open.
                 environment_line writes the one `host os=… wsl=… git=…` INFO
                 line at startup; before it, a WSL log and a native Linux log
                 were indistinguishable. mount_warning explains a /mnt/<drive>
                 repo's slowness in the log rather than leaving a nine-second
                 launch looking like a broken app. Handlers live in
                 commands/diagnostics.rs
forge/           GitHub/GitLab PR/MR integration (#92). Trait = URL builders +
                 response parsers, pure and testable against recorded JSON:
├── mod.rs       Types + Forge trait, forge_for(kind), injection guards
│                (validate_host, encode_segment, validate_sha, validate_ref_name)
├── remote.rs    parse_remote_url + detect. PURE. SSH port dropped, HTTPS port
│                kept (self-hosted APIs); no parseable remote → None (a state)
├── token.rs     Secret (no Display/Serialize, Debug prints Secret(***)), redact;
│                storage via the git credential helper under
│                <host>.platypusgit-forge.invalid — see backend.md
├── http.rs      The ONLY impure file: one ureq agent, https_only + timeout +
│                4MB cap; 401/403 → ForgeAuth, everything scrub_credentials'd
├── github.rs    REST v3 (api.github.com; /api/v3 for Enterprise)
├── gitlab.rs    REST v4. Project id = URL-encoded full path; draft = title prefix
└── checkout.rs  fetch_args / checkout_args / branch_exists for "check out this
                 PR". The fetch writes NO ref (FETCH_HEAD only). No `--` for
                 `git rev-parse` — everything after it is a path (regression-tested)
main.rs          Binary entry; keeps windows_subsystem = "windows"
lib.rs           Tauri builder + invoke_handler! registry (all commands listed there)
cli.rs           `pgit` arg parsing (LaunchIntent, parse_args, resolve_repo_root)
                 + the shim story (#144): pure core (shim_dirs_for /
                 package_shim_paths_for / path_dirs / shim_scan_order /
                 references_app / classify_sighting / plan_install), impure
                 shim_status / install_shim over it. ShimOs is an explicit param
                 so all three platform tables are testable. Not git/cli.rs
detach.rs        Terminal handback on `pgit …` (#163): should_detach (pure gate)
                 + spawn_detached re-exec. See distribution.md
windows/         add-user-path.ps1 — per-user PATH append, include_str!'d
deb/             pgit wrapper (committed 100755) + postinst
wix/             pgit-cli.wxs (MSI component) + pgit.cmd
git/
├── mod.rs       GitBackend trait — every git op, returns AppResult<T>
├── types.rs     RepoHandle, FileStatus, CommitInfo, BranchInfo, TagInfo,
│                StashInfo, RemoteInfo, FileDiff, BlameLine, ReflogEntry,
│                RebaseStep, RepoState, ConflictSides, CommitOptions,
│                StashSaveOptions, TagTarget, ResetMode, SubmoduleInfo/State,
│                WorktreeInfo/WorktreeBranch, LfsStatus/LfsFile/LfsPointer/
│                LfsDiff, BisectStatus/BisectMark, etc.
├── libgit2.rs   Libgit2Backend — active impl. merge_branch and rebase_onto
│                shell out to real git, so a conflicted rebase is git's on-disk
│                state; continue/abort_operation detect that
│                (cli_rebase_in_progress) and hand off to git
├── cli.rs       CliBackend — 100% NotImplemented stub (keeps trait shape exercised)
├── submodule.rs SubmoduleStatus → the four SubmoduleStates (uninitialized >
│                pointer moved > dirty); update shells out (it FETCHES —
│                credentials only flow through the askpass env)
├── worktree.rs  libgit2 list/add/lock/unlock/prune; remove shells out — git
│                refuses on dirty work, mapped to DirtyWorktree
├── lfs.rs       Pointer parsing + lfs_diff_of are PURE (a pointer fits in the
│                diff's own lines). "Repo uses LFS" answered from .gitattributes
│                via the INDEX — must work with the lfs binary missing
├── stash.rs     Repo-less stash helpers (#133): push/store argv builders
│                (`--` placement, GIT_LITERAL_PATHSPECS), validate_message,
│                rename_store_landed. Unit-tested with no temp repo
├── bisect.rs    Reads git's own BISECT_* + refs/bisect/* — deliberately NO
│                parallel state file (see backend.md); progress via
│                `git rev-list --bisect-vars`
├── ownership.rs Dubious-ownership refusal (GIT_EOWNER, CVE-2022-24765, the WSL
│                /mnt/c case): error mapping, RepoPresence (Present/Absent/
│                Refused — never infer "no repo" from a failed open),
│                repo_root_for, global safe.directory writer
├── rebase_plan.rs  Plan validation BEFORE rebase_start touches the repo; a
│                rejected plan leaves HEAD, branch ref, worktree untouched
├── rebase_state.rs On-disk mirror of an in-progress rebase
│                (.git/platypusgit-rebase.json + ORIG_HEAD) + last-completed
│                summary in a second file. Deliberately NOT git's own
│                rebase-merge/ dir — a half-compatible one would let git claim
│                a rebase it cannot drive
├── auth.rs      PURE: classify_auth_failure (stderr → AuthKind; host-key
│                failure deliberately not auth), AuthChallenge, scrub_credentials
├── hooks.rs     The ONE place a git hook is executed (#232). `git hook run`,
│                so git's own resolution (core.hooksPath, the executable bit,
│                Windows' sh shim) is not reimplemented — behind a cached,
│                side-effect-free capability probe, with a Unix-only direct-exec
│                fallback for a git older than 2.36. NOTE `git hook run` sends
│                the hook's STDOUT to stderr, so the captured stream is stderr
├── signing.rs   CRYPTOGRAPHIC signing, GPG/SSH — not signature.rs. Pure: key
│                resolution, resolve_key_file (key::… literals refused), signer
│                argv, parse_verify_output. Payload-agnostic: commits and tags
│                reuse one chain
├── tag.rs       Tag signing's pure half (#132): armor detection,
│                append_signature, validate_tag_name, parse_verify_tag. Also
│                the shared ref-name validator (#214): validate_ref_component,
│                validate_branch_name
└── signature.rs IDENTITY, not cryptography: default_signature
                 (user.name/email lookup, NoSignature when unset) and
                 apply_signoff (Signed-off-by trailer, idempotent)
commands/        Thin Tauri handlers, one file per area:
├── repo.rs      open_repo, close_repo, trust_repo_path, get_status, head_info
│                (HEAD's branch/oid, re-polled every refresh — unlike
│                RepoHandle.head, which open_repo sets once), list_all_files,
│                append_gitignore, open_in_editor, reveal_in_file_manager,
│                open_in_terminal (#215 — both take an optional relative_path;
│                omitted/empty targets the repo ROOT instead, for the repo
│                tab's menu, and both ask reveal.rs whether the path is a
│                directory rather than assuming a file),
│                delete_untracked_files (#245 — the ONLY destructive worktree op
│                here; thin over GitBackend::delete_untracked, which validates
│                the whole batch before unlinking anything and then reports
│                per-path failures), and THREE distinct file readers:
│                read_file_content (working tree),
│                read_file_content_at_rev + list_files_at_rev (a commit's tree),
│                read_file_content_at_index (the STAGED blob)
├── cli.rs       take_launch_intent, cli_shim_status, install_cli_shim
├── diagnostics.rs
│                Reaching the app's own log from Settings (#274):
│                diagnostics_report (log path + `host …` line + version),
│                read_log_tail (last 500 lines, seeking to the last 1 MB — the
│                file rotates at 5 MB and shipping all of it across IPC is
│                waste on the machine least able to afford it), and
│                reveal_log_file (reuses reveal.rs, so it inherits the
│                explorer.exe / xdg-open exit-code traps). LOG_FILE here must
│                track the file_name configured in lib.rs — the plugin does not
│                report what it picked. Thin over src-tauri/src/diagnostics.rs
├── commits.rs   get_log, commit, file_history, verify_commit (SELECTED commit
│                only, never per row). REFSPEC_ALL sentinel = walk all refs, so
│                the loaded log is NOT HEAD ancestry — rebase input must go
│                through headAncestryOf. Paged (see frontend.md): get_log_page /
│                get_log_filtered_page / get_log_filtered. Also commits_since
│                (base..HEAD, base must be an ancestor), commits_between
│                (base..tip, no ancestry requirement) and ahead_behind (counts
│                a→b + merge base; unrelated histories → mergeBase: null)
├── diff.rs      get_diff, stage/unstage/discard_paths, stage/unstage/discard_hunk,
│                stage/unstage/discard_lines, diff_ref_to_workdir, blame_file,
│                and two commit diffs ONE character apart: diff_commit (one oid
│                vs its first parent) and diff_commits (rev↔rev) — check arity
├── branches.rs  list_branches/tags/stashes/remotes,
│                checkout/create/delete/rename_branch, set_upstream,
│                fetch, fetch_all, pull, push,
│                add/remove/rename/prune_remote, set_remote_url,
│                create/delete/push_tag, verify_tag, merge_branch, rebase_onto,
│                checkout_ref, push_delete_branch
├── net.rs       Shared network plumbing (Credentials, run_git_authenticated,
│                apply_auth_env, map_git_failure, credential_approve) + TWO
│                commands: remember_credential — stored only after the
│                credential worked — and cancel_network_op, which stops a
│                stalled clone/fetch/pull/push (#234). See backend.md
├── update.rs    check_for_update, get_update_capability, open_url — thin
│                handlers for src-tauri/src/update.rs (same basename, two files)
├── history.rs   reset, cherry_pick, revert
├── stash.rs     stash_save/apply/pop/drop/branch, stash_save_paths,
│                stash_rename, stash_diff (#133)
├── conflict.rs  repo_state, conflict_sides, accept_ours/theirs, mark_resolved,
│                save_resolution, abort/continue_operation, run_mergetool,
│                restart_conflict
├── rebase.rs    rebase_start/continue/abort/status/acknowledge (interactive)
├── forge.rs     forge_detect, forge_sign_in/sign_out/token_status/validate_token,
│                forge_list_pull_requests, forge_pull_request_checks,
│                forge_create_pull_request, forge_checkout_pull_request. Owns
│                ForgeTokens + blocking_forge (redacts tokens from errors)
├── reflog.rs    get_reflog, checkout_detached
├── submodule.rs list_submodules, submodule_init/sync/update (update is
│                credentialed via net::run_git_authenticated)
├── worktree.rs  list_worktrees, worktree_add/remove/lock/unlock/prune
├── lfs.rs       lfs_status, lfs_checkout (local), lfs_fetch/lfs_pull (credentialed)
├── bisect.rs    bisect_status/start/mark/reset
└── create.rs    init_repo, default_init_branch, clone_repo (streaming
                 clone://progress events)
```

## Frontend (`src/`)

```
main.tsx             Entry point (routes ?window=merge)
App.tsx              Thin wrapper around <AppShell />
AppShell.tsx         Shell: titlebar (branch chip, remote buttons), tab strip,
                     activity bar, status bar, error banner, settings. Owns
                     per-tab screen restore and keys the screen subtree by the
                     active repository (a switch REMOUNTS it)
store.ts             Re-export hub — keep thin

design/              In-house design system (NOT components/ui/), exported via
                     design/index.ts: primitives.tsx (PGButton, PGIconButton,
                     PGSelect — in-page listbox, never a native <select>),
                     selectPos.ts (pure popover placement), chrome.tsx
                     (PGTitlebar, PGTabStrip, PGActivityBar, PGStatusBar,
                     PGStatusItem), window-controls.tsx, git-components.tsx
                     (PGCommitRow, PGGraphRow, PGChangeRow, PGFileTree(Row),
                     PGRebaseRow, PGDiffRow, PGHunkActions, PGFoldSeparator…),
                     PGWindowedDiff.tsx (THE windowed diff renderer over
                     DiffRow[]), graph-geometry.ts (lane pitch/gutter, SVG user
                     units — PGGraphRow and PGCommitRow must agree), icons.tsx,
                     logo.tsx, context-menu.tsx, dialog.tsx (PGDialogHost +
                     pgConfirm/pgPrompt — the ONLY confirm/prompt path),
                     empty-state.tsx, skeleton.tsx, error-boundary.tsx (per
                     window), modal.tsx (PGModal), resizable.tsx (PGResizeHandle
                     + usePaneSize), paneSize.ts (pure clamp), ui-helpers.tsx
                     (pgFlash — ONE reused toast element — + PG_FLASH_MS),
                     use-prevent-browser-context-menu.ts

screens/             One per activity-bar item + deep views: RepoBrowser,
                     CommitPanel, History, DiffViewer, Branches, Rebase, Remote,
                     Pulls, Welcome, Reflog, CommitDiff, Compare, FileHistory,
                     Blame, Submodules, Worktrees, Settings. Deliberately NO
                     Conflict screen (#108)

features/            Components + Zustand store colocated per feature:
├── repo/            useRepoStore (ONE repo's live state — the active tab's),
│                    repoSlice (RepoSlice / REPO_SLICE_KEYS / emptySlice),
│                    repoActivity, tabs.ts (pure tab reducers, labelTabs,
│                    pg-open-repos persistence), useTabsStore (open set +
│                    activate/close/cycle + session restore), RepoTabs,
│                    useRecentsStore, ops (shared runners), OperationBar
│                    (repoState-driven bar), ownership (safe.directory confirm)
├── nav/             useNavStore — cross-screen intents + DeepViewHeader
├── branches/        BranchChip, BranchPicker, orderBranches (PURE, #135 — THE
│                    one branch ordering; every branch list goes through it)
├── commits/         Pure log logic, all tested: graphLayout, laneColors,
│                    graphAncestry, rowIdentity, buildRebasePlan /
│                    buildPreservePlan / withPlanBase / runRebasePlan /
│                    planCommitSelection / squashMessage, headAncestry, logFilter
├── rebase/          RebaseBasePicker + useRebaseMergeMode (flatten ⇄ preserve)
├── dnd/             ALL drag-and-drop (#91): useDragSource / useDropZone over
│                    dragController.ts, resolveDrop.ts (pure drop tables),
│                    useRowReorder, StageDropBar. See frontend.md
├── reflog/          useReflogStore, DirtyTreeDialog, ReflogActionDialog
├── settings/        useSettingsStore (autoFetch, defaultPullMode, …), headMarks
│                    + HeadMarksControl
├── palette/         usePaletteStore (step stack + chips), commands catalog,
│                    frecency, CommandPalette (⌘P; rows show live keymap chords)
├── keymap/          actions.ts (catalog + default runners), presets.ts (rider +
│                    classic), useKeymapStore (dispatcher), useFocusStore
│                    (Alt+Arrow spatial + Tab cycling), usePaneList (list nav +
│                    speed-search), useHunkNav (F7/⇧F7 + open-at-first-change),
│                    useDiffLineFocus (per-line cursor + Space),
│                    useSpeedSearchStore, PGPane / FocusableScroll / CheatSheet
├── merge/           Merge resolver window (label "merge"): mergeModel (diff3),
│                    resultEditor (CM6, tracked conflict regions), MergeWindow /
│                    MergeBody / SidePane, openMergeWindow (path optional),
│                    FileList (no open repo in this window — IPC wrappers, never
│                    useRepoStore). Applies via save_resolution, emits
│                    merge://resolved → main refreshes
├── update/          useUpdateStore (discovery, semver-aware dismiss,
│                    self-update; the updateCheckMode gate + lastCheckedAt live
│                    HERE, not at the AppShell call site — see
│                    docs/dev/distribution.md), semver.ts (§11 precedence,
│                    tested), UpdateChip, UpdatePanel (Escape via
│                    app.closeOverlay)
├── auth/            useAuthStore (ONE pending challenge + retry closure — never
│                    the secret) + CredentialDialog. withAuthRetry LIVES IN
│                    useRepoStore.ts, exported — never grow a second retry path
├── create/          Clone + Init dialogs (PGModal), useCreateStore,
│                    deriveRepoName. Clone shells out with the prompt-less env
├── forge/           useForgeStore (hostKinds+logins under pg-forge-hosts, NEVER
│                    a token), forgeLabels (prNoun/prNumberLabel/localBranchFor),
│                    PullRequestRow, CreatePullRequestDialog, ForgeSettings
├── compare/         compareSides (PURE — nav imports the TYPE from here),
│                    useCompareStore (own store; RepoSlice untouched),
│                    CompareSidePicker
├── diff/            CommitDiffPanel (shared commit-diff view), DiffMinimap,
│                    useDiffGaps (+ useExpandedGaps, diffOpenReady),
│                    WhitespaceToggle (+ useHunkActionsDisabledReason)
├── submodules/      useSubmodulesStore (persisted recursive toggle; update goes
│                    through withAuthRetry)
├── worktrees/       useWorktreesStore + WorktreeAddDialog (store owns the
│                    destructive flows: confirm, then a requireText --force
│                    confirm on DirtyWorktree)
├── signing/         SignatureBadgeView + useLazyVerification, SignatureBadge,
│                    TagSignatureBadge — verify the SELECTED object only
├── tags/            useCreateTagStore + CreateTagDialog — promise-shaped
│                    because two call sites are not React components
├── lfs/             useLfsStore, LfsPanel (a Remote-screen section, not a
│                    screen), LfsDiffNotice
└── cli/             useCliLaunch — first-launch intent + forwarded cli-launch
                     events → useTabsStore.openRepo (never evicts current repo)

lib/                 tauri.ts (typed invoke wrappers — frontend NEVER calls
                     invoke directly), types.ts (mirrors Rust types.rs),
                     errors.ts (AppError union 1:1 with Rust), derive.ts
                     (selectors), syntax/ (Shiki OFF the main thread:
                     tokenizeCore.ts, shiki.ts — the ONE lazy instance,
                     engine-javascript not WASM —, langs.ts (explicit
                     LANG_LOADERS map — template-literal imports don't split),
                     scopes.ts (sentinel theme ⇄ CSS classes), tokenizeShiki.ts,
                     tokenize.worker.ts, tokenize.ts (LRU + worker client +
                     fallback; null = render plain), useSyntax.ts /
                     useDiffSyntax.ts (exposes the texts it reads),
                     usePrefetchSyntax.ts), diffRows.ts (flat DiffRow model:
                     line | fill | fold, + hunkAnchorRows), diffMinimap.ts (pure
                     minimap core), cssColor.ts (hex/rgb()/oklch() → sRGB — a
                     canvas can't take CSS vars), wordDiff.ts,
                     pairChangedLines.ts (which rem pairs with which add — one
                     definition, three surfaces), lineSpans.ts (syntax ×
                     word-diff tiling), codeLines.ts (display-line split;
                     text.split("\n") gets two cases wrong), useViewportH.ts,
                     useElementSize.ts (both: measure WITHOUT depending on
                     ResizeObserver), useWindowedList.ts, useVariableWindow.ts
                     (incl. scrollTo — every programmatic diff scroll),
                     useDiffRowHeight.ts (--diff-row-h → px, jsdom fallback),
                     platform.ts, fileIcon.ts, paths.ts (workdir-relative ⇄
                     absolute, pure — no node:path in a webview), selection.ts
                     (+ splitFileSelection), tree.ts (buildStatusTree /
                     buildStatusList — SAME row keys), useTreeViewMode.ts,
                     recents.ts (pg-recent-repos; the OPEN set is pg-open-repos
                     in features/repo/tabs.ts)

test/ (src/test/)    jsdom component-test harness (root test/ is unrelated —
                     doc invariants, see testing.md): setup.ts (invoke/dialog/
                     event/webview mocks; mockInvoke(cmd, handler)),
                     invokeMock.ts, dialogMock.ts, eventMock.ts, webviewMock.ts,
                     dialog.tsx (WithDialogs — without it every pgConfirm reads
                     as cancelled), select.ts (pgSelectTrigger / pgSelectValues /
                     pgPickOption), elementSize.ts (stubContainerSize /
                     stubContainerWidth — jsdom measures 0), settle.ts
```
