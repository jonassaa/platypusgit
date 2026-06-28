# Feature Backlog / Task Queue

Prioritized backlog for platypusgit, MVP-deliverability order (most important → least).
Sourced from competitor scan: Fork, GitKraken, JetBrains (Rider/IntelliJ), TortoiseGit, Sublime Merge.

Workflow:
- Pull top unchecked item → spec/plan under `docs/superpowers/` → build.
- When shipped end-to-end, **move** it to `implemented-features.md`.
- Already-shipped features live in `implemented-features.md`, not here.

Legend: `[ ]` todo · `[~]` in progress · priority tiers P0 (do first) → P4 (last).

---

## P0 — Core gaps blocking daily-driver use

- [ ] Commit/log search in history UI — filter by message, author, SHA, date, path
- [ ] Side-by-side diff view (toggle vs inline) + word/character-level intra-line highlighting
- [ ] Command palette / fuzzy finder (⌘P) — jump to branch, file, commit, command
- [ ] Browse full repo file tree at any commit/revision (not just HEAD)
- [ ] Recent commit message dropdown + sign-off (`-s`) toggle
- [ ] Force-push safety + push status feedback (rejected/non-ff handling in UI)

## P1 — Important power features

- [ ] Branch compare — diff branch↔branch and branch↔working tree
- [ ] Quick merge/rebase from branch picker (drag-and-drop or context action)
- [ ] Partial/hunk-level stash + rename stash + compare stash to working tree
- [ ] Pickaxe search — find commits by code content added/removed (`-S`/`-G`) and in-diff search
- [ ] Undo/redo for destructive ops (reset, branch delete, rebase, drop)
- [ ] GPG/SSH commit + tag signing (config + per-commit toggle, verified badge)
- [ ] Multi-repo tabs / fast recent-repo switcher

## P2 — Larger standalone features

- [ ] Worktree management (create / list / switch / remove)
- [ ] Submodule management (init / update / sync / diff)
- [ ] Bisect (good/bad/skip, regression finder)
- [ ] Patch create / apply (format-patch + am, copy commit as patch)
- [ ] Git LFS support (track patterns, status) + LFS file locking
- [ ] Changelists / grouping uncommitted changes into named sets
- [ ] Image & binary diff viewer (swipe / onion-skin / pixel)
- [ ] Repository graph polish — pin branches, hide/show refs, collapse merged branches

## P3 — Hosting & ecosystem integrations

- [ ] GitHub / GitLab account integration (OAuth, repo list in clone)
- [ ] Pull / merge request view + create + inline review
- [ ] Issue tracker linking (Jira / GitHub Issues) in commit messages
- [ ] Git-flow helpers (feature/release/hotfix branch flows)
- [ ] Clone dialog with hosting-provider repo picker

## P4 — Differentiators / nice-to-have

- [ ] AI commit message generation from staged diff
- [ ] AI conflict-resolution assist + explain-commit/branch
- [ ] Custom user-defined commands (shell + UI), surfaced in command palette
- [ ] Workspaces — group multiple repos into one view
- [ ] Sparse checkout
- [ ] Commit message templates + before-commit checks (format/lint/tests)
- [ ] Bug-tracker/commit-link integration & client-side hook scripts
- [ ] Shareable/cloud patches via link
