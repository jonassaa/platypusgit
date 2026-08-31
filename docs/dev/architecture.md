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
cancel.rs        Cancelling an in-flight network git subprocess (#234, #263). A
                 process-wide registry keyed by SCOPE (the clone / one
                 repository), not by op id — the auto-fetch pile has no id a
                 user could point at. Registered at the two choke points every
                 network op already goes through (create::run_clone,
                 net::run_git_authenticated), so a new network op inherits
                 cancellation with nothing to remember. cancel() kills the
                 child directly by pid — SIGTERM to its whole process group
                 first (kill_tree), escalating to SIGKILL on a second cancel
                 of the same op. See backend.md
proc.rs          THE only sanctioned child-process spawner (issue 172):
                 git / git_async / git_async_in (CREATE_NO_WINDOW,
                 GIT_TERMINAL_PROMPT=0, stdin closed, own process group),
                 program / program_async, and the two *_keeping_console
                 exceptions. See backend.md
progress.rs      Reading git's own `--progress` sideband off a child's stderr
                 (#296). parse_progress turns "Receiving objects:  62%
                 (620/1000)" into a CloneProgress; ProgressReader splits a byte
                 stream on `\r` AS WELL AS `\n` (git redraws with a bare `\r`,
                 so reading by line buffers a whole phase and the bar jumps
                 instead of streaming), bounds an undelimited line, and keeps
                 the non-progress lines as the failure-message tail. Clone had
                 all of this privately; fetch/pull/push use the same code now,
                 so the two cannot drift. Neither caller selects on anything:
                 the cancel kills the child by pid (#263), and the read loop
                 just notices the pipe close. See backend.md
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
ssh.rs           Finding and making an SSH key (#248) — the other half of
                 "clone over SSH failed", which git/auth.rs can only classify.
                 Pure and unit-tested: parse_public_key, fingerprint (SHA256:
                 computed IN PROCESS, so listing N keys is zero subprocesses —
                 pinned byte-identical to `ssh-keygen -lf`), validate_key_name
                 (a NAME, never a path, so traversal cannot be expressed),
                 validate_comment, suggested_name, host_label, add_key_url.
                 discover() lists `*.pub` files with a private sibling and FLAGS
                 the default identities — it deliberately does NOT claim to know
                 which key ssh would offer (~/.ssh/config, an agent, the
                 server's own preferences). generate() carries the three
                 refusals: never overwrite (ours, because ssh-keygen's is an
                 interactive prompt against a closed stdin), 0600 re-read, and
                 delete-the-key when a requested passphrase did not stick —
                 ssh-keygen writes an UNENCRYPTED key and exits 0 when no
                 askpass is reachable. The passphrase travels in the
                 ENVIRONMENT through the SAME askpass shim git credentials use.
                 See backend.md. Not git/signing.rs, which also drives
                 ssh-keygen but for SIGNATURES
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
│                CloneOptions (#255 — the Clone dialog's Advanced flags) and
│                ShallowInfo (shallow + boundary count + single-branch),
│                WorktreeInfo/WorktreeBranch, LfsStatus/LfsFile/LfsPointer/
│                LfsDiff, BisectStatus/BisectMark, BlobSource/ImagePreview
│                (#224 — which SIDE a preview reads, and the four answers:
│                image / tooLarge / unsupported / lfsMissing), etc.
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
├── image.rs     Image-preview sniffing (#224). PURE, table-tested: magic bytes
│                → media type for PNG/JPEG/GIF/WebP/BMP/ICO, the size ceiling
│                (MAX_PREVIEW_BYTES), and git-lfs's objects/aa/bb/<oid> fan-out.
│                The EXTENSION never decides — a repository is untrusted input.
│                SVG is recognised and REFUSED by name (script + remote refs,
│                and the app ships no CSP behind the <img>); the module doc
│                argues it
├── stash.rs     Repo-less stash helpers (#133): push/store argv builders
│                (`--` placement, GIT_LITERAL_PATHSPECS), validate_message,
│                rename_store_landed. Unit-tested with no temp repo
├── blame.rs     `blame.ignoreRevsFile` — the PURE half (#253): read_settings,
│                resolve_ignore_revs_path, blame_args, parse_porcelain. libgit2
│                has NO ignore-revs support at all, so a repo that configures a
│                file gets `git blame --line-porcelain`; a repo that does not
│                keeps the in-process libgit2 blame. The configured path never
│                enters argv — git reads its own config, and the un-ignored view
│                passes the fixed literal `--ignore-revs-file=` (git's "clear
│                the list"). See backend.md
├── notes.rs     Reading `refs/notes/*` (#253), read-only: label_for,
│                is_notes_ref, sort_refs (all PURE) + read(). EVERY notes ref is
│                shown, labelled — `core.notesRef`/`notes.displayRef` are
│                deliberately not consulted. Absence is a state at three levels.
│                See backend.md
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
├── shallow.rs   How much of a repository is actually HERE (#255) — the PURE
│                half: count_shallow_roots (lines of .git/shallow),
│                refspec_is_pinned (a fetch refspec whose SOURCE side has no
│                `*`) and single_branch_from_refspecs. The IO half is
│                libgit2.rs::shallow_info: is_shallow() (libgit2 stats the file
│                every call, so a cached Repository still reports the truth
│                after --unshallow), one file read for the count, the remote
│                list for the refspecs. No state file — git owns the answer, the
│                bisect.rs call rather than the rebase_state.rs one
├── signing.rs   CRYPTOGRAPHIC signing, GPG/SSH — not signature.rs. Pure: key
│                resolution, resolve_key_file (key::… literals refused), signer
│                argv, parse_verify_output. Payload-agnostic: commits and tags
│                reuse one chain
├── tag.rs       Tag signing's pure half (#132): armor detection,
│                append_signature, validate_tag_name, parse_verify_tag. Also
│                the shared ref-name validator (#214): validate_ref_component,
│                validate_branch_name
├── difftool.rs  `git difftool` — handing any diff to the user's own tool (#235).
│                Decides WHICH TWO SIDES and builds the argv; which PROGRAM runs
│                stays git's (diff.guitool / diff.tool / merge.tool /
│                difftool.<tool>.cmd), which is what makes it zero-config.
│                difftool_args + normalize_tool are PURE; spec_for is the one
│                impure fn and exists for a single case — a commit's own diff
│                resolves its first parent HERE, because `<oid>^` fails at a
│                root commit and `<oid>^!` silently degrades to a diff against
│                the WORKING TREE. `--gui` and `--tool` are never passed
│                together: git refuses the pair
├── commit_template.rs
│                `commit.template` + `core.commentChar` + `commit.cleanup`
│                (#252). Resolves the
│                template PATH (worktree-relative — `git commit` runs after
│                setup_git_directory() chdir'd to the top — absolute, or `~`
│                expanded) and the comment prefix, `auto` resolved git's way.
│                `CleanupMode::Default` is deliberately NOT resolved here — it
│                means "strip if the message is to be EDITED, whitespace
│                otherwise", and only the composer knows which its box is. The
│                STRIPPING is not here either: it lives in the composer
│                (features/commits/message/cleanup.ts) so the box can show what
│                it removes before Commit. Path + prefix resolution are pure fns
│                unit-tested without a repo; tests/commit_template.rs covers the
│                repo side
└── signature.rs IDENTITY, not cryptography: default_signature
                 (user.name/email lookup, NoSignature when there is no
                 identity git accepts — asked of the CONFIG, not of libgit2's
                 error code, because a MISSING user.name is NotFound while a
                 BLANK one is a generic error whose only mark is the prose
                 "failed to parse signature"), read_identity / global_config_
                 path / local_config_path / validate_identity /
                 set_global_identity / set_local_identity (#212, #233 — the
                 write side, at BOTH scopes. IdentityWriteScope is deliberately
                 not IdentityScope: the latter has a System member because a
                 value can be READ from /etc/gitconfig, but writing there needs
                 root and would change every user on the machine, so two enums
                 keep that unreachable rather than merely unhandled.
                 local_config_path uses commondir(), not path(): they differ in
                 a linked worktree, where --local writes the SHARED config.
                 validate_identity is the ONE rule both writers and
                 default_signature use, so "what we save" and "what we call
                 missing" cannot drift), and apply_signoff
                 (Signed-off-by trailer, idempotent)
commands/        Thin Tauri handlers, one file per area:
├── repo.rs      open_repo, close_repo, trust_repo_path, get_status, head_info
│                (HEAD's branch/oid, re-polled every refresh — unlike
│                RepoHandle.head, which open_repo sets once),
│                shallow_info (#255 — shallow? how many boundary commits? do the
│                remotes fetch one branch? read on every refreshAll, never
│                remembered), list_all_files,
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
│                read_file_content_at_index (the STAGED blob) — plus a FOURTH
│                reader that answers with BYTES, read_image_preview (#224:
│                worktree / index / rev / conflict stage → base64 + the sniffed
│                media type, so an <img> can be fed without guessing from the
│                extension; the other three carry text, which is None for a
│                binary blob by contract)
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
│                only, never per row), commit_notes, which is lazy for the
│                same reason (#253 — the log walk is the hot path, so notes are
│                read for the selected commit and cost the page nothing), and
│                get_commit_template (#252 — the repo's commit.template +
│                comment prefix; a configured template that cannot be read
│                comes back FLAGGED, never as an error, so a stale config line
│                cannot stop the commit screen opening).
│                get_identity / set_identity (#212, #233 — the committer
│                identity. get_identity's repoId is OPTIONAL, because Settings
│                is reachable before a repo is open and the global chain is the
│                real answer there; it reports each half's SCOPE, and both
│                config paths, so the UI can name the file a save will write.
│                set_identity is the only write in the app that touches the
│                user's own git config; its `scope` is REQUIRED with no default
│                — "which config did that change?" is the question #233 exists
│                to stop people asking — and `repository` without a repoId is
│                REFUSED rather than falling back to global. It validates
│                before opening anything, so a refused value creates no file.
│                See git/signature.rs)
│                REFSPEC_ALL sentinel = walk all refs, so
│                the loaded log is NOT HEAD ancestry — rebase input must go
│                through headAncestryOf. Paged (see frontend.md): get_log_page /
│                get_log_filtered_page / get_log_filtered. Also commits_since
│                (base..HEAD, base must be an ancestor), commits_between
│                (base..tip, no ancestry requirement) and ahead_behind (counts
│                a→b + merge base; unrelated histories → mergeBase: null)
├── diff.rs      get_diff, stage/unstage/discard_paths, stage/unstage/discard_hunk,
│                stage/unstage/discard_lines, diff_ref_to_workdir, blame_file
│                (takes ignoreRevs — the Blame screen's toggle; see git/blame.rs),
│                two commit diffs ONE character apart: diff_commit (one oid
│                vs its first parent) and diff_commits (rev↔rev) — check arity —
│                and open_in_difftool (#235), the only command here that does
│                not return a diff: it hands one to `git difftool`. Thin over
│                GitBackend::difftool_plan; the spawn is the SECOND deliberate
│                console-keeping exception (see backend.md) and pipes stderr, so
│                git's own "diff.tool is not configured" reaches the banner
├── branches.rs  list_branches/tags/stashes/remotes,
│                checkout/create/delete/rename_branch, set_upstream,
│                fetch, fetch_all, pull, push,
│                unshallow (#255 — `git fetch --unshallow`, on the one runner;
│                answers false instead of relaying git's refusal when the
│                repository is already complete),
│                fast_forward_branch — fetch the branch's remote, then advance
│                a NOT-checked-out branch to its upstream if that is a
│                fast-forward (#246); fast_forward_all_branches does the sweep
│                on one fetch. Both are thin: the ancestry check and the ref
│                move are one backend call under one lock (see backend.md),
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
├── ssh.rs       ssh_key_status, ssh_key_generate (#248) — thin over
│                src-tauri/src/ssh.rs. Take NO repository: an SSH key belongs to
│                the machine, not to a repo, which is also why this is not a
│                GitBackend method. ssh_key_generate resolves the askpass from
│                current_exe() HERE, so tests can pass their own script
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
│                    repoActivity, shallowNoticeText (PURE, per-surface
│                    sentences) + ShallowNotice (the strip; History, FileHistory,
│                    Blame and Compare mount it — test/shallowSurfaces.test.ts
│                    fails the build for a fifth that forgets),
│                    tabs.ts (pure tab reducers, labelTabs,
│                    pg-open-repos persistence), useTabsStore (open set +
│                    activate/close/cycle + session restore), RepoTabs,
│                    useRecentsStore, ops (shared runners), OperationBar
│                    (repoState-driven bar), ownership (safe.directory confirm)
├── nav/             useNavStore — cross-screen intents + DeepViewHeader
├── branches/        BranchChip, BranchPicker, orderBranches (PURE, #135 — THE
│                    one branch ordering; every branch list goes through it),
│                    branchTree (PURE, #244 — grouping on `/` AFTER ordering:
│                    compressed folder rows + flat depth-carrying rows,
│                    parentFolderPath, branchesInFolder), useBranchFolders
│                    (per-repo collapsed set in localStorage), deleteMerged
│                    (candidates + `ahead_behind` merge check + summary),
│                    fastForward (#246)
├── commits/         Pure log logic, all tested: graphLayout, laneColors,
│                    graphAncestry, rowIdentity, buildRebasePlan /
│                    buildPreservePlan / withPlanBase / runRebasePlan /
│                    planCommitSelection / squashMessage, headAncestry, logFilter
│                    — plus CommitNotes: `git notes` for the SELECTED commit,
│                    debounced like SignatureBadge (#253)
│   └── message/     THE commit-message composition surface (#252):
│                    useCommitComposer (template pre-fill, cleanup, ticket,
│                    type picker) + CommitMessageBar, over pure cleanup.ts /
│                    ticket.ts / subject.ts. A new way to compose commit-message
│                    text joins THIS hook and THIS bar's `extra` slot — see
│                    frontend.md
├── rebase/          RebaseBasePicker + useRebaseMergeMode (flatten ⇄ preserve)
├── dnd/             ALL drag-and-drop (#91): useDragSource / useDropZone over
│                    dragController.ts, resolveDrop.ts (pure drop tables),
│                    useRowReorder, StageDropBar. See frontend.md
├── reflog/          useReflogStore, DirtyTreeDialog, ReflogActionDialog
├── settings/        useSettingsStore (autoFetch, defaultPullMode, …), headMarks,
│                   systemAppearance (OS light/dark → themePreference)
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
│                    useRepoStore.ts, exported — never grow a second retry path.
│                    Plus the SSH key setup an `SshKey` challenge needs (#248):
│                    sshAdvice (PURE — the kind × has-a-key grid that turns
│                    "authentication failed" into "no key" vs "not registered"),
│                    useSshKeyStore (machine state, so NOT RepoSlice; never
│                    holds the passphrase) and SshKeyPanel (copy the public
│                    half, open the host's add-key page, generate)
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
│                    WhitespaceToggle (+ useHunkActionsDisabledReason),
│                    useDiffFind + DiffFindBar (find in diff — ONE hook for all
│                    four surfaces; searches the row model, scrolls by offset),
│                    useImagePreviews + ImageDiffView (image previews — the same
│                    ONE-component rule, for the complement of isTextualDiff:
│                    old beside new with dimensions, bytes and both deltas, and
│                    the honest empty state for everything that is not an image)
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
                     word-diff tiling, plus find marks), diffFind.ts (find in
                     diff, PURE: match/count/wrap over DiffRow[], never the
                     rendered window), codeLines.ts (display-line split;
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
