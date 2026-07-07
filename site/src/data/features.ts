// 9 hero feature areas (from README "Features")
export const heroFeatures = [
  { icon: 'git-commit', title: 'Staging & commit', blurb: 'Stage/unstage/discard files and individual hunks. Commit with amend + author override.' },
  { icon: 'diff', title: 'Diff & viewing', blurb: 'Worktree/index/HEAD diffs, commit-to-commit diffs, blame, repo browser.' },
  { icon: 'git-branch', title: 'Branches & tags', blurb: 'List/create/checkout/rename/delete branches. Lightweight + annotated tags.' },
  { icon: 'history', title: 'History', blurb: 'Commit graph, file history, reflog viewer, detached-HEAD checkout.' },
  { icon: 'rewind', title: 'History manipulation', blurb: 'Reset (soft/mixed/hard), cherry-pick, revert.' },
  { icon: 'archive', title: 'Stash', blurb: 'Save/apply/pop/drop, stash-to-branch.' },
  { icon: 'merge', title: 'Conflict resolution', blurb: '3-way sides, accept ours/theirs, external mergetool, continue/abort.' },
  { icon: 'list', title: 'Interactive rebase', blurb: 'Pick/reword/edit/squash/fixup/drop, continue/abort, base picker.' },
  { icon: 'cloud', title: 'Remotes & network', blurb: 'Add/remove/rename/prune remotes, fetch/pull/push (with-lease/force), merge.' },
];

// Full grouped list (from implemented-features.md)
export const featureGroups = [
  { title: 'Staging', blurb: 'Granular control over what goes into a commit.', items: [
    'Stage / unstage / discard whole files',
    'Stage / unstage / discard individual hunks',
    'Commit with amend and author override',
  ]},
  { title: 'Diff & viewing', blurb: 'See exactly what changed, anywhere.', items: [
    'Worktree / index / HEAD diffs',
    'Unified and side-by-side (split) diff views',
    'Configurable diff context lines',
    'Commit-to-commit diffs',
    'Line-by-line blame',
    'Repo file browser at HEAD, or any revision',
  ]},
  { title: 'Branches & tags', blurb: 'Full ref management.', items: [
    'List / create / checkout / rename / delete branches',
    'Lightweight and annotated tags',
    'Push and delete tags',
  ]},
  { title: 'History', blurb: 'Navigate the past.', items: [
    'Commit graph layout',
    'Ref-scoped log — browse the log of any branch, tag, or revspec',
    'Commit / log search (message, author, SHA, date, path)',
    'Per-file history',
    'Reflog viewer',
    'Detached-HEAD checkout',
  ]},
  { title: 'History manipulation', blurb: 'Rewrite with care.', items: [
    'Reset — soft / mixed / hard',
    'Cherry-pick',
    'Revert',
  ]},
  { title: 'Stash', blurb: 'Park work in progress.', items: [
    'Save / apply / pop / drop',
    'Stash to new branch',
  ]},
  { title: 'Conflict resolution', blurb: 'Resolve merges without leaving the app.', items: [
    '3-way conflict sides',
    'Accept ours / theirs',
    'External mergetool launch',
    'Continue / abort operation',
  ]},
  { title: 'Interactive rebase', blurb: 'Reshape history visually.', items: [
    'Pick / reword / edit / squash / fixup / drop',
    'Continue / abort',
    'Rebase base picker',
  ]},
  { title: 'Remotes & network', blurb: 'Sync with anywhere.', items: [
    'Add / remove / rename / prune remotes',
    'Fetch / fetch-all / pull',
    'Push with-lease and force',
    'Merge branches',
  ]},
  { title: 'Navigation & keyboard', blurb: 'Keyboard-first, fast everywhere.', items: [
    'Command palette (⌘P) — branches, files, commits, and actions',
    'Rider-style default keymap, with a Classic preset',
    'Type-to-jump speed-search in lists',
    'Commit chords and F7 / ⇧F7 hunk navigation',
    'Spatial Alt+Arrow pane focus and a ? cheat sheet',
    '`pgit` command-line launcher — open a repo from the terminal',
  ]},
];

// Roadmap teaser (from features.md P0/P1 — clearly "planned")
export const roadmap = [
  'Intra-line (word-level) diff highlighting',
  'Branch compare — branch↔branch and branch↔working tree',
  'GPG/SSH commit + tag signing with verified badge',
  'Multi-repo tabs / fast recent-repo switcher',
  'Quick merge/rebase from the branch picker',
  'Partial/hunk-level stash + rename + compare to working tree',
  'Signed & notarized macOS / Windows builds',
];

export const changelog = [
  {
    version: '0.0.6',
    date: '2026-07-07',
    status: 'feature',
    notes: [
      'Keyboard navigation — a full keymap system with a Rider-style default (Classic preset available), type-to-jump speed-search, commit chords, `F7` / `⇧F7` hunk navigation, spatial `Alt+Arrow` pane focus, and a `?` cheat sheet.',
      '`pgit` command-line launcher — open a repo from the terminal with `pgit [subcommand] [path]`; forwards into a running instance; installable shim.',
      'Ref-scoped history — browse the commit log of any branch, tag, or revspec and cherry-pick from unmerged refs via the History ref selector.',
      'Command palette upgrades — an actions catalog, frecency ranking, drill-in steps, and type-filter chips (⌘P / Ctrl+P).',
      'Multi-file selection — select several files in the commit panel or repo browser and stage / unstage / discard them from the context menu.',
      'Settings — configurable diff context lines and UI density; non-functional toggles removed.',
      'Fixes — interactive-rebase conflict resume now completes, and aborting no longer discards a resolved commit; the palette type chips run the highlighted row; palette Pull honours your pull-mode setting and tracking branch; the commit shortcut no longer double-commits on key-repeat; History selection resets when a filter shrinks the list.',
    ],
  },
  {
    version: '0.0.5',
    date: '2026-07-01',
    status: 'build',
    notes: [
      'Windows `.msi` now builds — added an `.ico` to the icon set so the Windows bundler stops failing.',
      'Multi-platform release assets: macOS universal `.dmg`, Windows x64 `.msi`, Linux amd64 `.deb` + `.AppImage`.',
    ],
  },
  {
    version: '0.0.4',
    date: '2026-07-01',
    status: 'build',
    notes: [
      'First release built for all three platforms via CI — macOS `.dmg`, Windows `.msi`, Linux `.deb` + `.AppImage`.',
      'Validates the Windows and Linux build jobs; assets attach automatically once the release workflow completes.',
    ],
  },
  {
    version: '0.0.3',
    date: '2026-06-30',
    status: 'feature',
    notes: [
      'Recent commit messages — a "Recent" button in the commit panel refills the message from your recent commit subjects/bodies (newest-first, de-duplicated, skips merges).',
      'Sign-off (-s) toggle — appends a Signed-off-by trailer from your committer identity with full `git commit -s` semantics (idempotent, correct blank-line separation, git-accurate trailer-key rule); applied on normal and amend commits. Preference persists and stays in sync with Settings.',
      'Browse the repo tree at any revision — type a revspec (SHA, branch, tag, HEAD~2, …) or quick-pick a branch/tag to list the full file tree and view file contents as they were then, with syntax highlighting and binary-blob handling.',
      'Commit / log search in History — filter by message, author, SHA prefix, date range, and path, with free-text qualifiers (author: / path: / sha: / since: / until: / message:). Backend-filtered over a revwalk; results render through the commit graph.',
    ],
  },
  {
    version: '0.0.2',
    date: '2026-06-30',
    status: 'feature',
    notes: [
      'Command palette / fuzzy finder — open with ⌘P / Ctrl+P to jump to any branch, file, recent commit, or app command from one overlay.',
      'Fuzzy matching ranks consecutive runs, word boundaries, and camelCase; keyboard-first navigation (↑/↓, Enter) with match highlighting and a trapped focus ring.',
      'Selecting a result acts on it: branches check out, files open in the diff view, commits show their diff, commands switch screens.',
    ],
  },
  {
    version: '0.0.1',
    date: '2026-06-30',
    status: 'initial release',
    notes: [
      'First public release of platypusgit — a dev-first git desktop app built with Tauri 2 + React.',
      'Staging: stage / unstage / discard whole files and individual hunks; commit with amend and author override.',
      'Diff & viewing: worktree / index / HEAD diffs, commit-to-commit diffs, line-by-line blame, repo file browser at HEAD.',
      'Branches & tags: list / create / checkout / rename / delete branches; lightweight and annotated tags; push and delete tags.',
      'History: commit graph layout, per-file history, reflog viewer, detached-HEAD checkout.',
      'History manipulation: reset (soft / mixed / hard), cherry-pick, revert.',
      'Stash: save / apply / pop / drop, and stash to a new branch.',
      'Conflict resolution: 3-way sides, accept ours / theirs, external mergetool, continue / abort.',
      'Interactive rebase: pick / reword / edit / squash / fixup / drop, continue / abort, rebase base picker.',
      'Remotes & network: add / remove / rename / prune remotes, fetch / pull / push (with-lease and force), merge branches.',
      'Centralized branch UI — titlebar branch chip + popover picker.',
      'Native window titlebar with platform-aware window controls; light / dark theme.',
      'Universal macOS .dmg build published via CI.',
    ],
  },
];
