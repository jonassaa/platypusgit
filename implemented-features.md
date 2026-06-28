# Implemented Features

Features already shipped end-to-end in platypusgit (backend impl + command wired + surfaced in UI).
Moved here from `features.md` once done. Source of truth = code.

_Last inventoried: 2026-06-28_

## Staging & Commit
- [x] Stage / unstage / discard files
- [x] Stage / unstage / discard individual hunks (`git apply`-based)
- [x] Commit (with amend support)
- [x] Commit with custom author override

## Diff & File Viewing
- [x] Diff worktree↔index, index↔HEAD, worktree↔HEAD
- [x] Diff between two commits (per-file hunks)
- [x] Read file content (text/binary, worktree or HEAD)
- [x] Blame (per-line author/commit/timestamp)
- [x] List all files incl. unmodified (repo browser)

## Branching
- [x] List branches (with upstream tracking)
- [x] Checkout branch (clean-worktree guard)
- [x] Create branch (optional from-ref)
- [x] Delete branch (force flag, merge-safety check)
- [x] Rename branch

## Tags
- [x] List tags
- [x] Create tag (lightweight + annotated)
- [x] Delete tag
- [x] Push tag

## History — Navigation
- [x] Commit log (with refs/parents, graph layout engine)
- [x] File history (commits touching a path)
- [x] Checkout detached HEAD (by OID)
- [x] Reflog viewer

## History — Manipulation
- [x] Reset (soft / mixed / hard)
- [x] Cherry-pick (with conflict handling)
- [x] Revert (inverse commit, conflict handling)

## Stash
- [x] Save stash (includeUntracked / keepIndex / message)
- [x] List stashes
- [x] Apply / pop / drop stash
- [x] Create branch from stash

## Conflict Resolution
- [x] Detect repo state (merge / cherry-pick / revert / rebase)
- [x] Read 3-way conflict sides (base / ours / theirs)
- [x] Accept ours / accept theirs
- [x] Mark resolved
- [x] Run external mergetool
- [x] Restart conflict (reset file)
- [x] Continue operation (merge/cherry-pick/revert)
- [x] Abort operation

## Interactive Rebase
- [x] Start rebase from plan (Pick/Reword/Edit/Squash/Fixup/Drop)
- [x] Continue rebase (after edit/conflict)
- [x] Abort rebase
- [x] Rebase status (progress + pause reason)
- [x] Non-interactive rebase onto upstream
- [x] Rebase base picker UI

## Remotes
- [x] List / add / remove / rename remotes
- [x] Set remote URL
- [x] Prune remote (stale refs)

## Network
- [x] Fetch single remote (+ prune)
- [x] Fetch all remotes (+ prune)
- [x] Pull (fast-forward / merge / rebase modes)
- [x] Push (none / with-lease / force)
- [x] Push delete branch
- [x] Merge branch (conflict-aware)

## Repo & Config
- [x] Open repo (+ recent repos)
- [x] Get status (worktree/index flags)
- [x] Append `.gitignore` pattern
- [x] Open file in editor
- [x] Settings (autoFetch, defaultPullMode, etc.)

## UX / Chrome
- [x] Centralized branch UI — titlebar branch chip + popover picker
- [x] Activity-bar screen switcher (`⌘1…⌘9`), persisted
- [x] Cross-screen nav intents (diff-file, commit-vs-wt, file-history, blame, rebase-plan, stash-diff)
- [x] In-house design system + icons
- [x] Native macOS titlebar (aligned traffic lights)
- [x] Error banner (typed AppError surfaced to UI)
