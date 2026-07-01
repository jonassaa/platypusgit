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
    'Commit-to-commit diffs',
    'Line-by-line blame',
    'Repo file browser at HEAD',
  ]},
  { title: 'Branches & tags', blurb: 'Full ref management.', items: [
    'List / create / checkout / rename / delete branches',
    'Lightweight and annotated tags',
    'Push and delete tags',
  ]},
  { title: 'History', blurb: 'Navigate the past.', items: [
    'Commit graph layout',
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
];

// Roadmap teaser (from features.md P0/P1 — clearly "planned")
export const roadmap = [
  'Side-by-side diff view + intra-line highlighting',
  'Branch compare — branch↔branch and branch↔working tree',
  'GPG/SSH commit + tag signing with verified badge',
  'Multi-repo tabs / fast recent-repo switcher',
  'Quick merge/rebase from the branch picker',
  'Partial/hunk-level stash + rename + compare to working tree',
];

export const changelog = [
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
